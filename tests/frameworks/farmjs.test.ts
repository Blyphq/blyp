import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  PluginManager,
  emitFarmEvent,
  type FarmPlugin,
} from '@farm.js/core';
import { blypPlugin } from '../../src/frameworks/farmjs';
import { resetConfigCache } from '../../src/core/config';
import { createDrizzleDatabaseAdapter } from '../../src/database';
import { createClientPayload } from '../helpers/client-payload';
import { makeTempDir, readJsonLines, waitForFileFlush } from '../helpers/fs';

function createManager(plugin: FarmPlugin): PluginManager {
  const manager = new PluginManager({
    config: {},
    isDev: false,
    isProd: true,
  });
  manager.addPlugin(plugin);
  return manager;
}

function requestRecords(records: Array<Record<string, unknown>>) {
  return records.filter((record) => {
    const data = record.data as Record<string, unknown> | undefined;
    return data?.type === 'http_request' || data?.type === 'http_error';
  });
}

async function runWithPluginContext(
  manager: PluginManager,
  request: Request,
  handler: (request: Request, context: Record<string, any>) => Response | Promise<Response>,
  options: Parameters<PluginManager['beginRuntimeRequest']>[1]
): Promise<Response> {
  const session = await manager.beginRuntimeRequest(request, options);
  try {
    const response = session.response ?? await handler(session.request, session.ctx);
    return await manager.endRuntimeRequest(session, response);
  } catch (error) {
    await manager.failRuntimeRequest(session, error);
    throw error;
  }
}

