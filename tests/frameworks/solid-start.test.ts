import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createSolidStartLogger } from '../../src/frameworks/solid-start';
import type {
  SolidStartAPIEvent,
  SolidStartFetchEvent,
} from '../../src/types/frameworks/solid-start';
import { resetConfigCache } from '../../src/core/config';
import { createDrizzleDatabaseAdapter } from '../../src/database';
import { logger as rootLogger } from '../../src/frameworks/standalone';
import { createClientPayload } from '../helpers/client-payload';
import { makeTempDir, readJsonLines, waitForFileFlush } from '../helpers/fs';

describe('SolidStart Integration', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir('blyp-solid-start-');
    resetConfigCache();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    resetConfigCache();
  });

  function createFetchEvent(url: string, method: string = 'GET'): SolidStartFetchEvent {
    return {
      request: new Request(url, { method }),
      response: {
        status: 200,
        headers: new Headers(),
      },
      locals: {},
      nativeEvent: {},
    };
  }

  function createApiEvent(url: string, method: string = 'POST'): SolidStartAPIEvent {
    return {
      ...createFetchEvent(url, method),
      params: {},
      fetch,
    };
  }

  it('attaches blypLog to locals and logs successful requests', async () => {
    const solidLogger = createSolidStartLogger({
      logDir: tempDir,
      pretty: false,
      customProps: () => ({ framework: 'solid-start' }),
    });
    const event = createFetchEvent('http://localhost/posts');

    solidLogger.middleware.onRequest(event);
    (event.locals.blypLog as { info(message: string): void }).info('solid-route');
    event.response.status = 200;
    await solidLogger.middleware.onBeforeResponse(event);
    await waitForFileFlush();

    const traceId = event.response.headers.get('x-blyp-trace-id');
    if (traceId === null) {
      throw new Error('missing x-blyp-trace-id header');
    }
    expect(traceId).toMatch(/^trace_/);
    expect(event.locals.blypTraceId).toBe(traceId);
    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    const requestRecord = records.find((record) => {
      const data = record.data as Record<string, unknown> | undefined;
      return data?.type === 'http_request' && data?.url === '/posts';
    });

    expect(records.some((record) => record.message === 'solid-route')).toBe(true);
    expect((requestRecord?.data as Record<string, unknown>)?.framework).toBe('solid-start');
    expect(requestRecord?.traceId).toBe(traceId);
  });

  it('logs error responses and respects ignorePaths', async () => {
    const solidLogger = createSolidStartLogger({
      logDir: tempDir,
      pretty: false,
      ignorePaths: ['/health'],
    });

    const ignored = createFetchEvent('http://localhost/health');
    solidLogger.middleware.onRequest(ignored);
    ignored.response.status = 200;
    await solidLogger.middleware.onBeforeResponse(ignored);

    const failing = createFetchEvent('http://localhost/posts');
    solidLogger.middleware.onRequest(failing);
    failing.response.status = 500;
    await solidLogger.middleware.onBeforeResponse(failing);
    await waitForFileFlush();

    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    expect(
      records.some((record) => (record.data as Record<string, unknown>)?.url === '/health')
    ).toBe(false);
    expect(
      records.some((record) => (record.data as Record<string, unknown>)?.type === 'http_error')
    ).toBe(true);
  });

  it('handles client ingestion and mounted-path validation', async () => {
    const solidLogger = createSolidStartLogger({
      logDir: tempDir,
      pretty: false,
    });

    const ok = await solidLogger.clientLogHandler({
      ...createApiEvent('http://localhost/inngest'),
      request: new Request('http://localhost/inngest', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(createClientPayload()),
      }),
    });
    const mismatch = await solidLogger.clientLogHandler({
      ...createApiEvent('http://localhost/api/inngest'),
      request: new Request('http://localhost/api/inngest', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(createClientPayload()),
      }),
    });
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
      const solidLogger = createSolidStartLogger({
        logDir: tempDir,
        pretty: false,
        customProps: () => ({ framework: 'solid-start' }),
      });
      const event = createFetchEvent('http://localhost/structured', 'POST');

      solidLogger.middleware.onRequest(event);
      const log = event.locals.blypLog as typeof rootLogger;
      const structured = log.createStructuredLog('checkout', { userId: 'user-1' });
      structured.set({ cartItems: 3 });
      structured.info('user logged in');
      log.info('scoped-allowed');
      rootLogger.info('root-ignored');
      structured.emit({ status: 200 });
      event.response.status = 200;
      await solidLogger.middleware.onBeforeResponse(event);
      await waitForFileFlush();

      const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
      const structuredRecord = records.find((record) => record.groupId === 'checkout');

      expect(structuredRecord?.method).toBe('POST');
      expect(structuredRecord?.path).toBe('/structured');
      expect(structuredRecord?.framework).toBe('solid-start');
      expect(records.some((record) => record.message === 'scoped-allowed')).toBe(true);
      expect(records.some((record) => record.message === 'root-ignored')).toBe(false);
      expect(
        records.some((record) => (record.data as Record<string, unknown>)?.url === '/structured')
      ).toBe(false);
      expect(warnings).toHaveLength(1);
    } finally {
      console.warn = originalWarn;
    }
  });

  it('flushes database logs before middleware finalization resolves in database mode', async () => {
    const batches: Array<Array<Record<string, unknown>>> = [];
    const table = { name: 'blypLogs' };
    const solidLogger = createSolidStartLogger({
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
    const event = createFetchEvent('http://localhost/db-flush');

    solidLogger.middleware.onRequest(event);
    event.response.status = 200;
    const startedAt = Date.now();
    await solidLogger.middleware.onBeforeResponse(event);
    const elapsedMs = Date.now() - startedAt;

    expect(elapsedMs).toBeGreaterThanOrEqual(20);
    expect(
      batches.flat().some((row) => {
        const record = row.record as Record<string, unknown> | undefined;
        const data = record?.data as Record<string, unknown> | undefined;
        return data?.type === 'http_request' && data?.url === '/db-flush';
      })
    ).toBe(true);
  });
});
