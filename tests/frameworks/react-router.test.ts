import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createReactRouterLogger } from '../../src/frameworks/react-router';
import { resetConfigCache } from '../../src/core/config';
import { createDrizzleDatabaseAdapter } from '../../src/database';
import { logger as rootLogger } from '../../src/frameworks/standalone';
import { createClientPayload } from '../helpers/client-payload';
import { makeTempDir, readJsonLines, waitForFileFlush } from '../helpers/fs';

describe('React Router Integration', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir('blyp-react-router-');
    resetConfigCache();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    resetConfigCache();
  });

  it('injects a request-scoped logger and logs successful requests', async () => {
    const reactRouterLogger = createReactRouterLogger({
      logDir: tempDir,
      pretty: false,
      customProps: () => ({ framework: 'react-router' }),
    });
    const context: Record<string, unknown> = {};
    let requestTraceId = '';

    const response = await reactRouterLogger.middleware(
      {
        request: new Request('http://localhost/posts'),
        context,
      },
      async () => {
        requestTraceId = reactRouterLogger.getTraceId(context) ?? '';
        reactRouterLogger.getLogger(context).info('react-router-route');
        return new Response('ok', { status: 200 });
      }
    );
    await waitForFileFlush();

    expect(response.status).toBe(200);
    const traceId = response.headers.get('x-blyp-trace-id');
    expect(requestTraceId).toBe(traceId);
    expect(reactRouterLogger.getTraceId(context)).toBe(traceId ?? undefined);
    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    const requestRecord = records.find((record) => {
      const data = record.data as Record<string, unknown> | undefined;
      return data?.type === 'http_request' && data?.url === '/posts';
    });

    expect(records.some((record) => record.message === 'react-router-route')).toBe(true);
    expect((requestRecord?.data as Record<string, unknown>)?.framework).toBe('react-router');
    expect(requestRecord?.traceId).toBe(traceId);
  });

  it('logs errors and respects ignorePaths', async () => {
    const reactRouterLogger = createReactRouterLogger({
      logDir: tempDir,
      pretty: false,
      ignorePaths: ['/health'],
    });

    await reactRouterLogger.middleware(
      {
        request: new Request('http://localhost/health'),
        context: {},
      },
      async () => new Response('ok', { status: 200 })
    );
    try {
      await reactRouterLogger.middleware(
        {
          request: new Request('http://localhost/boom'),
          context: {},
        },
        async () => {
          throw new Error('react-router-fail');
        }
      );
    } catch {}
    await waitForFileFlush();

    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    expect(records.some((record) => (record.data as Record<string, unknown>)?.url === '/health')).toBe(false);
    expect(records.some((record) => (record.data as Record<string, unknown>)?.type === 'http_error')).toBe(true);
  });

  it('preserves thrown error status codes in catch-path logging', async () => {
    const reactRouterLogger = createReactRouterLogger({
      logDir: tempDir,
      pretty: false,
    });

    try {
      await reactRouterLogger.middleware(
        {
          request: new Request('http://localhost/missing'),
          context: {},
        },
        async () => {
          const error = new Error('missing route') as Error & { status: number };
          error.status = 404;
          throw error;
        }
      );
    } catch {}
    await waitForFileFlush();

    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    const errorRecord = records.find((record) => {
      const data = record.data as Record<string, unknown> | undefined;
      return data?.type === 'http_error' && data?.url === '/missing';
    });

    expect((errorRecord?.data as Record<string, unknown> | undefined)?.statusCode).toBe(404);
    expect((errorRecord?.data as Record<string, unknown> | undefined)?.error).toBe('missing route');
  });

  it('handles client ingestion and mounted-path validation', async () => {
    const reactRouterLogger = createReactRouterLogger({
      logDir: tempDir,
      pretty: false,
    });

    const ok = await reactRouterLogger.clientLogHandler(
      new Request('http://localhost/inngest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(createClientPayload()),
      })
    );
    const mismatch = await reactRouterLogger.clientLogHandler(
      new Request('http://localhost/api/inngest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(createClientPayload()),
      })
    );
    await waitForFileFlush();

    expect(ok.status).toBe(204);
    expect(mismatch.status).toBe(500);
    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    expect(records.some((record) => record.message === '[client] frontend rendered')).toBe(true);
  });

  it('suppresses default request logs after a structured emit and drops mixed root writes', async () => {
    const warnings: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };
    try {
      const reactRouterLogger = createReactRouterLogger({
        logDir: tempDir,
        pretty: false,
        customProps: () => ({ framework: 'react-router' }),
      });
      const context: Record<string, unknown> = {};

      const response = await reactRouterLogger.middleware(
        {
          request: new Request('http://localhost/structured', { method: 'POST' }),
          context,
        },
        async () => {
          const log = reactRouterLogger.getLogger(context);
          const structured = log.createStructuredLog('checkout', { userId: 'user-1' });
          structured.set({ cartItems: 3 });
          structured.info('user logged in');
          log.info('scoped-allowed');
          rootLogger.info('root-ignored');
          structured.emit({ status: 200 });
          return new Response('ok', { status: 200 });
        }
      );
      await waitForFileFlush();

      expect(response.status).toBe(200);
      const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
      const structuredRecord = records.find((record) => record.groupId === 'checkout');

      expect(structuredRecord?.method).toBe('POST');
      expect(structuredRecord?.path).toBe('/structured');
      expect(structuredRecord?.framework).toBe('react-router');
      expect(records.some((record) => record.message === 'scoped-allowed')).toBe(true);
      expect(records.some((record) => record.message === 'root-ignored')).toBe(false);
      expect(records.some((record) => (record.data as Record<string, unknown>)?.url === '/structured')).toBe(false);
      expect(warnings).toHaveLength(1);
    } finally {
      console.warn = originalWarn;
    }
  });

  it('flushes database logs before middleware resolves in database mode', async () => {
    const batches: Array<Array<Record<string, unknown>>> = [];
    const table = { name: 'blypLogs' };
    const reactRouterLogger = createReactRouterLogger({
      pretty: false,
      destination: 'database',
      database: {
        dialect: 'postgres',
        adapter: createDrizzleDatabaseAdapter({
          db: {
            insert(target: unknown) {
              expect(target).toBe(table);
              return {
                async values(rows: Array<Record<string, unknown>>) {
                  await new Promise((resolve) => setTimeout(resolve, 25));
                  batches.push(rows);
                },
              };
            },
          },
          table,
        }),
      },
    });

    const startedAt = Date.now();
    const response = await reactRouterLogger.middleware(
      {
        request: new Request('http://localhost/db-flush'),
        context: {},
      },
      async () => new Response('ok', { status: 200 })
    );
    const elapsedMs = Date.now() - startedAt;

    expect(response.status).toBe(200);
    expect(elapsedMs).toBeGreaterThanOrEqual(20);
    expect(batches.flat().some((row) => {
      const record = row.record as Record<string, unknown> | undefined;
      const data = record?.data as Record<string, unknown> | undefined;
      return data?.type === 'http_request' && data?.url === '/db-flush';
    })).toBe(true);
  });
});
