import { Worker } from 'node:worker_threads';
import { createWarnOnceLogger } from '../../shared/once';
import { createRandomId } from '../../shared/client-log';
import type { LogRecord } from '../../core/file-logger';
import type { ResolvedConnectorDeliveryConfig } from '../../types/core/config';
import { computeConnectorRetryDelay } from './backoff';
import { buildSQLiteWorkerSource } from './sqlite-worker';
import {
  CONNECTOR_BATCH_DISPATCH,
  CONNECTOR_DELIVERY_BINDER,
  type ConnectorBatchDispatcher,
  type ConnectorBatchDispatchTarget,
  type ConnectorDeliveryBinder,
  type ConnectorDeliveryJob,
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

class SQLiteWorkerClient {
  private readonly worker: Worker;

  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  private nextId = 1;

  constructor(private readonly path: string) {
    this.worker = new Worker(buildSQLiteWorkerSource(), { eval: true });
    this.worker.on('message', (message: { id: number; ok: boolean; result?: unknown; error?: string }) => {
      const entry = this.pending.get(message.id);
      if (!entry) {
        return;
      }

      this.pending.delete(message.id);

      if (message.ok) {
        entry.resolve(message.result);
        return;
      }

      entry.reject(new Error(message.error ?? 'SQLite worker request failed.'));
    });
    this.worker.on('error', (error) => {
      for (const entry of this.pending.values()) {
        entry.reject(error instanceof Error ? error : new Error(String(error)));
      }
      this.pending.clear();
    });
  }

  private request<TResult>(type: string, payload: Record<string, unknown> = {}): Promise<TResult> {
    const id = this.nextId++;
    return new Promise<TResult>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.worker.postMessage({ id, type, payload });
    });
  }

  async init(): Promise<void> {
    await this.request('init', { path: this.path });
  }

  async insert(jobs: DurableConnectorJobRecord[]): Promise<void> {
    await this.request('insert', { jobs });
  }

  async claimDue(limit: number, now: number): Promise<DurableConnectorJobRecord[]> {
    return this.request('claimDue', { limit, now });
  }

  async ack(ids: string[]): Promise<void> {
    await this.request('ack', { ids });
  }

  async reschedule(items: DurableQueueRescheduleInput[], now: number): Promise<void> {
    await this.request('reschedule', { items, now });
  }

  async count(): Promise<number> {
    return this.request('count');
  }

  async shutdown(): Promise<void> {
    try {
      await this.request('shutdown');
    } finally {
      await this.worker.terminate();
    }
  }
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
    await this.processDurableQueueOnce();
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
      return;
    }

    this.handleRetryableFailure(batch, result, false);
  }

  private handleRetryableFailure(
    batch: ConnectorDeliveryJob[],
    failure: ConnectorDispatchFailure,
    fromDurable: boolean
  ): void {
    const now = Date.now();
    const ackIds: string[] = [];
    const durableReschedules: DurableQueueRescheduleInput[] = [];

    for (const job of batch) {
      const attemptCount = job.attemptCount + 1;
      if (!failure.retryable || attemptCount >= job.maxAttempts) {
        if (fromDurable) {
          ackIds.push(job.id);
        }

        this.warnOnce(
          `connector-drop:${job.connectorType}:${job.connectorTarget ?? 'default'}:${job.id}`,
          `[Blyp] Warning: Dropped ${job.connectorType} connector job after ${attemptCount} failed attempt(s). ${failure.error ?? 'Connector delivery failed.'}`
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

    if (ackIds.length > 0) {
      void this.durableClient?.ack(ackIds).catch((error) => {
        this.warnOnce('connector-ack-failure', '[Blyp] Warning: Failed to acknowledge connector queue jobs.', error);
      });
    }

    if (durableReschedules.length > 0) {
      void this.durableClient?.reschedule(durableReschedules, now).catch((error) => {
        this.warnOnce(
          'connector-reschedule-failure',
          '[Blyp] Warning: Failed to reschedule durable connector queue jobs.',
          error
        );
      });
    }
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

          const dispatchKey = row.connectorType === 'otlp'
            ? `otlp:${row.connectorTarget ?? ''}`
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
            await this.durableClient.ack(batch.map((job) => job.id));
            continue;
          }

          this.handleRetryableFailure(batch, result, true);
        }
      }
    } finally {
      this.durablePollRunning = false;
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
