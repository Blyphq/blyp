import { createWarnOnceLogger } from '../../shared/once';
import { createRandomId } from '../../shared/client-log';
import type { LogRecord } from '../../core/file-logger';
import type { ResolvedConnectorDeliveryConfig } from '../../types/core/config';
import { computeConnectorRetryDelay } from './backoff';
import { SQLiteWorkerClient } from './sqlite-client';
import {
  CONNECTOR_BATCH_DISPATCH,
  CONNECTOR_DELIVERY_BINDER,
  type ConnectorBatchDispatcher,
  type ConnectorBatchDispatchTarget,
  type ConnectorDeliveryStatusRecord,
  type ConnectorDeliveryBinder,
  type ConnectorDeliveryJob,
  type DurableConnectorDeadLetterRecord,
  type ConnectorDispatchFailure,
  type DurableConnectorJobRecord,
  type DurableQueueRescheduleInput,
  type QueuedConnectorType,
  type SerializedConnectorJobEnvelope,
} from './types';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isServerRecord(record: LogRecord): boolean {
  return record.data === undefined ||
    typeof record.data !== 'object' ||
    record.data === null ||
    (record.data as { type?: unknown }).type !== 'client_log';
}

function safeStringifyEnvelope(
  envelope: SerializedConnectorJobEnvelope
): string {
  return JSON.stringify(envelope);
}

