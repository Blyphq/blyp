import fs from 'fs';
import path from 'path';
import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createError } from '../src/core/errors';
import { resetConfigCache, resolveConfig } from '../src/core/config';
import type { ResolvedDatabuddyConnectorConfig } from '../src/types/core/config';
import {
  createDatabuddySender,
  resetDatabuddyTestHooks,
  setDatabuddyTestHooks,
} from '../src/connectors/databuddy/sender';
import { ConnectorDeliveryManager } from '../src/connectors/delivery/manager';
import { CONNECTOR_BATCH_DISPATCH } from '../src/connectors/delivery/types';
import {
  captureDatabuddyException,
  createDatabuddyErrorTracker,
  createDatabuddyLogger,
  createStructuredDatabuddyLogger,
} from '../src/connectors/databuddy';
import {
  createRequestLike,
  emitHttpErrorLog,
  handleClientLogIngestion,
  resolveServerLogger,
} from '../src/frameworks/shared';
import { createStandaloneLogger } from '../src/frameworks/standalone';
import { createClientPayload } from './helpers/client-payload';
import { makeTempDir, readJsonLines, waitForFileFlush } from './helpers/fs';

function createFakeDatabuddyRuntime() {
  const initConfigs: Array<Record<string, unknown>> = [];
  const events: Array<{
    name: string;
    properties?: Record<string, unknown>;
    anonymousId?: string;
    sessionId?: string;
  }> = [];
  let flushCalls = 0;

  return {
    initConfigs,
    events,
    get flushCalls() {
      return flushCalls;
    },
    hooks: {
      createClient: (config: ResolvedDatabuddyConnectorConfig) => {
        initConfigs.push(config as unknown as Record<string, unknown>);

        return {
          track(event: {
            name: string;
            properties?: Record<string, unknown>;
            anonymousId?: string;
            sessionId?: string;
          }) {
            events.push(event);
          },
          flush() {
            flushCalls += 1;
            return Promise.resolve();
          },
        };
      },
    },
  };
}

function readConnectorJobCount(filePath: string): number {
  if (!fs.existsSync(filePath)) {
    return 0;
  }

  try {
    const db = new Database(filePath, { readonly: true });
    try {
      const row = db.query('select count(*) as count from connector_jobs').get() as {
        count?: number;
      } | null;
      return Number(row?.count ?? 0);
    } finally {
      db.close();
    }
  } catch {
    return 0;
  }
}

async function waitForCondition(
  condition: () => boolean | Promise<boolean>,
  timeoutMs: number = 2000,
  intervalMs: number = 25
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeoutMs) {
    if (await condition()) {
      return;
    }

    await waitForFileFlush(intervalMs);
  }

  throw new Error(`Timed out waiting for condition after ${timeoutMs}ms.`);
}

function createQueuedDatabuddyRuntime() {
  const initConfigs: Array<Record<string, unknown>> = [];
  const deliveredEvents: Array<{
    name: string;
    properties?: Record<string, unknown>;
    anonymousId?: string;
    sessionId?: string;
  }> = [];
  const queuedEvents: Array<{
    name: string;
    properties?: Record<string, unknown>;
    anonymousId?: string;
    sessionId?: string;
  }> = [];
  let healthy = false;
  let flushCalls = 0;

  return {
    initConfigs,
    deliveredEvents,
    recover() {
      healthy = true;
    },
    get flushCalls() {
      return flushCalls;
    },
    hooks: {
      createClient: (config: ResolvedDatabuddyConnectorConfig) => {
        initConfigs.push(config as unknown as Record<string, unknown>);

        return {
          track(event: {
            name: string;
            properties?: Record<string, unknown>;
            anonymousId?: string;
            sessionId?: string;
          }) {
            queuedEvents.push(event);
            return { success: true };
          },
          flush() {
            flushCalls += 1;

            if (!healthy) {
              queuedEvents.length = 0;
              return Promise.resolve({
                success: false,
                error: 'temporary outage',
              });
            }

            deliveredEvents.push(...queuedEvents.splice(0, queuedEvents.length));
            return Promise.resolve({
              success: true,
              processed: deliveredEvents.length,
            });
          },
        };
      },
    },
  };
}

