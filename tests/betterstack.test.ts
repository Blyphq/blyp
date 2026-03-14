import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createError } from '../src/core/errors';
import { resetConfigCache, resolveConfig } from '../src/core/config';
import {
  resetBetterStackTestHooks,
  setBetterStackTestHooks,
} from '../src/connectors/betterstack/sender';
import {
  captureBetterStackException,
  createBetterStackErrorTracker,
  createBetterStackLogger,
  createStructuredBetterStackLogger,
} from '../src/connectors/betterstack';
import {
  createRequestLike,
  emitHttpErrorLog,
  handleClientLogIngestion,
  resolveServerLogger,
} from '../src/frameworks/shared';
import { createStandaloneLogger } from '../src/frameworks/standalone';
import { createClientPayload } from './helpers/client-payload';
import { makeTempDir, readJsonLines, waitForFileFlush } from './helpers/fs';

interface CapturedBetterStackLog {
  message: string;
  level: string;
  context?: Record<string, unknown>;
}

function createFakeBetterStackClient() {
  const logs: CapturedBetterStackLog[] = [];
  let flushCount = 0;

  return {
    client: {
      async log(message: string, level: string, context?: Record<string, unknown>) {
        logs.push({ message, level, context });
      },
      async flush() {
        flushCount += 1;
      },
    },
    logs,
    get flushCount() {
      return flushCount;
    },
  };
}

function createFakeBetterStackSentryModule(initialClientOptions?: {
  dsn?: string;
  tracesSampleRate?: number;
  environment?: string;
  release?: string;
}) {
  const exceptionCalls: Array<{
    error: unknown;
    level?: string;
    contexts: Record<string, unknown>;
    extras: Record<string, unknown>;
  }> = [];
  const initCalls: Array<Record<string, unknown>> = [];
  let currentClient = initialClientOptions
    ? {
        getOptions: () => initialClientOptions,
      }
    : undefined;
  let activeScope = {
    level: undefined as string | undefined,
    contexts: {} as Record<string, unknown>,
    extras: {} as Record<string, unknown>,
  };

  return {
    module: {
      init(options: Record<string, unknown>) {
        initCalls.push(options);
        currentClient = {
          getOptions: () => options,
        };
      },
      getClient() {
        return currentClient;
      },
      captureException(error: unknown) {
        exceptionCalls.push({
          error,
          level: activeScope.level,
          contexts: { ...activeScope.contexts },
          extras: { ...activeScope.extras },
        });
      },
      flush() {
        return Promise.resolve(true);
      },
      withScope(callback: (scope: {
        setLevel(level: string): void;
        setContext(name: string, value: unknown): void;
        setExtra(name: string, value: unknown): void;
      }) => void) {
        const nextScope = {
          level: undefined as string | undefined,
          contexts: {} as Record<string, unknown>,
          extras: {} as Record<string, unknown>,
        };
        activeScope = nextScope;
        callback({
          setLevel(level) {
            nextScope.level = level;
          },
          setContext(name, value) {
            nextScope.contexts[name] = value;
          },
          setExtra(name, value) {
            nextScope.extras[name] = value;
          },
        });
      },
      logger: {
        debug() {},
        info() {},
        warn() {},
        error() {},
        fatal() {},
      },
    },
    exceptionCalls,
    initCalls,
  };
}