function safeParseEnvelope(value: string): SerializedConnectorJobEnvelope | null {
  try {
    const parsed = JSON.parse(value) as SerializedConnectorJobEnvelope;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.jobId !== 'string') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function dedupeConnectorStatusItems(batch: ConnectorDeliveryJob[]) {
  const deduped = new Map<string, { connectorType: QueuedConnectorType; connectorTarget?: string }>();

  for (const job of batch) {
    const key = `${job.connectorType}:${job.connectorTarget ?? ''}`;
    if (!deduped.has(key)) {
      deduped.set(key, {
        connectorType: job.connectorType,
        connectorTarget: job.connectorTarget,
      });
    }
  }

  return [...deduped.values()];
}

export class ConnectorDeliveryManager implements ConnectorDeliveryBinder {
  private readonly warnOnce = createWarnOnceLogger(new Set<string>());

  private readonly memoryQueue: ConnectorDeliveryJob[] = [];

  private readonly durableStaging: DurableConnectorJobRecord[] = [];

  private readonly dispatchers = new Map<string, ConnectorBatchDispatcher>();

  private activeDispatches = 0;

  private flushPromise: Promise<void> | null = null;

  private durableFlushPromise: Promise<void> | null = null;

  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  private durablePollRunning = false;

  private closed = false;

  private durableClient: SQLiteWorkerClient | null = null;

  private durableReady = false;

  private durableInitPromise: Promise<void> | null = null;

  constructor(private readonly config: ResolvedConnectorDeliveryConfig) {
    if (config.enabled) {
      this.durableInitPromise = this.initializeDurableQueue();
    }
  }

  bindTarget(target: ConnectorBatchDispatchTarget): void {
    if (typeof target[CONNECTOR_DELIVERY_BINDER] === 'function') {
      target[CONNECTOR_DELIVERY_BINDER]!(this);
    }

    const dispatcher = target[CONNECTOR_BATCH_DISPATCH];
    if (dispatcher) {
      this.dispatchers.set(dispatcher.dispatchKey, dispatcher);
    }
  }

  unbindTarget(target: ConnectorBatchDispatchTarget): void {
    if (typeof target[CONNECTOR_DELIVERY_BINDER] === 'function') {
      target[CONNECTOR_DELIVERY_BINDER]!(null);
    }
  }

  enqueue(
    connectorType: QueuedConnectorType,
    record: LogRecord,
    dispatcher: ConnectorBatchDispatcher,
    target?: string
  ): void {
    if (this.closed || !isServerRecord(record)) {
      return;
    }

    this.dispatchers.set(dispatcher.dispatchKey, dispatcher);
    this.memoryQueue.push({
      id: createRandomId(),
      connectorType,
      connectorTarget: target,
      source: 'server',
      record,
      attemptCount: 0,
      maxAttempts: this.config.retry.maxAttempts,
      nextAttemptAt: Date.now(),
      createdAt: Date.now(),
      dispatchKey: dispatcher.dispatchKey,
      dispatcher,
    });

    this.enforceMemoryCapacity();
    this.scheduleDispatch();
  }

  async flush(): Promise<void> {
    await this.durableInitPromise?.catch(() => {});
    await this.processUntilIdle();
    await this.flushDurableStaging();
    await this.drainDurableQueueForFlush();
    await this.flushDurableStaging();
    await this.processUntilIdle();
  }

  async shutdown(): Promise<void> {
    this.closed = true;

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    await this.durableInitPromise?.catch(() => {});

    if (this.durableReady) {
      const pending = this.memoryQueue.splice(0, this.memoryQueue.length);
      for (const job of pending) {
        this.stageDurableJob(job, job.attemptCount, Math.max(job.nextAttemptAt, Date.now()));
      }
      await this.flushDurableStaging();
    }

    await this.processUntilIdle();

    if (this.durableClient) {
      await this.durableClient.shutdown().catch(() => {});
      this.durableClient = null;
    }
  }

  async getDurableCountForTests(): Promise<number> {
    await this.durableInitPromise?.catch(() => {});
    if (!this.durableReady || !this.durableClient) {
      return 0;
    }
    return this.durableClient.count();
  }

  async getStatusSummaryForTests(): Promise<ConnectorDeliveryStatusRecord[]> {
    await this.durableInitPromise?.catch(() => {});
    if (!this.durableReady || !this.durableClient) {
      return [];
    }

    return this.durableClient.getStatusSummary();
  }

  async listDeadLettersForTests(): Promise<DurableConnectorDeadLetterRecord[]> {
    await this.durableInitPromise?.catch(() => {});
    if (!this.durableReady || !this.durableClient) {
      return [];
    }

    const result = await this.durableClient.listDeadLetters({ limit: 1000, offset: 0 });
    return result.items;
  }

  private async initializeDurableQueue(): Promise<void> {
    try {
      const client = new SQLiteWorkerClient(this.config.durableQueuePath);
      await client.init();
      this.durableClient = client;
      this.durableReady = true;
      this.scheduleDurablePoll();
    } catch (error) {
      this.durableReady = false;
      this.durableClient = null;
      this.warnOnce(
        'connector-durable-disabled',
        `[Blyp] Warning: Failed to initialize the connector SQLite queue at ${this.config.durableQueuePath}. Falling back to in-memory retries.`,
        error
      );
    }
  }

  private scheduleDispatch(): void {
    if (this.flushPromise) {
      return;
    }

    this.flushPromise = (async () => {
      try {
        await this.pumpMemoryQueue();
      } finally {
        this.flushPromise = null;
        if (!this.closed && this.hasReadyMemoryJobs()) {
          this.scheduleDispatch();
        }
      }
    })();
  }

  private async pumpMemoryQueue(): Promise<void> {
    while (!this.closed) {
      while (this.activeDispatches < this.config.dispatchConcurrency) {
        const batch = this.takeNextMemoryBatch();
        if (batch.length === 0) {
          break;
        }

        this.activeDispatches += 1;
        void this.dispatchMemoryBatch(batch).finally(() => {
          this.activeDispatches -= 1;
          if (!this.closed) {
            this.scheduleDispatch();
          }
        });
      }

      if (this.activeDispatches === 0 || !this.hasReadyMemoryJobs()) {
        break;
      }

      await delay(10);
    }
  }

  private takeNextMemoryBatch(): ConnectorDeliveryJob[] {
    const now = Date.now();
    const firstIndex = this.memoryQueue.findIndex((job) => job.nextAttemptAt <= now);
    if (firstIndex === -1) {
      return [];
    }

    const first = this.memoryQueue[firstIndex]!;
    const batch: ConnectorDeliveryJob[] = [first];
    this.memoryQueue.splice(firstIndex, 1);

    for (let index = this.memoryQueue.length - 1; index >= 0; index -= 1) {
      const candidate = this.memoryQueue[index]!;
      if (
        candidate.dispatchKey === first.dispatchKey &&
        candidate.connectorTarget === first.connectorTarget &&
        candidate.nextAttemptAt <= now &&
        batch.length < this.config.memoryBatchSize
      ) {
        batch.push(candidate);
        this.memoryQueue.splice(index, 1);
      }
    }

    return batch;
  }

  private async dispatchMemoryBatch(batch: ConnectorDeliveryJob[]): Promise<void> {
    const dispatcher = batch[0]!.dispatcher;
    const now = Date.now();
    const result = await dispatcher.dispatch(
      batch.map((job) => job.record),
      { source: 'server', target: batch[0]!.connectorTarget }
    ).catch((error) => {
      return {
        ok: false,
        retryable: true,
        error: error instanceof Error ? error.message : String(error),
      } satisfies ConnectorDispatchFailure;
    });

    if (result.ok) {
      await this.recordSuccessfulDispatch(batch, now);
      return;
    }

    await this.handleRetryableFailure(batch, result, false, now);
  }

  private async handleRetryableFailure(
    batch: ConnectorDeliveryJob[],
    failure: ConnectorDispatchFailure,
    fromDurable: boolean,
    now: number
  ): Promise<void> {
    if (!fromDurable) {
      await this.durableInitPromise?.catch(() => {});
    }

    const durableReschedules: DurableQueueRescheduleInput[] = [];
    const durableDeadLetters: DurableConnectorDeadLetterRecord[] = [];

    await this.recordFailedDispatch(batch, failure, now);

    for (const job of batch) {
      const attemptCount = job.attemptCount + 1;
      if (!failure.retryable || attemptCount >= job.maxAttempts) {
        durableDeadLetters.push({
          id: job.id,
          connectorType: job.connectorType,
          connectorTarget: job.connectorTarget,
          operation: 'send',
          payloadJson: safeStringifyEnvelope({
            jobId: job.id,
            connectorType: job.connectorType,
            connectorTarget: job.connectorTarget,
            source: job.source,
            record: job.record,
            createdAt: job.createdAt,
          }),
          attemptCount,
          maxAttempts: job.maxAttempts,
          lastError: failure.error,
          firstEnqueuedAt: job.createdAt,
          deadLetteredAt: now,
          lastAttemptAt: now,
        });

        this.warnOnce(
          `connector-drop:${job.connectorType}:${job.connectorTarget ?? 'default'}:${job.id}`,
          fromDurable && this.durableReady
            ? `[Blyp] Warning: Dead-lettered ${job.connectorType} connector job after ${attemptCount} failed attempt(s). ${failure.error ?? 'Connector delivery failed.'}`
            : `[Blyp] Warning: Dropped ${job.connectorType} connector job after ${attemptCount} failed attempt(s). ${failure.error ?? 'Connector delivery failed.'}`
        );
        continue;
      }

      const nextAttemptAt = now + computeConnectorRetryDelay(attemptCount, this.config.retry);
      if (fromDurable) {
        durableReschedules.push({
          id: job.id,
          attemptCount,
          nextAttemptAt,
          lastError: failure.error,
        });
        continue;
      }

      if (this.durableReady && this.config.durableSpillStrategy === 'after-first-failure') {
        this.stageDurableJob(job, attemptCount, nextAttemptAt, failure.error);
        continue;
      }

      this.memoryQueue.push({
        ...job,
        attemptCount,
        nextAttemptAt,
      });
    }

    if (durableDeadLetters.length > 0) {
      await this.durableClient?.deadLetter(durableDeadLetters).catch((error) => {
        this.warnOnce(
          'connector-dead-letter-failure',
          '[Blyp] Warning: Failed to persist dead-lettered connector queue jobs.',
          error
        );
      });
    }

    if (durableReschedules.length > 0) {
      await this.durableClient?.reschedule(durableReschedules, now).catch((error) => {
        this.warnOnce(
          'connector-reschedule-failure',
          '[Blyp] Warning: Failed to reschedule durable connector queue jobs.',
          error
        );
      });
    }
  }

  private async recordSuccessfulDispatch(batch: ConnectorDeliveryJob[], now: number): Promise<void> {
    if (!this.durableReady || !this.durableClient || batch.length === 0) {
      return;
    }

    const items = dedupeConnectorStatusItems(batch).map((item) => ({
      connectorType: item.connectorType,
      connectorTarget: item.connectorTarget,
      timestamp: now,
    }));

    await this.durableClient.markSuccess(items).catch((error) => {
      this.warnOnce(
        'connector-status-success-failure',
        '[Blyp] Warning: Failed to record connector delivery success state.',
        error
      );
    });
  }

  private async recordFailedDispatch(
    batch: ConnectorDeliveryJob[],
    failure: ConnectorDispatchFailure,
    now: number
  ): Promise<void> {
    if (!this.durableReady || !this.durableClient || batch.length === 0) {
      return;
    }

    const items = dedupeConnectorStatusItems(batch).map((item) => ({
      connectorType: item.connectorType,
      connectorTarget: item.connectorTarget,
      timestamp: now,
      lastError: failure.error,
    }));

    await this.durableClient.markFailure(items).catch((error) => {
      this.warnOnce(
        'connector-status-failure-failure',
        '[Blyp] Warning: Failed to record connector delivery failure state.',
        error
      );
    });
  }

  private stageDurableJob(
    job: ConnectorDeliveryJob,
    attemptCount: number,
    nextAttemptAt: number,
    lastError?: string
  ): void {
    const payload = safeStringifyEnvelope({
      jobId: job.id,
      connectorType: job.connectorType,
      connectorTarget: job.connectorTarget,
      source: job.source,
      record: job.record,
      createdAt: job.createdAt,
    });

    this.durableStaging.push({
      id: job.id,
      connectorType: job.connectorType,
      connectorTarget: job.connectorTarget,
      operation: 'send',
      payloadJson: payload,
      attemptCount,
      maxAttempts: job.maxAttempts,
      nextAttemptAt,
      state: 'pending',
      lastError,
      createdAt: job.createdAt,
      updatedAt: Date.now(),
    });

    void this.flushDurableStaging();
  }

  private async flushDurableStaging(): Promise<void> {
    if (!this.durableReady || !this.durableClient || this.durableStaging.length === 0) {
      return;
    }

    if (this.durableFlushPromise) {
      await this.durableFlushPromise;
      return;
    }

    this.durableFlushPromise = (async () => {
      while (this.durableStaging.length > 0) {
        const batch = this.durableStaging.splice(0, this.config.sqliteWriteBatchSize);
        try {
          await this.durableClient!.insert(batch);
        } catch (error) {
          this.warnOnce(
            'connector-durable-insert-failure',
            '[Blyp] Warning: Failed to persist connector jobs into the durable SQLite queue.',
            error
          );
          this.durableStaging.unshift(...batch);
          break;
        }
      }
    })();

    try {
      await this.durableFlushPromise;
    } finally {
      this.durableFlushPromise = null;
    }
  }

  private async processDurableQueueOnce(): Promise<void> {
    if (!this.durableReady || !this.durableClient || this.durablePollRunning) {
      return;
    }

    this.durablePollRunning = true;

    try {
      while (!this.closed) {
        const rows = await this.durableClient.claimDue(this.config.sqliteReadBatchSize, Date.now());
        if (rows.length === 0) {
          break;
        }

        const grouped = new Map<string, ConnectorDeliveryJob[]>();
        const missingIds: string[] = [];

        for (const row of rows) {
          const envelope = safeParseEnvelope(row.payloadJson);
          if (!envelope) {
            missingIds.push(row.id);
            continue;
          }

          const dispatchKey = row.connectorType === 'otlp' || row.connectorType === 'http'
            ? `${row.connectorType}:${row.connectorTarget ?? ''}`
            : row.connectorType;
          const dispatcher = this.dispatchers.get(dispatchKey);

          if (!dispatcher) {
            missingIds.push(row.id);
            continue;
          }

          const job: ConnectorDeliveryJob = {
            id: row.id,
            connectorType: row.connectorType,
            connectorTarget: row.connectorTarget,
            source: envelope.source,
            record: envelope.record,
            attemptCount: row.attemptCount,
            maxAttempts: row.maxAttempts,
            nextAttemptAt: row.nextAttemptAt,
            createdAt: row.createdAt,
            dispatchKey,
            dispatcher,
          };

          const group = grouped.get(dispatchKey) ?? [];
          group.push(job);
          grouped.set(dispatchKey, group);
        }

        if (missingIds.length > 0) {
          await this.durableClient.ack(missingIds);
        }

        for (const batch of grouped.values()) {
          const dispatcher = batch[0]!.dispatcher;
          const result = await dispatcher.dispatch(
            batch.map((job) => job.record),
            { source: 'server', target: batch[0]!.connectorTarget }
          ).catch((error) => {
            return {
              ok: false,
              retryable: true,
              error: error instanceof Error ? error.message : String(error),
            } satisfies ConnectorDispatchFailure;
          });

          if (result.ok) {
            await this.recordSuccessfulDispatch(batch, Date.now());
            await this.durableClient.ack(batch.map((job) => job.id));
            continue;
          }

          await this.handleRetryableFailure(batch, result, true, Date.now());
        }
      }
    } finally {
      this.durablePollRunning = false;
    }
  }

  private async drainDurableQueueForFlush(): Promise<void> {
    if (!this.durableReady || !this.durableClient) {
      return;
    }

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    try {
      while (!this.closed) {
        while (this.durablePollRunning) {
          await delay(10);
        }

        await this.processDurableQueueOnce();
        await this.flushDurableStaging();

        const remainingDurableJobs = await this.durableClient.count().catch(() => 0);
        if (
          remainingDurableJobs === 0 &&
          !this.durablePollRunning &&
          this.durableStaging.length === 0
        ) {
          break;
        }

        await delay(10);
      }
    } finally {
      if (!this.closed) {
        this.scheduleDurablePoll();
      }
    }
  }

  private scheduleDurablePoll(): void {
    if (this.closed || !this.durableReady || this.pollTimer) {
      return;
    }

    this.pollTimer = setTimeout(async () => {
      this.pollTimer = null;
      await this.flushDurableStaging();
      await this.processDurableQueueOnce();
      this.scheduleDurablePoll();
    }, this.config.pollIntervalMs);
  }

  private enforceMemoryCapacity(): void {
    while (this.memoryQueue.length > this.config.memoryBufferSize) {
      const index = this.config.overflowStrategy === 'drop-new'
        ? this.memoryQueue.length - 1
        : 0;
      const [overflowJob] = this.memoryQueue.splice(index, 1);
      if (!overflowJob) {
        break;
      }

      if (this.durableReady) {
        this.stageDurableJob(
          overflowJob,
          overflowJob.attemptCount,
          Math.max(Date.now(), overflowJob.nextAttemptAt),
          'spilled from in-memory buffer'
        );
        continue;
      }

      this.warnOnce(
        `connector-overflow:${overflowJob.connectorType}:${overflowJob.connectorTarget ?? 'default'}:${index}`,
        `[Blyp] Warning: Connector queue overflow reached ${this.config.memoryBufferSize}. Dropping queued ${overflowJob.connectorType} job.`
      );
    }
  }

  private hasReadyMemoryJobs(): boolean {
    const now = Date.now();
    return this.memoryQueue.some((job) => job.nextAttemptAt <= now);
  }

  private async processUntilIdle(): Promise<void> {
    while (
      this.activeDispatches > 0 ||
      this.memoryQueue.length > 0 ||
      this.durableStaging.length > 0 ||
      this.flushPromise !== null ||
      this.durableFlushPromise !== null
    ) {
      this.scheduleDispatch();
      await this.flushPromise?.catch(() => {});
      await this.flushDurableStaging();

      if (!this.memoryQueue.some((job) => job.nextAttemptAt > Date.now())) {
        await this.processDurableQueueOnce();
      }

      if (this.activeDispatches === 0 && this.memoryQueue.length > 0 && !this.hasReadyMemoryJobs()) {
        const nextAttemptAt = Math.min(...this.memoryQueue.map((job) => job.nextAttemptAt));
        await delay(Math.max(nextAttemptAt - Date.now(), 0));
      } else {
        await delay(10);
      }

      if (this.activeDispatches === 0 && this.memoryQueue.length === 0 && this.durableStaging.length === 0) {
        break;
      }
    }
  }
}