describe('Databuddy Connector', () => {
  let originalCwd: string;
  let tempDir: string;
  let originalApiKey: string | undefined;

  beforeEach(() => {
    originalCwd = process.cwd();
    originalApiKey = process.env.DATABUDDY_API_KEY;
    tempDir = makeTempDir('blyp-databuddy-');
    resetConfigCache();
    resetDatabuddyTestHooks();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (originalApiKey === undefined) {
      delete process.env.DATABUDDY_API_KEY;
    } else {
      process.env.DATABUDDY_API_KEY = originalApiKey;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
    resetConfigCache();
    resetDatabuddyTestHooks();
  });

  it('loads Databuddy connector config from blyp.config.ts', () => {
    process.chdir(tempDir);
    fs.writeFileSync(
      path.join(tempDir, 'blyp.config.ts'),
      [
        'export default {',
        '  connectors: {',
        '    databuddy: {',
        '      enabled: true,',
        '      apiKey: process.env.DATABUDDY_API_KEY,',
        '      websiteId: "25361306-ceb5-4328-b076-7075bf190530",',
        '      namespace: "billing",',
        '      source: "backend",',
        '    },',
        '  },',
        '};',
      ].join('\n')
    );
    process.env.DATABUDDY_API_KEY = 'db_test_key';

    const resolved = resolveConfig();
    const connector = resolved.connectors?.databuddy;

    expect(connector?.enabled).toBe(true);
    expect(connector?.apiKey).toBe('db_test_key');
    expect(connector?.websiteId).toBe('25361306-ceb5-4328-b076-7075bf190530');
    expect(connector?.namespace).toBe('billing');
    expect(connector?.source).toBe('backend');
    expect(connector?.mode).toBe('auto');
    expect(connector?.debug).toBe(false);
    expect(connector?.enableBatching).toBe(true);
    expect(connector?.ready).toBe(true);
  });

  it('auto-forwards server logs to Databuddy', () => {
    const runtime = createFakeDatabuddyRuntime();
    setDatabuddyTestHooks(runtime.hooks);

    const logger = createStandaloneLogger({
      pretty: false,
      logDir: tempDir,
      connectors: {
        databuddy: {
          enabled: true,
          mode: 'auto',
          apiKey: 'db_test_key',
          websiteId: '25361306-ceb5-4328-b076-7075bf190530',
          namespace: 'api',
          source: 'backend',
          enableBatching: true,
        },
      },
    });

    logger.info('hello databuddy');
    const structured = logger.createStructuredLog('checkout', { orderId: 'ord_1' });
    structured.info('started');

    expect(runtime.initConfigs).toHaveLength(1);
    expect(runtime.initConfigs[0]).toMatchObject({
      apiKey: 'db_test_key',
      websiteId: '25361306-ceb5-4328-b076-7075bf190530',
      namespace: 'api',
      source: 'backend',
      enableBatching: true,
    });
    expect(runtime.events).toHaveLength(1);
    expect(runtime.events[0]?.name).toBe('log');
    expect(runtime.events[0]?.properties).toMatchObject({
      blyp_level: 'info',
      blyp_source: 'server',
      message: 'hello databuddy',
    });
  });

  it('does not auto-forward regular Blyp logs in manual mode', () => {
    const runtime = createFakeDatabuddyRuntime();
    setDatabuddyTestHooks(runtime.hooks);

    const logger = createStandaloneLogger({
      pretty: false,
      logDir: tempDir,
      connectors: {
        databuddy: {
          enabled: true,
          mode: 'manual',
          apiKey: 'db_test_key',
          websiteId: '25361306-ceb5-4328-b076-7075bf190530',
        },
      },
    });

    logger.info('manual only');

    expect(runtime.events).toHaveLength(0);
  });

  it('supports manual Databuddy logger and error tracker helpers', () => {
    const runtime = createFakeDatabuddyRuntime();
    setDatabuddyTestHooks(runtime.hooks);

    const logger = createDatabuddyLogger({
      connectors: {
        databuddy: {
          enabled: true,
          apiKey: 'db_test_key',
          websiteId: '25361306-ceb5-4328-b076-7075bf190530',
        },
      },
    }).child({ feature: 'checkout' });
    const tracker = createDatabuddyErrorTracker({
      connectors: {
        databuddy: {
          enabled: true,
          apiKey: 'db_test_key',
          websiteId: '25361306-ceb5-4328-b076-7075bf190530',
        },
      },
    }).child({ feature: 'checkout' });
    const structured = createStructuredDatabuddyLogger(
      'manual-checkout',
      { feature: 'checkout' },
      {
        connectors: {
          databuddy: {
            enabled: true,
            apiKey: 'db_test_key',
            websiteId: '25361306-ceb5-4328-b076-7075bf190530',
          },
        },
      }
    );

    logger.info('manual databuddy log');
    tracker.capture(new Error('manual databuddy exception'), {
      properties: {
        step: 'payment',
      },
    });
    captureDatabuddyException(
      new Error('wrapped databuddy exception'),
      {
        properties: {
          area: 'billing',
        },
      },
      {
        connectors: {
          databuddy: {
            enabled: true,
            apiKey: 'db_test_key',
            websiteId: '25361306-ceb5-4328-b076-7075bf190530',
          },
        },
      }
    );
    structured.info('manual start');

    expect(runtime.events).toHaveLength(3);
    expect(runtime.events[0]?.properties).toMatchObject({
      blyp_level: 'info',
      message: 'manual databuddy log',
    });
    expect(runtime.events[1]?.name).toBe('error');
    expect(runtime.events[1]?.properties).toMatchObject({
      feature: 'checkout',
      step: 'payment',
      blyp_manual: true,
      error_type: 'Error',
    });
    expect(runtime.events[2]?.name).toBe('error');
    expect(runtime.events[2]?.properties).toMatchObject({
      area: 'billing',
      blyp_manual: true,
    });
    expect(runtime.initConfigs).toHaveLength(1);
  });

  it('reuses the Databuddy sender for repeated capture helper calls with the same config', () => {
    const runtime = createFakeDatabuddyRuntime();
    setDatabuddyTestHooks(runtime.hooks);

    const config = {
      connectors: {
        databuddy: {
          enabled: true,
          apiKey: 'db_test_key',
          websiteId: '25361306-ceb5-4328-b076-7075bf190530',
        },
      },
    } as const;

    captureDatabuddyException(new Error('first'), {}, config);
    captureDatabuddyException(new Error('second'), {}, config);
    captureDatabuddyException(new Error('third'), {}, config);

    expect(runtime.initConfigs).toHaveLength(1);
    expect(runtime.events).toHaveLength(3);
  });

  it('auto-captures createError exceptions and dedupes later HTTP logging behavior via manual mode check', () => {
    const runtime = createFakeDatabuddyRuntime();
    setDatabuddyTestHooks(runtime.hooks);

    const logger = createStandaloneLogger({
      pretty: false,
      logDir: tempDir,
      connectors: {
        databuddy: {
          enabled: true,
          apiKey: 'db_test_key',
          websiteId: '25361306-ceb5-4328-b076-7075bf190530',
        },
      },
    });

    const error = createError({
      status: 503,
      message: 'payment unavailable',
      logger,
    });

    emitHttpErrorLog(
      logger,
      'info',
      createRequestLike('POST', 'https://example.test/payments', {
        'user-agent': 'BlypTest/1.0',
      }),
      '/payments',
      503,
      18,
      error,
      {},
      {
        error,
      }
    );

    const errorEvents = runtime.events.filter((event) => event.name === 'error');
    expect(errorEvents).toHaveLength(2);
    expect(errorEvents[0]?.properties).toMatchObject({
      message: 'payment unavailable',
      blyp_type: 'application_error',
      status: 503,
      status_code: 503,
    });
    expect(errorEvents[1]?.properties).toMatchObject({
      method: 'POST',
      path: '/payments',
      status_code: 503,
      current_url: 'https://example.test/payments',
      user_agent: 'BlypTest/1.0',
    });
  });

  it('does not auto-capture handled errors when Databuddy mode is manual', () => {
    const runtime = createFakeDatabuddyRuntime();
    setDatabuddyTestHooks(runtime.hooks);

    const logger = createStandaloneLogger({
      pretty: false,
      logDir: tempDir,
      connectors: {
        databuddy: {
          enabled: true,
          mode: 'manual',
          apiKey: 'db_test_key',
          websiteId: '25361306-ceb5-4328-b076-7075bf190530',
        },
      },
    });

    createError({
      status: 500,
      message: 'manual only',
      logger,
    });

    expect(runtime.events.filter((event) => event.name === 'error')).toHaveLength(0);
  });

  it('forwards client connector requests to Databuddy during ingestion and promotes client errors in auto mode', async () => {
    const runtime = createFakeDatabuddyRuntime();
    setDatabuddyTestHooks(runtime.hooks);

    const shared = resolveServerLogger({
      pretty: false,
      logDir: tempDir,
      clientLogging: true,
      connectors: {
        databuddy: {
          enabled: true,
          apiKey: 'db_test_key',
          websiteId: '25361306-ceb5-4328-b076-7075bf190530',
        },
      },
    });

    const result = await handleClientLogIngestion({
      config: shared,
      ctx: {},
      request: new Request('http://localhost/inngest', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(createClientPayload({
          connector: 'databuddy',
          level: 'error',
          message: 'frontend exploded',
          data: {
            name: 'ClientError',
            message: 'frontend exploded',
            stack: 'Error: frontend exploded',
          },
        })),
      }),
      deliveryPath: '/inngest',
    });
    await waitForFileFlush();

    expect(result.status).toBe(204);
    expect(result.headers?.['x-blyp-databuddy-status']).toBe('enabled');
    expect(runtime.events).toHaveLength(2);
    expect(runtime.events[0]?.properties).toMatchObject({
      blyp_source: 'client',
      session_id: 'session_123',
    });
    expect(runtime.events[1]).toMatchObject({
      name: 'error',
      sessionId: 'session_123',
    });
    expect(runtime.events[1]?.properties).toMatchObject({
      blyp_source: 'client',
      page_url: 'https://dashboard.example.test/app',
      page_path: '/app',
    });

    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    expect(records.some((record) => record.message === '[client] frontend exploded')).toBe(true);
  });

  it('returns a missing header when the client requests Databuddy but the server has no connector', async () => {
    const shared = resolveServerLogger({
      pretty: false,
      logDir: tempDir,
      clientLogging: true,
    });

    const result = await handleClientLogIngestion({
      config: shared,
      ctx: {},
      request: new Request('http://localhost/inngest', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(createClientPayload({ connector: 'databuddy' })),
      }),
      deliveryPath: '/inngest',
    });
    await waitForFileFlush();

    expect(result.status).toBe(204);
    expect(result.headers?.['x-blyp-databuddy-status']).toBe('missing');
  });

  it('flushes Databuddy when the logger flushes', async () => {
    const runtime = createFakeDatabuddyRuntime();
    setDatabuddyTestHooks(runtime.hooks);

    const logger = createStandaloneLogger({
      pretty: false,
      logDir: tempDir,
      connectors: {
        databuddy: {
          enabled: true,
          apiKey: 'db_test_key',
          websiteId: '25361306-ceb5-4328-b076-7075bf190530',
        },
      },
    });

    logger.info('flush me');
    await logger.flush();

    expect(runtime.flushCalls).toBeGreaterThan(0);
  });

  it('persists queued Databuddy failures to SQLite and replays them after recovery when the SDK returns a resolved failure object', async () => {
    const runtime = createQueuedDatabuddyRuntime();
    setDatabuddyTestHooks(runtime.hooks);

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
      pollIntervalMs: 25,
      overflowStrategy: 'drop-oldest',
      durableReady: false,
      retry: {
        maxAttempts: 20,
        initialBackoffMs: 50,
        maxBackoffMs: 50,
        multiplier: 2,
        jitter: false,
      },
    });
    const sender = createDatabuddySender({
      enabled: true,
      mode: 'auto',
      apiKey: 'db_test_key',
      websiteId: '25361306-ceb5-4328-b076-7075bf190530',
    });

    const dispatcher = (sender as unknown as Record<PropertyKey, unknown>)[CONNECTOR_BATCH_DISPATCH];
    expect(dispatcher).toBeDefined();

    await waitForFileFlush(50);
    delivery.enqueue('databuddy', {
      timestamp: new Date().toISOString(),
      level: 'info',
      message: 'queued databuddy retry',
    }, dispatcher as Parameters<typeof delivery.enqueue>[2]);

    await waitForCondition(() => fs.existsSync(durableQueuePath), 1000);
    await waitForCondition(async () => (await delivery.getDurableCountForTests()) === 1, 2000);
    runtime.recover();
    await delivery.flush();
    await waitForCondition(() => runtime.deliveredEvents.length === 1, 2000);

    expect(runtime.deliveredEvents[0]?.properties).toMatchObject({
      message: 'queued databuddy retry',
      blyp_source: 'server',
    });
    expect(runtime.flushCalls).toBeGreaterThanOrEqual(2);

    expect(await delivery.getDurableCountForTests()).toBe(0);

    await delivery.shutdown();
  });

  it('requires websiteId before Databuddy becomes ready', () => {
    const resolved = resolveConfig({
      connectors: {
        databuddy: {
          enabled: true,
          apiKey: 'db_test_key',
        },
      },
    });

    expect(resolved.connectors.databuddy.ready).toBe(false);
    expect(resolved.connectors.databuddy.status).toBe('missing');
  });
});
