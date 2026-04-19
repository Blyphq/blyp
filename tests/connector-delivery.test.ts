import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { ConnectorDeliveryManager } from '../src/connectors/delivery/manager';
import {
  clearConnectorDeadLetters,
  getConnectorDeliveryStatusSummary,
  listConnectorDeadLetters,
  retryConnectorDeadLetters,
} from '../src/connectors/delivery/studio-queue';
import type {
  ConnectorBatchDispatcher,
} from '../src/connectors/delivery/types';
import { makeTempDir, waitForFileFlush } from './helpers/fs';

describe('Connector Delivery Manager', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir('blyp-connector-delivery-');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('persists a retryable failure to SQLite and replays it successfully', async () => {
    const durableQueuePath = path.join(tempDir, '.blyp', 'queue.db');
    const delivery = new ConnectorDeliveryManager({
      enabled: true,
      memoryBufferSize: 10,
      durableQueuePath,
      durableSpillStrategy: 'after-first-failure',
      memoryBatchSize: 10,
      sqliteWriteBatchSize: 10,
      sqliteReadBatchSize: 10,
      dispatchConcurrency: 1,
      pollIntervalMs: 2000,
      overflowStrategy: 'drop-oldest',
      durableReady: false,
      retry: {
        maxAttempts: 4,
        initialBackoffMs: 0,
        maxBackoffMs: 0,
        multiplier: 2,
        jitter: false,
      },
    });

    const dispatched: string[] = [];
    let shouldFail = true;
    const dispatcher: ConnectorBatchDispatcher = {
      dispatchKey: 'betterstack',
      async dispatch(records) {
        if (shouldFail) {
          shouldFail = false;
          return {
            ok: false,
            retryable: true,
            error: 'temporary outage',
          };
        }

        dispatched.push(...records.map((record) => record.message));
        return { ok: true };
      },
    };

    await waitForFileFlush(50);
    delivery.enqueue(
      'betterstack',
      {
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'queued for retry',
      },
      dispatcher
    );

    await waitForFileFlush(50);
    expect(fs.existsSync(durableQueuePath)).toBe(true);
    expect(await delivery.getDurableCountForTests()).toBe(1);
    expect(await delivery.getStatusSummaryForTests()).toEqual([
      expect.objectContaining({
        connectorType: 'betterstack',
        pendingCount: 1,
        deadLetterCount: 0,
        lastFailureAt: expect.any(Number),
        lastError: 'temporary outage',
      }),
    ]);

    await delivery.flush();

    expect(dispatched).toEqual(['queued for retry']);
    expect(await delivery.getDurableCountForTests()).toBe(0);
    expect(await delivery.getStatusSummaryForTests()).toEqual([
      expect.objectContaining({
        connectorType: 'betterstack',
        pendingCount: 0,
        deadLetterCount: 0,
        lastSuccessAt: expect.any(Number),
        lastError: undefined,
      }),
    ]);

    await delivery.shutdown();
  });

  it('moves exhausted jobs to dead letters and allows retry and clear operations', async () => {
    const durableQueuePath = path.join(tempDir, '.blyp', 'queue.db');
    const delivery = new ConnectorDeliveryManager({
      enabled: true,
      memoryBufferSize: 10,
      durableQueuePath,
      durableSpillStrategy: 'after-first-failure',
      memoryBatchSize: 10,
      sqliteWriteBatchSize: 10,
      sqliteReadBatchSize: 10,
      dispatchConcurrency: 1,
      pollIntervalMs: 25,
      overflowStrategy: 'drop-oldest',
      durableReady: false,
      retry: {
        maxAttempts: 2,
        initialBackoffMs: 0,
        maxBackoffMs: 0,
        multiplier: 2,
        jitter: false,
      },
    });

    let attempts = 0;
    let shouldFail = true;
    const dispatched: string[] = [];
    const dispatcher: ConnectorBatchDispatcher = {
      dispatchKey: 'otlp:billing',
      async dispatch(records) {
        attempts += 1;
        if (shouldFail) {
          return {
            ok: false,
            retryable: true,
            error: 'otlp unavailable',
          };
        }

        dispatched.push(...records.map((record) => record.message));
        return { ok: true };
      },
    };

    await waitForFileFlush(50);
    delivery.enqueue(
      'otlp',
      {
        timestamp: new Date().toISOString(),
        level: 'error',
        message: 'dead letter me',
      },
      dispatcher,
      'billing'
    );

    await delivery.flush();

    expect(attempts).toBeGreaterThanOrEqual(2);
    expect(await delivery.getDurableCountForTests()).toBe(0);
    expect(await delivery.listDeadLettersForTests()).toEqual([
      expect.objectContaining({
        connectorType: 'otlp',
        connectorTarget: 'billing',
        lastError: 'otlp unavailable',
      }),
    ]);

    const statusAfterFailure = await getConnectorDeliveryStatusSummary(durableQueuePath);
    expect(statusAfterFailure).toEqual([
      expect.objectContaining({
        connectorType: 'otlp',
        connectorTarget: 'billing',
        pendingCount: 0,
        deadLetterCount: 1,
        lastError: 'otlp unavailable',
      }),
    ]);

    const deadLetters = await listConnectorDeadLetters(
      { limit: 10, offset: 0, connectorType: 'otlp', connectorTarget: 'billing' },
      durableQueuePath
    );
    expect(deadLetters.total).toBe(1);
    expect(deadLetters.items[0]?.attemptCount).toBe(2);

    shouldFail = false;
    const retriedCount = await retryConnectorDeadLetters([deadLetters.items[0]!.id], durableQueuePath);
    expect(retriedCount).toBe(1);

    await delivery.flush();

    expect(dispatched).toEqual(['dead letter me']);
    expect((await listConnectorDeadLetters({ limit: 10, offset: 0 }, durableQueuePath)).items).toHaveLength(0);

    const clearedCount = await clearConnectorDeadLetters(['missing'], durableQueuePath);
    expect(clearedCount).toBe(0);

    await delivery.shutdown();
  });

  it('replays named HTTP connector jobs using the target-specific dispatch key', async () => {
    const durableQueuePath = path.join(tempDir, '.blyp', 'queue-http.db');
    const delivery = new ConnectorDeliveryManager({
      enabled: true,
      memoryBufferSize: 10,
      durableQueuePath,
      durableSpillStrategy: 'after-first-failure',
      memoryBatchSize: 10,
      sqliteWriteBatchSize: 10,
      sqliteReadBatchSize: 10,
      dispatchConcurrency: 1,
      pollIntervalMs: 2000,
      overflowStrategy: 'drop-oldest',
      durableReady: false,
      retry: {
        maxAttempts: 4,
        initialBackoffMs: 0,
        maxBackoffMs: 0,
        multiplier: 2,
        jitter: false,
      },
    });

    const dispatched: string[] = [];
    let shouldFail = true;
    const dispatcher: ConnectorBatchDispatcher = {
      dispatchKey: 'http:webhook',
      async dispatch(records) {
        if (shouldFail) {
          shouldFail = false;
          return {
            ok: false,
            retryable: true,
            error: 'temporary http outage',
          };
        }

        dispatched.push(...records.map((record) => record.message));
        return { ok: true };
      },
    };

    await waitForFileFlush(50);
    delivery.enqueue(
      'http',
      {
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'queued http retry',
      },
      dispatcher,
      'webhook'
    );

    await waitForFileFlush(50);
    expect(await delivery.getDurableCountForTests()).toBe(1);

    await delivery.flush();

    expect(dispatched).toEqual(['queued http retry']);
    expect(await delivery.getDurableCountForTests()).toBe(0);

    await delivery.shutdown();
  });

  it('drops jobs after max attempts are exceeded in memory-only mode', async () => {
    const delivery = new ConnectorDeliveryManager({
      enabled: true,
      memoryBufferSize: 10,
      durableQueuePath: path.join(tempDir, '.blyp', 'queue.db'),
      durableSpillStrategy: 'after-first-failure',
      memoryBatchSize: 10,
      sqliteWriteBatchSize: 10,
      sqliteReadBatchSize: 10,
      dispatchConcurrency: 1,
      pollIntervalMs: 20,
      overflowStrategy: 'drop-oldest',
      durableReady: false,
      retry: {
        maxAttempts: 2,
        initialBackoffMs: 0,
        maxBackoffMs: 0,
        multiplier: 2,
        jitter: false,
      },
    });

    await delivery.shutdown();

    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(String(args[0] ?? ''));
    };

    let attempts = 0;
    const dispatcher: ConnectorBatchDispatcher = {
      dispatchKey: 'sentry',
      async dispatch() {
        attempts += 1;
        return {
          ok: false,
          retryable: true,
          error: 'still failing',
        };
      },
    };

    const memoryOnly = new ConnectorDeliveryManager({
      enabled: false,
      memoryBufferSize: 10,
      durableQueuePath: path.join(tempDir, '.blyp', 'memory-only.sqlite'),
      durableSpillStrategy: 'after-first-failure',
      memoryBatchSize: 10,
      sqliteWriteBatchSize: 10,
      sqliteReadBatchSize: 10,
      dispatchConcurrency: 1,
      pollIntervalMs: 20,
      overflowStrategy: 'drop-oldest',
      durableReady: false,
      retry: {
        maxAttempts: 2,
        initialBackoffMs: 0,
        maxBackoffMs: 0,
        multiplier: 2,
        jitter: false,
      },
    });

    memoryOnly.enqueue(
      'sentry',
      {
        timestamp: new Date().toISOString(),
        level: 'error',
        message: 'drop me',
      },
      dispatcher
    );

    await memoryOnly.flush();
    console.warn = originalWarn;

    expect(attempts).toBeGreaterThanOrEqual(2);
    expect(warnings.some((message) => message.includes('Dropped sentry connector job'))).toBe(true);

    await memoryOnly.shutdown();
  });
});
