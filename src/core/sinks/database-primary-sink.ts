import { createWarnOnceLogger } from '../../shared/once';
import type { LogRecord } from '../file-logger';
import type { BlypPrimarySink } from '../primary-sink';
import type { DatabaseLogRow, ResolvedDatabaseLoggerConfig } from '../../types/database';
import { createDatabaseRowWriter, toDatabaseLogRow } from '../../database/helpers';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class DatabasePrimarySink implements BlypPrimarySink {
  readonly isAsync = true;

  readonly isReady = true;

  private readonly warnOnce = createWarnOnceLogger(new Set<string>());

  private readonly queue: DatabaseLogRow[] = [];

  private readonly writer;

  private timer: ReturnType<typeof setTimeout> | null = null;

  private processing = false;

  private closed = false;

  private terminalError: Error | null = null;

  private activeDispatch: Promise<void> | null = null;

  constructor(private readonly config: ResolvedDatabaseLoggerConfig) {
    this.writer = createDatabaseRowWriter(config);
  }

  write(record: LogRecord): void {
    if (this.closed) {
      return;
    }

    this.enqueue(toDatabaseLogRow(record));
    this.scheduleDispatch();
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const flushPromise = (async () => {
      await this.drain();
      if (this.terminalError) {
        throw this.terminalError;
      }
    })();

    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    try {
      await Promise.race([
        flushPromise,
        new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => {
            this.warnOnce(
              'database-flush-timeout',
              `[Blyp] Warning: Timed out flushing database logs after ${this.config.delivery.flushTimeoutMs}ms.`
            );
            reject(new Error('[Blyp] Timed out flushing database logs.'));
          }, this.config.delivery.flushTimeoutMs);
        }),
      ]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  async shutdown(): Promise<void> {
    this.closed = true;
    await this.flush();
  }

  private enqueue(row: DatabaseLogRow): void {
    this.queue.push(row);

    const overflow = this.queue.length - this.config.delivery.maxQueueSize;
    if (overflow <= 0) {
      return;
    }

    this.warnOnce(
      'database-overflow',
      `[Blyp] Warning: Database log queue exceeded ${this.config.delivery.maxQueueSize} entries. Applying ${this.config.delivery.overflowStrategy} overflow handling.`
    );

    if (this.config.delivery.overflowStrategy === 'drop-new') {
      this.queue.splice(this.config.delivery.maxQueueSize);
      return;
    }

    this.queue.splice(0, overflow);
  }

  private scheduleDispatch(): void {
    if (this.processing) {
      return;
    }

    if (this.config.delivery.strategy === 'immediate') {
      void this.drain();
      return;
    }

    if (this.queue.length >= this.config.delivery.batchSize) {
      void this.drain();
      return;
    }

    if (this.timer) {
      return;
    }

    this.timer = setTimeout(() => {
      this.timer = null;
      void this.drain();
    }, this.config.delivery.flushIntervalMs);
  }

  private async drain(): Promise<void> {
    if (this.processing) {
      if (this.activeDispatch) {
        await this.activeDispatch;
      }
      return;
    }

    this.processing = true;
    this.activeDispatch = this.processQueue();

    try {
      await this.activeDispatch;
    } finally {
      this.processing = false;
      this.activeDispatch = null;
    }
  }

  private async processQueue(): Promise<void> {
    while (this.queue.length > 0) {
      const batchSize = this.config.delivery.strategy === 'batch'
        ? Math.max(1, this.config.delivery.batchSize)
        : 1;
      const batch = this.queue.splice(0, batchSize);

      try {
        await this.insertWithRetry(batch);
      } catch (error) {
        const failure = error instanceof Error
          ? error
          : new Error(String(error ?? 'Unknown database logging failure'));
        this.terminalError = failure;
        this.warnOnce(
          'database-insert-failure',
          `[Blyp] Warning: Failed to persist logs to the ${this.config.dialect ?? 'database'} database.`,
          failure
        );
        throw failure;
      }
    }
  }

  private async insertWithRetry(batch: DatabaseLogRow[]): Promise<void> {
    const maxAttempts = Math.max(1, this.config.delivery.retry.maxRetries + 1);
    let attempt = 0;

    while (attempt < maxAttempts) {
      attempt += 1;

      try {
        await this.writer.insert(batch);
        return;
      } catch (error) {
        if (attempt >= maxAttempts) {
          throw error;
        }

        await delay(this.config.delivery.retry.backoffMs);
      }
    }
  }
}
