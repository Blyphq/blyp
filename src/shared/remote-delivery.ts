import type {
  ClientLogEvent,
  RemoteDeliveryConfig,
  RemoteDeliveryFailureReason,
  RemoteDeliveryRuntime,
  RemoteDeliveryTransport,
} from '../types/shared/client-log';
import type {
  DeliveryAttemptFailure,
  DeliveryAttemptResult,
  DeliveryAttemptRetry,
  DeliveryAttemptSuccess,
  RemoteDeliveryManagerOptions,
} from '../types/shared/remote-delivery';

export type {
  DeliveryAttemptFailure,
  DeliveryAttemptResult,
  DeliveryAttemptRetry,
  DeliveryAttemptSuccess,
} from '../types/shared/remote-delivery';

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 5_000;
const DEFAULT_MAX_QUEUE_SIZE = 100;

function clampInteger(value: number | undefined, fallback: number, minimum: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(minimum, Math.floor(value!));
}

function safeCall<T>(callback: ((value: T) => void) | undefined, value: T): void {
  if (!callback) {
    return;
  }

  try {
    callback(value);
  } catch {}
}

function warn(message: string): void {
  if (typeof console === 'undefined' || typeof console.warn !== 'function') {
    return;
  }

  console.warn(message);
}

function formatWarningValue(value: string | number | undefined): string {
  return value === undefined ? 'unknown' : String(value);
}