describe('Farm.js integration', () => {
  let tempDir: string;
  const managers: PluginManager[] = [];

  beforeEach(() => {
    tempDir = makeTempDir('blyp-farmjs-');
    resetConfigCache();
  });

  afterEach(async () => {
    for (const manager of managers.splice(0)) {
      await manager.closeRuntime('test');
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
    resetConfigCache();
  });

  async function start(plugin: FarmPlugin): Promise<PluginManager> {
    const manager = createManager(plugin);
    managers.push(manager);
    await manager.setupPlugins();
    await manager.startRuntime();
    return manager;
  }

  it('adds a request logger, propagates traces, and preserves the response body', async () => {
    const manager = await start(blypPlugin({
      logDir: tempDir,
      pretty: false,
      telemetry: false,
      customProps: (ctx) => ({ runtimeKind: ctx.kind }),
      auth: {
        betterAuth: {
          api: {
            async getSession() {
              return {
                session: { id: 'farm_session' },
                user: { id: 'farm_user', email: 'farm@example.com' },
              };
            },
          },
        },
      },
    }));
    let handlerTraceId = '';

    const response = await runWithPluginContext(
      manager,
      new Request('http://localhost/products/42', {
        headers: { 'x-blyp-trace-id': 'trace_incoming' },
      }),
      async (_request, context) => {
        context.blypLog.info('farm-handler');
        const structured = context.blypLog.createStructuredLog('farm-request', { feature: 'catalog' });
        structured.info('catalog loaded');
        structured.emit();
        handlerTraceId = 'trace_incoming';
        return new Response('farm-ok', {
          status: 201,
          headers: { 'x-app': 'farm' },
        });
      },
      { kind: 'page', route: { pathname: '/products/42', pattern: '/products/[id]' } }
    );

    expect(await response.text()).toBe('farm-ok');
    expect(response.status).toBe(201);
    expect(response.headers.get('x-app')).toBe('farm');
    expect(response.headers.get('x-blyp-trace-id')).toBe(handlerTraceId);
    await waitForFileFlush();

    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    const handlerRecord = records.find((record) => record.message === 'farm-handler');
    expect(handlerRecord?.traceId).toBe('trace_incoming');
    expect(handlerRecord?.auth).toMatchObject({
      provider: 'better-auth',
      authenticated: true,
      actor: { id: 'farm_user' },
    });
    expect(records.some((record) => record.groupId === 'farm-request' && record.traceId === 'trace_incoming')).toBe(true);
    expect(requestRecords(records)).toHaveLength(0);
  });

  it('emits standard request and error records and respects ignored paths', async () => {
    const manager = await start(blypPlugin({
      logDir: tempDir,
      pretty: false,
      telemetry: false,
      ignorePaths: ['/health'],
    }));

    await manager.runRuntimeRequest(
      new Request('http://localhost/health'),
      async () => new Response('ok'),
      { kind: 'api', route: { pathname: '/health', pattern: '/health' } }
    );
    const failedResponse = await manager.runRuntimeRequest(
      new Request('http://localhost/api/fail', { method: 'POST' }),
      async () => new Response('failed', { status: 503 }),
      { kind: 'api', route: { pathname: '/api/fail', pattern: '/api/fail' } }
    );
    expect(failedResponse.status).toBe(503);

    await expect(manager.runRuntimeRequest(
      new Request('http://localhost/api/throw'),
      async () => {
        throw new Error('farm exploded');
      },
      { kind: 'api', route: { pathname: '/api/throw', pattern: '/api/throw' } }
    )).rejects.toThrow('farm exploded');
    await waitForFileFlush();

    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    const requests = requestRecords(records);
    expect(requests.some((record) => (record.data as any)?.url === '/health')).toBe(false);
    expect(requests.filter((record) => (record.data as any)?.url === '/api/fail')).toHaveLength(1);
    expect(requests.filter((record) => (record.data as any)?.url === '/api/throw')).toHaveLength(1);
    expect((requests.find((record) => (record.data as any)?.url === '/api/fail')?.data as any)?.farm).toMatchObject({
      kind: 'api',
      route: '/api/fail',
    });
  });

  it('isolates concurrent request loggers and trace ids', async () => {
    const manager = await start(blypPlugin({
      logDir: tempDir,
      pretty: false,
      telemetry: false,
    }));

    const run = (id: string, delay: number) => runWithPluginContext(
      manager,
      new Request(`http://localhost/concurrent/${id}`, {
        headers: { 'x-blyp-trace-id': `trace_${id}` },
      }),
      async (_request, context) => {
        await new Promise((resolve) => setTimeout(resolve, delay));
        context.blypLog.info(`request-${id}`);
        return new Response(id);
      },
      { kind: 'page', route: { pathname: `/concurrent/${id}`, pattern: '/concurrent/[id]' } }
    );

    await Promise.all([run('one', 10), run('two', 0)]);
    await waitForFileFlush();
    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    expect(records.find((record) => record.message === 'request-one')?.traceId).toBe('trace_one');
    expect(records.find((record) => record.message === 'request-two')?.traceId).toBe('trace_two');
  });

  it('short-circuits browser ingestion without invoking the route handler', async () => {
    const manager = await start(blypPlugin({
      logDir: tempDir,
      pretty: false,
      telemetry: { events: false, browser: true },
    }));
    let handled = false;

    const response = await manager.runRuntimeRequest(
      new Request('http://localhost/inngest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(createClientPayload({ message: 'farm browser event' })),
      }),
      async () => {
        handled = true;
        return new Response('unexpected');
      },
      { kind: 'api', route: { pathname: '/inngest', pattern: '/inngest' } }
    );

    expect(handled).toBe(false);
    expect(response.status).toBe(204);
    expect(response.headers.get('x-blyp-trace-id')).toMatch(/^trace_/);
    await waitForFileFlush();
    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    expect(records.some((record) => record.message === '[client] farm browser event')).toBe(true);
    expect(requestRecords(records)).toHaveLength(0);
  });

  it('forwards curated Farm events but never duplicates request events', async () => {
    const manager = await start(blypPlugin({
      logDir: tempDir,
      pretty: false,
      telemetry: { events: 'curated', browser: false },
    }));

    emitFarmEvent({ type: 'server.ready', url: 'http://localhost:9000' });
    emitFarmEvent({ type: 'cache.hit', key: 'home' });
    emitFarmEvent({
      type: 'request.complete',
      method: 'GET',
      pathname: '/',
      status: 200,
      durationMs: 1,
    });
    emitFarmEvent({ type: 'middleware.error', name: 'auth', error: new Error('denied') });
    await waitForFileFlush();

    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    expect(records.some((record) => record.message === '[farm] server.ready')).toBe(true);
    expect(records.some((record) => record.message === '[farm] middleware.error')).toBe(true);
    expect(records.some((record) => record.message === '[farm] cache.hit')).toBe(false);
    expect(records.some((record) => record.message === '[farm] request.complete')).toBe(false);
  });

  it('supports all, explicit, and disabled Farm event forwarding', async () => {
    const allDir = path.join(tempDir, 'all');
    const explicitDir = path.join(tempDir, 'explicit');
    const disabledDir = path.join(tempDir, 'disabled');
    const allManager = await start(blypPlugin({
      logDir: allDir,
      pretty: false,
      telemetry: { events: 'all', browser: false },
    }));
    const explicitManager = await start(blypPlugin({
      logDir: explicitDir,
      pretty: false,
      telemetry: { events: ['cache.miss'], browser: false },
    }));
    const disabledManager = await start(blypPlugin({
      logDir: disabledDir,
      pretty: false,
      telemetry: false,
    }));

    expect(allManager).toBeDefined();
    expect(explicitManager).toBeDefined();
    expect(disabledManager).toBeDefined();
    emitFarmEvent({ type: 'cache.hit', key: 'home' });
    emitFarmEvent({ type: 'cache.miss', key: 'products' });
    emitFarmEvent({
      type: 'request.complete',
      method: 'GET',
      pathname: '/',
      status: 200,
      durationMs: 1,
    });
    await waitForFileFlush();

    const allRecords = readJsonLines(path.join(allDir, 'log.ndjson'));
    const explicitRecords = readJsonLines(path.join(explicitDir, 'log.ndjson'));
    const disabledRecords = readJsonLines(path.join(disabledDir, 'log.ndjson'));
    expect(allRecords.some((record) => record.message === '[farm] cache.hit')).toBe(true);
    expect(allRecords.some((record) => record.message === '[farm] cache.miss')).toBe(true);
    expect(allRecords.some((record) => record.message === '[farm] request.complete')).toBe(false);
    expect(explicitRecords.some((record) => record.message === '[farm] cache.hit')).toBe(false);
    expect(explicitRecords.some((record) => record.message === '[farm] cache.miss')).toBe(true);
    expect(disabledRecords.some((record) => String(record.message).startsWith('[farm]'))).toBe(false);
  });

  it('rejects edge-only presets and invalid browser sampling', () => {
    expect(() => blypPlugin({ telemetry: { browser: { sampleRate: 2 } } })).toThrow('between 0 and 1');
    const plugin = blypPlugin({ telemetry: false });
    expect(() => plugin.configure?.(
      { preset: 'cloudflare' } as any,
      {} as any
    )).toThrow('currently supports Node and Bun');
  });

  it('flushes database-backed request logs before completing the response', async () => {
    const batches: Array<Array<Record<string, unknown>>> = [];
    const table = { name: 'blypLogs' };
    const manager = await start(blypPlugin({
      pretty: false,
      destination: 'database',
      telemetry: false,
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
    }));

    const startedAt = Date.now();
    const response = await manager.runRuntimeRequest(
      new Request('http://localhost/database'),
      async () => new Response('ok'),
      { kind: 'api', route: { pathname: '/database', pattern: '/database' } }
    );

    expect(response.status).toBe(200);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(20);
    expect(batches.flat().some((row) => {
      const record = row.record as Record<string, unknown> | undefined;
      const data = record?.data as Record<string, unknown> | undefined;
      return data?.type === 'http_request' && data.url === '/database';
    })).toBe(true);
  });
});

