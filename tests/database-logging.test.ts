import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createDrizzleDatabaseAdapter, createPrismaDatabaseAdapter } from '../src/database';
import { createStandaloneLogger } from '../src/frameworks/standalone';
import { toDatabaseLogRow } from '../src/database/helpers';
import type { DatabaseLogRow } from '../src/types/database';
import { resetConfigCache } from '../src/core/config';
import { makeTempDir } from './helpers/fs';

function wait(duration: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, duration));
}

function createDrizzleRuntime(options: { delayMs?: number } = {}) {
  const batches: DatabaseLogRow[][] = [];
  const table = { name: 'blypLogs' };
  const db = {
    insert(target: unknown) {
      expect(target).toBe(table);
      return {
        async values(rows: DatabaseLogRow | DatabaseLogRow[]) {
          if (options.delayMs) {
            await wait(options.delayMs);
          }

          batches.push(Array.isArray(rows) ? rows : [rows]);
        },
      };
    },
  };

  return {
    db,
    table,
    batches,
    get rows() {
      return batches.flat();
    },
  };
}

function createPrismaRuntime(options: { createManyFails?: boolean } = {}) {
  const createManyCalls: DatabaseLogRow[][] = [];
  const createCalls: DatabaseLogRow[] = [];
  const delegate = {
    async create(args: { data: DatabaseLogRow }) {
      createCalls.push(args.data);
    },
    async createMany(args: { data: DatabaseLogRow[] }) {
      if (options.createManyFails) {
        throw new Error('createMany not supported by this adapter');
      }

      createManyCalls.push(args.data);
    },
  };

  const client = {
    blypLog: delegate,
    async $transaction(operations: Array<Promise<unknown>>) {
      await Promise.all(operations);
    },
  };

  return {
    client,
    createManyCalls,
    createCalls,
  };
}

describe('Database logging', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tempDir = makeTempDir('blyp-db-');
    resetConfigCache();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
    resetConfigCache();
  });

  it('maps records into normalized database rows', () => {
    const row = toDatabaseLogRow({
      timestamp: 'invalid-date',
      level: 'error',
      message: 'boom',
      caller: 'app.ts:12',
      type: 'http_error',
      traceId: 'trace_84f2',
      groupId: 'checkout',
      method: 'POST',
      path: '/orders',
      status: 500,
      duration: 42,
      data: { orderId: 'ord_1' },
      bindings: { requestId: 'req_1' },
      error: { message: 'boom' },
      events: [{ message: 'start' }],
    });

    expect(row.message).toBe('boom');
    expect(row.type).toBe('http_error');
    expect(row.traceId).toBe('trace_84f2');
    expect(row.groupId).toBe('checkout');
    expect(row.hasError).toBe(true);
    expect(row.timestamp).toBeInstanceOf(Date);
    expect(Number.isNaN(row.timestamp.getTime())).toBe(false);
    expect(row.record.path).toBe('/orders');
  });

  it('writes standalone logs to a drizzle database and shares the sink across child loggers', async () => {
    const runtime = createDrizzleRuntime();
    const logger = createStandaloneLogger({
      pretty: false,
      destination: 'database',
      logDir: tempDir,
      database: {
        dialect: 'postgres',
        adapter: createDrizzleDatabaseAdapter({
          db: runtime.db,
          table: runtime.table,
        }),
      },
    });

    logger.info('root-message', { requestId: 'req_1' });
    logger.child({ service: 'payments' }).error('child-message');
    await logger.flush();

    expect(runtime.rows).toHaveLength(2);
    expect(runtime.rows.map((row) => row.message)).toEqual(['root-message', 'child-message']);
    expect(runtime.rows.every((row) => row.traceId === null)).toBe(true);
    expect(runtime.rows[1]?.bindings).toMatchObject({ service: 'payments' });
    expect(fs.existsSync(path.join(tempDir, 'log.ndjson'))).toBe(false);
  });

  it('drops the oldest queued database logs when the queue overflows', async () => {
    const runtime = createDrizzleRuntime();
    const logger = createStandaloneLogger({
      pretty: false,
      destination: 'database',
      database: {
        dialect: 'postgres',
        adapter: createDrizzleDatabaseAdapter({
          db: runtime.db,
          table: runtime.table,
        }),
        delivery: {
          strategy: 'batch',
          batchSize: 10,
          flushIntervalMs: 1000,
          maxQueueSize: 2,
          overflowStrategy: 'drop-oldest',
        },
      },
    });

    logger.info('first');
    logger.info('second');
    logger.info('third');
    await logger.flush();

    expect(runtime.rows.map((row) => row.message)).toEqual(['second', 'third']);
  });

  it('falls back from prisma createMany to transactional create calls', async () => {
    const runtime = createPrismaRuntime({ createManyFails: true });
    const logger = createStandaloneLogger({
      pretty: false,
      destination: 'database',
      database: {
        dialect: 'mysql',
        adapter: createPrismaDatabaseAdapter({
          client: runtime.client,
        }),
        delivery: {
          strategy: 'batch',
          batchSize: 10,
        },
      },
    });

    logger.info('alpha');
    logger.info('beta');
    await logger.flush();

    expect(runtime.createManyCalls).toHaveLength(0);
    expect(runtime.createCalls.map((row) => row.message)).toEqual(['alpha', 'beta']);
  });

  it('stops accepting writes after shutdown', async () => {
    const runtime = createDrizzleRuntime();
    const logger = createStandaloneLogger({
      pretty: false,
      destination: 'database',
      database: {
        dialect: 'postgres',
        adapter: createDrizzleDatabaseAdapter({
          db: runtime.db,
          table: runtime.table,
        }),
      },
    });

    logger.info('before-shutdown');
    await logger.shutdown();
    logger.info('after-shutdown');
    await logger.flush();

    expect(runtime.rows.map((row) => row.message)).toEqual(['before-shutdown']);
  });
});