export function createRemoteDeliveryManager(
  options: RemoteDeliveryManagerOptions
): { enqueue: (event: ClientLogEvent) => void } {
  const deliveryConfig = {
    maxRetries: clampInteger(options.delivery?.maxRetries, DEFAULT_MAX_RETRIES, 0),
    retryDelayMs: clampInteger(options.delivery?.retryDelayMs, DEFAULT_RETRY_DELAY_MS, 0),
    maxQueueSize: clampInteger(options.delivery?.maxQueueSize, DEFAULT_MAX_QUEUE_SIZE, 1),
    warnOnFailure: options.delivery?.warnOnFailure ?? true,
    onSuccess: options.delivery?.onSuccess,
    onRetry: options.delivery?.onRetry,
    onFailure: options.delivery?.onFailure,
    onDrop: options.delivery?.onDrop,
  } satisfies Required<
    Pick<RemoteDeliveryConfig, 'maxRetries' | 'retryDelayMs' | 'maxQueueSize' | 'warnOnFailure'>
  > & Pick<RemoteDeliveryConfig, 'onSuccess' | 'onRetry' | 'onFailure' | 'onDrop'>;

  const queue: QueueItem[] = [];
  let inFlight: QueueItem | undefined;
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let isProcessing = false;
  let unsubscribeFromResume: (() => void) | undefined;

  const runtimeLabel = options.runtime === 'browser' ? 'client' : options.runtime;

  const clearFlushTimer = (): void => {
    if (!flushTimer) {
      return;
    }

    clearTimeout(flushTimer);
    flushTimer = undefined;
  };

  const hasUnsentEvents = (): boolean => queue.length > 0 || inFlight !== undefined;

  const refreshResumeSubscription = (flush: () => void): void => {
    if (!options.subscribeToResume) {
      return;
    }

    if (hasUnsentEvents()) {
      if (!unsubscribeFromResume) {
        unsubscribeFromResume = options.subscribeToResume(() => {
          const now = Date.now();
          for (const item of queue) {
            item.nextAttemptAt = now;
          }

          clearFlushTimer();
          flush();
        }) ?? undefined;
      }

      return;
    }

    if (unsubscribeFromResume) {
      unsubscribeFromResume();
      unsubscribeFromResume = undefined;
    }
  };

  const warnDrop = (ctx: RemoteDeliveryDropContext): void => {
    if (!deliveryConfig.warnOnFailure) {
      return;
    }

    warn(
      `[blyp/${runtimeLabel}] Dropped queued log "${ctx.droppedEvent.message}" ` +
      `(id: ${ctx.droppedEvent.id}) because the delivery queue reached ${ctx.maxQueueSize}. ` +
      `Keeping "${ctx.replacementEvent.message}" (id: ${ctx.replacementEvent.id}) instead.`
    );
  };

  const warnFailure = (
    ctx: RemoteDeliveryFailureContext,
    suppressWarning: boolean | undefined
  ): void => {
    if (!deliveryConfig.warnOnFailure || suppressWarning) {
      return;
    }

    const details = [
      `reason=${ctx.reason}`,
      `attempt=${formatWarningValue(ctx.attempt)}`,
      `status=${formatWarningValue(ctx.status)}`,
    ];

    if (ctx.error) {
      details.push(`error=${ctx.error}`);
    }

    warn(
      `[blyp/${runtimeLabel}] Failed to deliver log "${ctx.event.message}" ` +
      `(id: ${ctx.event.id}, ${details.join(', ')})`
    );
  };

  const totalUnsentEvents = (): number => queue.length + (inFlight ? 1 : 0);

  const scheduleFlush = (flush: () => void): void => {
    clearFlushTimer();

    if (queue.length === 0) {
      refreshResumeSubscription(flush);
      return;
    }

    const nextAttemptAt = queue.reduce((lowest, item) => {
      return Math.min(lowest, item.nextAttemptAt);
    }, Number.POSITIVE_INFINITY);
    const delay = Math.max(nextAttemptAt - Date.now(), 0);
    flushTimer = setTimeout(() => {
      flushTimer = undefined;
      flush();
    }, delay);
    refreshResumeSubscription(flush);
  };

  const emitDrop = (
    droppedEvent: ClientLogEvent,
    replacementEvent: ClientLogEvent
  ): void => {
    const context: RemoteDeliveryDropContext = {
      runtime: options.runtime,
      droppedEvent,
      replacementEvent,
      maxQueueSize: deliveryConfig.maxQueueSize,
      reason: 'queue_overflow',
    };

    safeCall(deliveryConfig.onDrop, context);
    warnDrop(context);
  };

  const enforceQueueCapacity = (): void => {
    while (totalUnsentEvents() > deliveryConfig.maxQueueSize && queue.length > 0) {
      const droppedItem = queue.shift();
      const replacementEvent = queue[queue.length - 1]?.event ?? inFlight?.event;

      if (!droppedItem || !replacementEvent) {
        break;
      }

      emitDrop(droppedItem.event, replacementEvent);
    }
  };

  const getNextReadyIndex = (): number => {
    const now = Date.now();

    for (let index = 0; index < queue.length; index += 1) {
      if (queue[index]!.nextAttemptAt <= now) {
        return index;
      }
    }

    return -1;
  };

  const flush = async (): Promise<void> => {
    if (isProcessing) {
      return;
    }

    isProcessing = true;

    try {
      while (true) {
        const nextIndex = getNextReadyIndex();
        if (nextIndex === -1) {
          break;
        }

        const item = queue.splice(nextIndex, 1)[0];
        if (!item) {
          continue;
        }

        inFlight = item;
        refreshResumeSubscription(() => {
          void flush();
        });

        item.attempt += 1;

        const result = await options.send(item.event);
        inFlight = undefined;

        if (result.outcome === 'success') {
          const context: RemoteDeliverySuccessContext = {
            runtime: options.runtime,
            event: item.event,
            attempt: item.attempt,
            status: result.status,
            transport: result.transport,
          };

          safeCall(deliveryConfig.onSuccess, context);
          continue;
        }

        if (
          result.outcome === 'retry' &&
          item.attempt <= deliveryConfig.maxRetries
        ) {
          item.nextAttemptAt = Date.now() + deliveryConfig.retryDelayMs;
          queue.push(item);

          const context: RemoteDeliveryRetryContext = {
            runtime: options.runtime,
            event: item.event,
            attempt: item.attempt,
            retriesRemaining: deliveryConfig.maxRetries - (item.attempt - 1),
            nextRetryAt: new Date(item.nextAttemptAt).toISOString(),
            reason: result.reason,
            status: result.status,
            error: result.error,
          };

          safeCall(deliveryConfig.onRetry, context);
          continue;
        }

        const failureContext: RemoteDeliveryFailureContext = {
          runtime: options.runtime,
          event: item.event,
          attempt: item.attempt,
          reason: result.reason,
          status: result.status,
          error: result.error,
        };

        safeCall(deliveryConfig.onFailure, failureContext);
        warnFailure(
          failureContext,
          result.outcome === 'failure' ? result.suppressWarning : undefined
        );
      }
    } finally {
      isProcessing = false;
      scheduleFlush(() => {
        void flush();
      });
    }
  };

  return {
    enqueue(event: ClientLogEvent): void {
      queue.push({
        event,
        attempt: 0,
        nextAttemptAt: Date.now(),
      });
      enforceQueueCapacity();
      scheduleFlush(() => {
        void flush();
      });
      void flush();
    },
  };
}
