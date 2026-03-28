import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createAstroLogger } from '../../src/frameworks/astro';
import type { AstroMiddlewareContext } from '../../src/types/frameworks/astro';
import { resetConfigCache } from '../../src/core/config';
import { createDrizzleDatabaseAdapter } from '../../src/database';
import { logger as rootLogger } from '../../src/frameworks/standalone';
import { createClientPayload } from '../helpers/client-payload';
import { makeTempDir, readJsonLines, waitForFileFlush } from '../helpers/fs';

describe('Astro Integration', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir('blyp-astro-');
    resetConfigCache();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    resetConfigCache();
  });

  function createContext(url: string, method: string = 'GET'): AstroMiddlewareContext {
    return {
      request: new Request(url, { method }),
      url: new URL(url),
      locals: {},
    };
  }

  it('attaches blypLog to locals and logs successful requests', async () => {
    const astroLogger = createAstroLogger({
      logDir: tempDir,
      pretty: false,
      customProps: () => ({ framework: 'astro' }),
    });
    const context = createContext('http://localhost/posts');

    const response = await astroLogger.onRequest(context, async () => {
      return new Response('ok', { status: 200 });
    });
    await waitForFileFlush();

    expect(response.status).toBe(200);
    const traceId = response.headers.get('x-blyp-trace-id');
    if (traceId === null) {
      throw new Error('missing x-blyp-trace-id header');
    }
    expect(context.locals.blypTraceId).toBe(traceId);
    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    const requestRecord = records.find((record) => {
      const data = record.data as Record<string, unknown> | undefined;
      return data?.type === 'http_request' && data?.url === '/posts';
    });

    expect((requestRecord?.data as Record<string, unknown>)?.framework).toBe('astro');
    expect(requestRecord?.traceId).toBe(traceId);
  });

  it('logs error responses and supports ignorePaths', async () => {
    const astroLogger = createAstroLogger({
      logDir: tempDir,
      pretty: false,
      ignorePaths: ['/health'],
    });

    await astroLogger.onRequest(createContext('http://localhost/health'), async () => new Response('ok', { status: 200 }));
    try {
      await astroLogger.onRequest(createContext('http://localhost/posts'), async () => {
        throw new Error('astro-fail');
      });
    } catch {}
    await waitForFileFlush();

    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    expect(records.some((record) => (record.data as Record<string, unknown>)?.url === '/health')).toBe(false);
    expect(records.some((record) => (record.data as Record<string, unknown>)?.type === 'http_error')).toBe(true);
  });

  it('handles client ingestion and mounted-path validation', async () => {
    const astroLogger = createAstroLogger({
      logDir: tempDir,
      pretty: false,
    });

    const ok = await astroLogger.clientLogHandler({
      request: new Request('http://localhost/inngest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(createClientPayload()),
      }),
      url: new URL('http://localhost/inngest'),
      locals: {},
    });
    const mismatch = await astroLogger.clientLogHandler({
      request: new Request('http://localhost/api/inngest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(createClientPayload()),
      }),
      url: new URL('http://localhost/api/inngest'),
      locals: {},
    });
    await waitForFileFlush();

    expect(ok.status).toBe(204);
    expect(mismatch.status).toBe(500);
    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    expect(records.some((record) => record.message === '[client] frontend rendered')).toBe(true);
  });

  it('suppresses default request logs after structured emit and drops mixed root writes', async () => {
    const warnings: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };
    try {
      const astroLogger = createAstroLogger({
        logDir: tempDir,
        pretty: false,
        customProps: () => ({ framework: 'astro' }),
      });
      const context = createContext('http://localhost/structured', 'POST') as {
        request: Request;
        url: URL;
        locals: { blypLog?: typeof rootLogger };
      };

      const response = await astroLogger.onRequest(context, async () => {
        const log = context.locals.blypLog as typeof rootLogger;
        const structured = log.createStructuredLog('checkout', { userId: 'user-1' });
        structured.set({ cartItems: 3 });
        structured.info('user logged in');
        log.info('scoped-allowed');
        rootLogger.info('root-ignored');
        structured.emit({ status: 200 });
        return new Response('ok', { status: 200 });
      });
      await waitForFileFlush();

      expect(response.status).toBe(200);
      const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
      const structuredRecord = records.find((record) => record.groupId === 'checkout');

      expect(structuredRecord?.method).toBe('POST');
      expect(structuredRecord?.path).toBe('/structured');
      expect(structuredRecord?.framework).toBe('astro');
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
    const astroLogger = createAstroLogger({
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
    const response = await astroLogger.onRequest(createContext('http://localhost/db-flush'), async () => new Response('ok', { status: 200 }));
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
