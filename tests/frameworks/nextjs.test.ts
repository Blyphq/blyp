import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createNextJsLogger } from '../../src/frameworks/nextjs';
import { resetConfigCache } from '../../src/core/config';
import { createDrizzleDatabaseAdapter } from '../../src/database';
import { logger as rootLogger } from '../../src/frameworks/standalone';
import { createClientPayload } from '../helpers/client-payload';
import { makeTempDir, readJsonLines, waitForFileFlush } from '../helpers/fs';

describe('Next.js Integration', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir('blyp-next-');
    resetConfigCache();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    resetConfigCache();
  });

  it('wraps route handlers with a logger helper and logs requests', async () => {
    const nextLogger = createNextJsLogger({
      logDir: tempDir,
      pretty: false,
      customProps: () => ({ framework: 'nextjs' }),
    });
    let handlerTraceId = '';
    const handler = nextLogger.withLogger(async (_request, _context, { log, traceId }) => {
      handlerTraceId = traceId;
      log.info('next-route');
      return new Response('ok', { status: 200 });
    });

    const response = await handler(new Request('http://localhost/api/hello'), {});
    await waitForFileFlush();

    expect(response.status).toBe(200);
    const traceId = response.headers.get('x-blyp-trace-id');
    if (traceId === null) {
      throw new Error('missing x-blyp-trace-id header');
    }
    expect(handlerTraceId).toBe(traceId);
    expect(traceId).toMatch(/^trace_/);
    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    const requestRecord = records.find((record) => {
      const data = record.data as Record<string, unknown> | undefined;
      return data?.type === 'http_request' && data?.url === '/api/hello';
    });

    expect(records.some((record) => record.message === 'next-route')).toBe(true);
    expect((requestRecord?.data as Record<string, unknown>)?.framework).toBe('nextjs');
    expect(requestRecord?.traceId).toBe(traceId);
  });

  it('logs error responses and respects ignorePaths', async () => {
    const nextLogger = createNextJsLogger({
      logDir: tempDir,
      pretty: false,
      ignorePaths: ['/api/health'],
    });
    const ignored = nextLogger.withLogger(async () => new Response('ok', { status: 200 }));
    const failing = nextLogger.withLogger(async () => new Response('fail', { status: 500 }));

    await ignored(new Request('http://localhost/api/health'), {});
    await failing(new Request('http://localhost/api/boom'), {});
    await waitForFileFlush();

    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    expect(
      records.some((record) => (record.data as Record<string, unknown>)?.url === '/api/health')
    ).toBe(false);
    expect(
      records.some((record) => (record.data as Record<string, unknown>)?.type === 'http_error')
    ).toBe(true);
  });

  it('handles client ingestion and rejects mounted-path mismatches', async () => {
    const nextLogger = createNextJsLogger({
      logDir: tempDir,
      pretty: false,
    });

    const ok = await nextLogger.clientLogHandler(
      new Request('http://localhost/inngest', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(createClientPayload({ connector: 'posthog' })),
      })
    );
    const mismatch = await nextLogger.clientLogHandler(
      new Request('http://localhost/api/inngest', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(createClientPayload()),
      })
    );
    await waitForFileFlush();

    expect(ok.status).toBe(204);
    expect(ok.headers.get('x-blyp-posthog-status')).toBe('missing');
    expect(mismatch.status).toBe(500);
    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    expect(records.some((record) => record.message === '[client] frontend rendered')).toBe(true);
  });

  it('keeps the same trace id across next handler logs and explicit client logger handoff', async () => {
    const nextLogger = createNextJsLogger({
      logDir: tempDir,
      pretty: false,
    });

    let handlerTraceId = '';
    const handler = nextLogger.withLogger(async (_request, _context, { log, traceId }) => {
      handlerTraceId = traceId;
      log.info('next-trace-route');
      return new Response('ok', { status: 200 });
    });

    const response = await handler(new Request('http://localhost/api/trace'), {});
    const responseTraceId = response.headers.get('x-blyp-trace-id');
    if (responseTraceId === null) {
      throw new Error('missing x-blyp-trace-id header');
    }
    await nextLogger.clientLogHandler(
      new Request('http://localhost/inngest', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(createClientPayload({ traceId: responseTraceId })),
      })
    );
    await waitForFileFlush();

    expect(handlerTraceId).toBe(responseTraceId);
    expect(responseTraceId).toMatch(/^trace_/);

    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    expect(records.some((record) => record.message === 'next-trace-route' && record.traceId === responseTraceId)).toBe(true);
    expect(
      records.some((record) => record.message === '[client] frontend rendered' && record.traceId === responseTraceId)
    ).toBe(true);
  });

  it('emits one structured request record and drops mixed root logger writes', async () => {
    const warnings: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };

    const nextLogger = createNextJsLogger({
      logDir: tempDir,
      pretty: false,
      customProps: () => ({ framework: 'nextjs' }),
    });
    const handler = nextLogger.withLogger(async (_request, _context, { log }) => {
      const structured = log.createStructuredLog('checkout', { userId: 'user-1' });
      structured.set({ cartItems: 3 });
      structured.info('user logged in');
      log.info('scoped-allowed');
      rootLogger.info('root-ignored');
      structured.emit({ status: 200 });
      return new Response('ok', { status: 200 });
    });

    const response = await handler(new Request('http://localhost/api/structured', { method: 'POST' }), {});
    await waitForFileFlush();

    expect(response.status).toBe(200);
    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    const structuredRecord = records.find((record) => record.groupId === 'checkout');

    expect(structuredRecord?.method).toBe('POST');
    expect(structuredRecord?.path).toBe('/api/structured');
    expect(structuredRecord?.framework).toBe('nextjs');
    expect(records.some((record) => record.message === 'scoped-allowed')).toBe(true);
    expect(records.some((record) => record.message === 'root-ignored')).toBe(false);
    expect(
      records.some((record) => (record.data as Record<string, unknown>)?.url === '/api/structured')
    ).toBe(false);
    expect(warnings).toHaveLength(1);
    console.warn = originalWarn;
  });

  it('flushes database logs before returning responses in database mode', async () => {
    const batches: Array<Array<Record<string, unknown>>> = [];
    const table = { name: 'blypLogs' };
    const nextLogger = createNextJsLogger({
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
    const handler = nextLogger.withLogger(async () => new Response('ok', { status: 200 }));

    const startedAt = Date.now();
    const response = await handler(new Request('http://localhost/api/db-flush'), {});
    const elapsedMs = Date.now() - startedAt;

    expect(response.status).toBe(200);
    expect(elapsedMs).toBeGreaterThanOrEqual(20);
    expect(batches.flat().some((row) => {
      const record = row.record as Record<string, unknown> | undefined;
      const data = record?.data as Record<string, unknown> | undefined;
      return data?.type === 'http_request' && data?.url === '/api/db-flush';
    })).toBe(true);
  });
});