describe('Farm.js client telemetry hooks', () => {
  it('emits sampled lifecycle data, unsampled errors, and filters resource timings', async () => {
    const plugin = blypPlugin({ telemetry: { browser: { sampleRate: 1 } } });
    const client = plugin.client!;
    const calls: Array<{ level: string; message: string; data: any }> = [];
    const state = {
      sampled: true,
      logger: {
        info(message: string, data: unknown) {
          calls.push({ level: 'info', message, data });
        },
        debug(message: string, data: unknown) {
          calls.push({ level: 'debug', message, data });
        },
        error(message: string, data: unknown) {
          calls.push({ level: 'error', message, data });
        },
      },
    };
    const publicConfig = client.public as any;
    const location = { href: 'https://app.test/products?secret=1', pathname: '/products', search: '?secret=1', hash: '' };

    await client.hydration?.after?.({ state, public: publicConfig, mode: 'hydrate', location, durationMs: 12, recovered: false } as any);
    await client.navigation?.rendered?.({
      state,
      public: publicConfig,
      id: 'nav_1',
      to: location,
      action: 'push',
      route: { pattern: '/products' },
      durationMs: 20,
    } as any);
    await client.navigation?.error?.({
      state: { ...state, sampled: false },
      public: publicConfig,
      id: 'nav_2',
      from: null,
      to: location,
      action: 'push',
      route: { pattern: '/products' },
      signal: new AbortController().signal,
      startedAt: 1,
      durationMs: 5,
      error: new DOMException('cancelled', 'AbortError'),
    } as any);
    await client.performance?.({
      state,
      public: publicConfig,
      location,
      entry: { entryType: 'resource', name: 'https://api.test?token=secret', startTime: 1, duration: 2 },
    } as any);
    await client.performance?.({
      state,
      public: publicConfig,
      location,
      entry: {
        entryType: 'largest-contentful-paint',
        name: 'https://app.test/products?performance-secret=1',
        startTime: 33,
        duration: 0,
      },
    } as any);
    await client.error?.({
      state: { ...state, sampled: false },
      public: publicConfig,
      error: new Error('browser failed'),
      phase: 'window',
      location,
    } as any);

    expect(calls.map((call) => call.message)).toEqual([
      '[farm] client.hydration.complete',
      '[farm] client.navigation.rendered',
      '[farm] client.navigation.error',
      '[farm] client.performance',
      '[farm] client.error',
    ]);
    expect(JSON.stringify(calls)).not.toContain('secret=1');
    expect(JSON.stringify(calls)).not.toContain('token=secret');
    expect(JSON.stringify(calls)).not.toContain('performance-secret');
  });
});
