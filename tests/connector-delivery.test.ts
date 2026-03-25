import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { ConnectorDeliveryManager } from '../src/connectors/delivery/manager';
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
    const durableQueuePath = path.join(tempDir, '.blyp', 'connectors.sqlite');
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

    await delivery.flush();

    expect(dispatched).toEqual(['queued for retry']);
    expect(await delivery.getDurableCountForTests()).toBe(0);

    await delivery.shutdown();
  });

  it('drops jobs after max attempts are exceeded in memory-only mode', async () => {
    const delivery = new ConnectorDeliveryManager({
      enabled: true,
      memoryBufferSize: 10,
      durableQueuePath: path.join(tempDir, '.blyp', 'connectors.sqlite'),
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