describe('Better Stack Connector', () => {
  let originalCwd: string;
  let tempDir: string;
  let originalSourceToken: string | undefined;
  let originalIngestingHost: string | undefined;
  let originalBetterStackErrorTrackingDsn: string | undefined;

  beforeEach(() => {
    originalCwd = process.cwd();
    originalSourceToken = process.env.SOURCE_TOKEN;
    originalIngestingHost = process.env.INGESTING_HOST;
    originalBetterStackErrorTrackingDsn = process.env.BETTERSTACK_ERROR_TRACKING_DSN;
    tempDir = makeTempDir('blyp-betterstack-');
    resetConfigCache();
    resetBetterStackTestHooks();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (originalSourceToken === undefined) {
      delete process.env.SOURCE_TOKEN;
    } else {
      process.env.SOURCE_TOKEN = originalSourceToken;
    }
    if (originalIngestingHost === undefined) {
      delete process.env.INGESTING_HOST;
    } else {
      process.env.INGESTING_HOST = originalIngestingHost;
    }
    if (originalBetterStackErrorTrackingDsn === undefined) {
      delete process.env.BETTERSTACK_ERROR_TRACKING_DSN;
    } else {
      process.env.BETTERSTACK_ERROR_TRACKING_DSN = originalBetterStackErrorTrackingDsn;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
    resetConfigCache();
    resetBetterStackTestHooks();
  });

  it('loads Better Stack connector config from blyp.config.ts', () => {
    process.chdir(tempDir);
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify({ name: 'betterstack-app' }, null, 2)
    );
    fs.writeFileSync(
      path.join(tempDir, 'blyp.config.ts'),
      [
        'export default {',
        '  connectors: {',
        '    betterstack: {',
        '      enabled: true,',
        '      sourceToken: process.env.SOURCE_TOKEN,',
        '      ingestingHost: process.env.INGESTING_HOST,',
        '      errorTracking: {',
        '        dsn: process.env.BETTERSTACK_ERROR_TRACKING_DSN,',
        '      },',
        '    },',
        '  },',
        '};',
      ].join('\n')
    );
    process.env.SOURCE_TOKEN = 'src_test_token';
    process.env.INGESTING_HOST = 'https://in.logs.betterstack.com';
    process.env.BETTERSTACK_ERROR_TRACKING_DSN = 'https://token@example.ingest.sentry.io/1';

    const resolved = resolveConfig();
    const connector = resolved.connectors?.betterstack as {
      enabled?: boolean;
      sourceToken?: string;
      ingestingHost?: string;
      serviceName?: string;
      ready?: boolean;
      errorTracking?: { ready?: boolean; dsn?: string };
    } | undefined;

    expect(connector?.enabled).toBe(true);
    expect(connector?.sourceToken).toBe('src_test_token');
    expect(connector?.ingestingHost).toBe('https://in.logs.betterstack.com');
    expect(connector?.serviceName).toBe('betterstack-app');
    expect(connector?.ready).toBe(true);
    expect(connector?.errorTracking?.dsn).toBe('https://token@example.ingest.sentry.io/1');
    expect(connector?.errorTracking?.ready).toBe(true);
  });

  it('auto-forwards server logs to Better Stack and skips client_log records', () => {
    const runtime = createFakeBetterStackClient();
    setBetterStackTestHooks({ createClient: () => runtime.client });

    const logger = createStandaloneLogger({
      pretty: false,
      logDir: tempDir,
      connectors: {
        betterstack: {
          enabled: true,
          mode: 'auto',
          sourceToken: 'src_test_token',
          ingestingHost: 'https://in.logs.betterstack.com',
          serviceName: 'svc',
        },
      },
    });

    logger.info('hello');
    logger.error('boom', { retryable: false });
    logger.info('[client] ignored', { type: 'client_log', page: { pathname: '/app' } });
    const structured = logger.createStructuredLog('checkout', { orderId: 'ord_1' });
    structured.info('started');
    structured.emit({ status: 200 });

    expect(runtime.logs).toHaveLength(3);
    expect(runtime.logs.map((entry) => entry.message)).toEqual([
      'hello',
      'boom',
      'structured_log',
    ]);
  });

  it('supports manual Better Stack-only loggers and structured loggers', () => {
    const runtime = createFakeBetterStackClient();
    setBetterStackTestHooks({ createClient: () => runtime.client });

    const logger = createBetterStackLogger({
      connectors: {
        betterstack: {
          enabled: true,
          sourceToken: 'src_test_token',
          ingestingHost: 'https://in.logs.betterstack.com',
          serviceName: 'svc',
        },
      },
    }).child({ feature: 'checkout' });
    logger.warn('manual warning', { retryable: true });

    const structured = createStructuredBetterStackLogger(
      'manual-checkout',
      { orderId: 'ord_2' },
      {
        connectors: {
          betterstack: {
            enabled: true,
            sourceToken: 'src_test_token',
            ingestingHost: 'https://in.logs.betterstack.com',
            serviceName: 'svc',
          },
        },
      }
    );
    structured.info('manual start');
    structured.emit({ status: 201 });

    expect(runtime.logs).toHaveLength(2);
    const firstContext = runtime.logs[0]?.context as {
      context?: { blyp?: { bindings?: Record<string, unknown> } };
    };
    expect(firstContext.context?.blyp?.bindings).toEqual({ feature: 'checkout' });
    const secondContext = runtime.logs[1]?.context as {
      context?: { blyp?: { group_id?: string } };
    };
    expect(secondContext.context?.blyp?.group_id).toBe('manual-checkout');
    expect(fs.existsSync(path.join(tempDir, 'log.ndjson'))).toBe(false);
  });

  it('does not auto-forward regular Blyp logs in manual mode', () => {
    const runtime = createFakeBetterStackClient();
    setBetterStackTestHooks({ createClient: () => runtime.client });

    const logger = createStandaloneLogger({
      pretty: false,
      logDir: tempDir,
      connectors: {
        betterstack: {
          enabled: true,
          mode: 'manual',
          sourceToken: 'src_test_token',
          ingestingHost: 'https://in.logs.betterstack.com',
          serviceName: 'svc',
        },
      },
    });

    logger.info('manual-mode');

    expect(runtime.logs).toHaveLength(0);
  });

  it('downgrades missing manual configuration to a single local error', () => {
    const errors: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };

    const logger = createBetterStackLogger();
    logger.info('first');
    logger.info('second');

    console.error = originalError;
    expect(errors).toHaveLength(1);
    expect(String(errors[0]?.[0] ?? '')).toContain('Better Stack connector is not configured');
  });

  it('marks missing config when token or ingesting host is invalid', () => {
    const runtime = createFakeBetterStackClient();
    setBetterStackTestHooks({ createClient: () => runtime.client });

    const missingToken = resolveConfig({
      connectors: {
        betterstack: {
          enabled: true,
          ingestingHost: 'https://in.logs.betterstack.com',
        },
      },
    });
    const invalidHost = resolveConfig({
      connectors: {
        betterstack: {
          enabled: true,
          sourceToken: 'src_test_token',
          ingestingHost: 'in.logs.betterstack.com',
        },
      },
    });

    expect((missingToken.connectors?.betterstack as { status?: string } | undefined)?.status).toBe('missing');
    expect((invalidHost.connectors?.betterstack as { status?: string } | undefined)?.status).toBe('missing');
  });

  it('normalizes Better Stack levels and context payloads', () => {
    const runtime = createFakeBetterStackClient();
    setBetterStackTestHooks({ createClient: () => runtime.client });

    const logger = createStandaloneLogger({
      pretty: false,
      logDir: tempDir,
      connectors: {
        betterstack: {
          enabled: true,
          mode: 'auto',
          sourceToken: 'src_test_token',
          ingestingHost: 'https://in.logs.betterstack.com',
          serviceName: 'svc',
        },
      },
    });

    logger.critical('fatal issue');
    logger.warning('warning issue');
    logger.success('success issue');
    logger.table('Table issue', { count: 2 });

    expect(runtime.logs.map((entry) => entry.level)).toEqual([
      'fatal',
      'warn',
      'info',
      'info',
    ]);

    const firstContext = runtime.logs[0]?.context as {
      context?: {
        blyp?: { payload?: string; caller?: string };
        runtime?: { file?: string; line?: number };
      };
    };
    expect(firstContext.context?.blyp?.payload).toEqual(expect.any(String));
    expect(firstContext.context?.blyp?.caller).toEqual(expect.any(String));
    expect(firstContext.context?.runtime?.file).toEqual(expect.any(String));
    expect(firstContext.context?.runtime?.line).toEqual(expect.any(Number));
  });

  it('auto-captures createError exceptions and dedupes later HTTP logging', () => {
    const runtime = createFakeBetterStackClient();
    const sentry = createFakeBetterStackSentryModule();
    setBetterStackTestHooks({
      createClient: () => runtime.client,
      module: sentry.module as never,
    });

    const logger = createStandaloneLogger({
      pretty: false,
      logDir: tempDir,
      connectors: {
        betterstack: {
          enabled: true,
          sourceToken: 'src_test_token',
          ingestingHost: 'https://in.logs.betterstack.com',
          serviceName: 'svc',
          errorTracking: {
            dsn: 'https://token@example.ingest.sentry.io/1',
          },
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

    expect(sentry.initCalls).toHaveLength(1);
    expect(sentry.exceptionCalls).toHaveLength(1);
    expect((sentry.exceptionCalls[0]?.error as Error).message).toBe('payment unavailable');
    expect(sentry.exceptionCalls[0]?.contexts.blyp).toBeDefined();
  });

  it('supports manual Better Stack exception tracking helpers', () => {
    const sentry = createFakeBetterStackSentryModule();
    setBetterStackTestHooks({
      module: sentry.module as never,
    });

    const tracker = createBetterStackErrorTracker({
      connectors: {
        betterstack: {
          enabled: true,
          errorTracking: {
            dsn: 'https://token@example.ingest.sentry.io/1',
          },
        },
      },
    }).child({ feature: 'checkout' });

    tracker.capture(new Error('manual betterstack exception'));
    captureBetterStackException(
      new Error('wrapped betterstack exception'),
      {
        context: { path: '/checkout' },
      },
      {
        connectors: {
          betterstack: {
            enabled: true,
            errorTracking: {
              dsn: 'https://token@example.ingest.sentry.io/1',
            },
          },
        },
      }
    );

    expect(sentry.exceptionCalls).toHaveLength(2);
    expect((sentry.exceptionCalls[0]?.error as Error).message).toBe('manual betterstack exception');
    expect((sentry.exceptionCalls[1]?.error as Error).message).toBe('wrapped betterstack exception');
  });

  it('forwards client connector requests to Better Stack during ingestion', async () => {
    const runtime = createFakeBetterStackClient();
    const sentry = createFakeBetterStackSentryModule();
    setBetterStackTestHooks({
      createClient: () => runtime.client,
      module: sentry.module as never,
    });

    const shared = resolveServerLogger({
      pretty: false,
      logDir: tempDir,
      clientLogging: true,
      connectors: {
        betterstack: {
          enabled: true,
          mode: 'manual',
          sourceToken: 'src_test_token',
          ingestingHost: 'https://in.logs.betterstack.com',
          serviceName: 'svc',
          errorTracking: {
            dsn: 'https://token@example.ingest.sentry.io/1',
          },
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
        body: JSON.stringify(createClientPayload({ connector: 'betterstack' })),
      }),
      deliveryPath: '/inngest',
    });
    await waitForFileFlush();

    expect(result.status).toBe(204);
    expect(result.headers?.['x-blyp-betterstack-status']).toBe('enabled');
    expect(runtime.logs).toHaveLength(1);
    expect(runtime.logs[0]?.message).toBe('[client] frontend rendered');
    expect(sentry.exceptionCalls).toHaveLength(0);
    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    expect(records.some((record) => record.message === '[client] frontend rendered')).toBe(true);
  });

  it('promotes client error connector requests into Better Stack error tracking', async () => {
    const runtime = createFakeBetterStackClient();
    const sentry = createFakeBetterStackSentryModule();
    setBetterStackTestHooks({
      createClient: () => runtime.client,
      module: sentry.module as never,
    });

    const shared = resolveServerLogger({
      pretty: false,
      logDir: tempDir,
      clientLogging: true,
      connectors: {
        betterstack: {
          enabled: true,
          mode: 'manual',
          sourceToken: 'src_test_token',
          ingestingHost: 'https://in.logs.betterstack.com',
          serviceName: 'svc',
          errorTracking: {
            dsn: 'https://token@example.ingest.sentry.io/1',
          },
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
          connector: 'betterstack',
          level: 'error',
          message: 'frontend exploded',
          data: {
            message: 'frontend exploded',
            name: 'Error',
            stack: 'Error: frontend exploded',
          },
        })),
      }),
      deliveryPath: '/inngest',
    });

    expect(result.status).toBe(204);
    expect(sentry.exceptionCalls).toHaveLength(1);
    expect((sentry.exceptionCalls[0]?.error as Error).message).toBe('frontend exploded');
  });

  it('returns a missing header when the client requests Better Stack but the server has no connector', async () => {
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
        body: JSON.stringify(createClientPayload({ connector: 'betterstack' })),
      }),
      deliveryPath: '/inngest',
    });

    expect(result.status).toBe(204);
    expect(result.headers?.['x-blyp-betterstack-status']).toBe('missing');
  });
});
