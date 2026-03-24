import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createNitroLogger } from '../../src/frameworks/nitro';
import type { NitroEventLike, NitroLoggerPlugin } from '../../src/types/frameworks/nitro';
import { resetConfigCache } from '../../src/core/config';
import { createDrizzleDatabaseAdapter } from '../../src/database';
import { logger as rootLogger } from '../../src/frameworks/standalone';
import { createClientPayload } from '../helpers/client-payload';
import { makeTempDir, readJsonLines, waitForFileFlush } from '../helpers/fs';

type HookMap = Map<string, Array<(...args: unknown[]) => unknown>>;

async function registerPlugin(plugin: NitroLoggerPlugin): Promise<HookMap> {
  const hooks: HookMap = new Map();
  await plugin({
    hooks: {
      hook(name, callback) {
        const existing = hooks.get(name) ?? [];
        existing.push(callback);
        hooks.set(name, existing);
      },
    },
  });
  return hooks;
}

async function runHooks(hooks: HookMap, name: string, ...args: unknown[]): Promise<void> {
  for (const callback of hooks.get(name) ?? []) {
    await callback(...args);
  }
}

function createEvent(url: string, method: string = 'GET', body?: unknown): NitroEventLike {
  return {
    request: new Request(url, body === undefined
      ? { method }
      : {
          method,
          headers: { 'content-type': 'application/json' },
          body: typeof body === 'string' ? body : JSON.stringify(body),
        }),
    context: {},
    node: {
      res: { statusCode: 200 },
    },
    body,
  };
}

describe('Nitro Integration', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir('blyp-nitro-');
    resetConfigCache();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    resetConfigCache();
  });

  it('attaches blypLog in request hooks and logs successful responses', async () => {
    const nitroLogger = createNitroLogger({
      logDir: tempDir,
      pretty: false,
      customProps: () => ({ framework: 'nitro' }),
    });
    const hooks = await registerPlugin(nitroLogger.plugin);
    const event = createEvent('http://localhost/posts');

    await runHooks(hooks, 'request', event);
    expect(event.context.blypLog).toBeDefined();
    nitroLogger.getLogger(event).info('nitro-route');
    const response = new Response('ok', { status: 200 });
    await runHooks(hooks, 'beforeResponse', event, response);
    await runHooks(hooks, 'afterResponse', event);
    await waitForFileFlush();

    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    const requestRecord = records.find((record) => {
      const data = record.data as Record<string, unknown> | undefined;
      return data?.type === 'http_request' && data?.url === '/posts';
    });

    expect(records.some((record) => record.message === 'nitro-route')).toBe(true);
    expect((requestRecord?.data as Record<string, unknown>)?.framework).toBe('nitro');
  });

  it('logs errors and supports ignorePaths', async () => {
    const nitroLogger = createNitroLogger({
      logDir: tempDir,
      pretty: false,
      ignorePaths: ['/health'],
    });
    const hooks = await registerPlugin(nitroLogger.plugin);

    const healthEvent = createEvent('http://localhost/health');
    await runHooks(hooks, 'request', healthEvent);
    await runHooks(hooks, 'beforeResponse', healthEvent, new Response('ok', { status: 200 }));
    await runHooks(hooks, 'afterResponse', healthEvent);

    const failingEvent = createEvent('http://localhost/posts');
    await runHooks(hooks, 'request', failingEvent);
    await runHooks(hooks, 'error', new Error('nitro-fail'), failingEvent);
    await runHooks(hooks, 'afterResponse', failingEvent);
    await waitForFileFlush();

    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    expect(records.some((record) => (record.data as Record<string, unknown>)?.url === '/health')).toBe(false);
    expect(records.some((record) => (record.data as Record<string, unknown>)?.type === 'http_error')).toBe(true);
  });

  it('handles client ingestion and mounted-path validation', async () => {
    const nitroLogger = createNitroLogger({
      logDir: tempDir,
      pretty: false,
    });

    const ok = await nitroLogger.clientLogHandler(
      createEvent('http://localhost/inngest', 'POST', createClientPayload())
    );
    const mismatch = await nitroLogger.clientLogHandler(
      createEvent('http://localhost/api/inngest', 'POST', createClientPayload())
    );
    await waitForFileFlush();

    expect(ok.status).toBe(204);
    expect(mismatch.status).toBe(500);
    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    expect(records.some((record) => record.message === '[client] frontend rendered')).toBe(true);
  });

  it('reads a stream-backed client log body once during ingestion', async () => {
    const nitroLogger = createNitroLogger({
      logDir: tempDir,
      pretty: false,
    });

    const payload = createClientPayload();
    const event: NitroEventLike = {
      request: new Request('http://localhost/inngest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      }),
      context: {},
      node: {
        res: { statusCode: 200 },
      },
    };

    const response = await nitroLogger.clientLogHandler(event);
    await waitForFileFlush();

    expect(response.status).toBe(204);
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
      const nitroLogger = createNitroLogger({
        logDir: tempDir,
        pretty: false,
        customProps: () => ({ framework: 'nitro' }),
      });
      const hooks = await registerPlugin(nitroLogger.plugin);
      const event = createEvent('http://localhost/structured', 'POST');

      await runHooks(hooks, 'request', event);
      const log = nitroLogger.getLogger(event) as typeof rootLogger;
      const structured = log.createStructuredLog('checkout', { userId: 'user-1' });
      structured.set({ cartItems: 3 });
      structured.info('user logged in');
      log.info('scoped-allowed');
      rootLogger.info('root-ignored');
      structured.emit({ status: 200 });
      await runHooks(hooks, 'beforeResponse', event, new Response('ok', { status: 200 }));
      await runHooks(hooks, 'afterResponse', event);
      await waitForFileFlush();

      const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
      const structuredRecord = records.find((record) => record.groupId === 'checkout');

      expect(structuredRecord?.method).toBe('POST');
      expect(structuredRecord?.path).toBe('/structured');
      expect(structuredRecord?.framework).toBe('nitro');
      expect(records.some((record) => record.message === 'scoped-allowed')).toBe(true);
      expect(records.some((record) => record.message === 'root-ignored')).toBe(false);
      expect(records.some((record) => (record.data as Record<string, unknown>)?.url === '/structured')).toBe(false);
      expect(warnings).toHaveLength(1);
    } finally {
      console.warn = originalWarn;
    }
  });

  it('flushes database logs during lifecycle finalization in database mode', async () => {
    const batches: Array<Array<Record<string, unknown>>> = [];
    const table = { name: 'blypLogs' };
    const nitroLogger = createNitroLogger({
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
    const hooks = await registerPlugin(nitroLogger.plugin);
    const event = createEvent('http://localhost/db-flush');

    const startedAt = Date.now();
    await runHooks(hooks, 'request', event);
    await runHooks(hooks, 'beforeResponse', event, new Response('ok', { status: 200 }));
    await runHooks(hooks, 'afterResponse', event);
    const elapsedMs = Date.now() - startedAt;

    expect(elapsedMs).toBeGreaterThanOrEqual(20);
    expect(batches.flat().some((row) => {
      const record = row.record as Record<string, unknown> | undefined;
      const data = record?.data as Record<string, unknown> | undefined;
      return data?.type === 'http_request' && data?.url === '/db-flush';
    })).toBe(true);
  });
});
