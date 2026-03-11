import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createError } from '../src/core/errors';
import { resetConfigCache, resolveConfig } from '../src/core/config';
import {
  resetPostHogTestHooks,
  setPostHogTestHooks,
  type PostHogNormalizedRecord,
} from '../src/core/posthog';
import {
  capturePosthogException,
  createPosthogErrorTracker,
  createPosthogLogger,
  createStructuredPosthogLogger,
} from '../src/frameworks/posthog';
import {
  createRequestLike,
  emitHttpErrorLog,
  resolveServerLogger,
  handleClientLogIngestion,
} from '../src/frameworks/shared';
import { createStandaloneLogger } from '../src/frameworks/standalone';
import { createClientPayload } from './helpers/client-payload';
import { makeTempDir, readJsonLines, waitForFileFlush } from './helpers/fs';

function createFakePostHogRuntime() {
  const emitted: PostHogNormalizedRecord[] = [];
  const exceptionCalls: Array<{
    error: unknown;
    distinctId?: string;
    additionalProperties?: Record<string | number, unknown>;
  }> = [];
  const exceptionClientConfigs: Array<{
    serviceName: string;
    host: string;
    enableExceptionAutocapture: boolean;
  }> = [];

  return {
    emitted,
    exceptionCalls,
    exceptionClientConfigs,
    hooks: {
      createTransport: () => ({
        emit(payload: PostHogNormalizedRecord) {
          emitted.push(payload);
        },
      }),
      createExceptionClient: (config: {
        serviceName: string;
        host: string;
        errorTracking: {
          enableExceptionAutocapture: boolean;
        };
      }) => {
        exceptionClientConfigs.push({
          serviceName: config.serviceName,
          host: config.host,
          enableExceptionAutocapture: config.errorTracking.enableExceptionAutocapture,
        });

        return {
          captureException(
            error: unknown,
            distinctId?: string,
            additionalProperties?: Record<string | number, unknown>
          ) {
            exceptionCalls.push({
              error,
              distinctId,
              additionalProperties,
            });
          },
          shutdown() {
            return Promise.resolve();
          },
        };
      },
    },
  };
}

describe('PostHog Connector', () => {
  let originalCwd: string;
  let originalProjectKey: string | undefined;
  let tempDir: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    originalProjectKey = process.env.POSTHOG_PROJECT_KEY;
    tempDir = makeTempDir('blyp-posthog-');
    resetConfigCache();
    resetPostHogTestHooks();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (originalProjectKey === undefined) {
      delete process.env.POSTHOG_PROJECT_KEY;
    } else {
      process.env.POSTHOG_PROJECT_KEY = originalProjectKey;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
    resetConfigCache();
    resetPostHogTestHooks();
  });

  it('loads PostHog connector config from blyp.config.ts', () => {
    process.chdir(tempDir);
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify({ name: 'posthog-app' }, null, 2)
    );
    fs.writeFileSync(
      path.join(tempDir, 'blyp.config.ts'),
      [
        'export default {',
        '  connectors: {',
        '    posthog: {',
        '      enabled: true,',
        '      projectKey: process.env.POSTHOG_PROJECT_KEY,',
        '    },',
        '  },',
        '};',
      ].join('\n')
    );
    process.env.POSTHOG_PROJECT_KEY = 'phc_from_env';

    const resolved = resolveConfig();

    expect(resolved.connectors?.posthog?.enabled).toBe(true);
    expect(resolved.connectors?.posthog?.projectKey).toBe('phc_from_env');
    expect(resolved.connectors?.posthog?.serviceName).toBe('posthog-app');
    expect(resolved.connectors?.posthog?.errorTracking?.enabled).toBe(true);
    expect(resolved.connectors?.posthog?.errorTracking?.mode).toBe('auto');
    expect(resolved.connectors?.posthog?.errorTracking?.enableExceptionAutocapture).toBe(true);
    expect(fs.existsSync(path.join(tempDir, 'blyp.config.json'))).toBe(false);
  });

  it('prefers the highest-priority config file and warns once when multiple exist', () => {
    process.chdir(tempDir);
    fs.writeFileSync(
      path.join(tempDir, 'blyp.config.ts'),
      'export default { level: "debug" };\n'
    );
    fs.writeFileSync(
      path.join(tempDir, 'blyp.config.json'),
      JSON.stringify({ level: 'error' })
    );

    const warnings: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };

    const resolved = resolveConfig();

    console.warn = originalWarn;
    expect(resolved.level).toBe('debug');
    expect(warnings).toHaveLength(1);
  });

  it('auto-forwards server logs to PostHog and skips client_log records', () => {
    const runtime = createFakePostHogRuntime();
    setPostHogTestHooks(runtime.hooks);

    const logger = createStandaloneLogger({
      pretty: false,
      logDir: tempDir,
      connectors: {
        posthog: {
          enabled: true,
          mode: 'auto',
          projectKey: 'phc_test',
          serviceName: 'svc',
        },
      },
    });

    logger.info('hello');
    logger.error('boom', { retryable: false });
    logger.table('Users', { count: 2 });
    logger.info('[client] ignored', { type: 'client_log', page: { pathname: '/app' } });
    const structured = logger.createStructuredLog('checkout', { orderId: 'ord_1' });
    structured.info('started');
    structured.emit({ status: 200 });

    expect(runtime.emitted).toHaveLength(4);
    expect(runtime.emitted.map((entry) => entry.body)).toEqual([
      'hello',
      'boom',
      'Users',
      'structured_log',
    ]);
    expect(runtime.emitted[3]?.attributes['blyp.group_id']).toBe('checkout');
  });

  it('does not auto-forward regular Blyp logs in manual mode', () => {
    const runtime = createFakePostHogRuntime();
    setPostHogTestHooks(runtime.hooks);

    const logger = createStandaloneLogger({
      pretty: false,
      logDir: tempDir,
      connectors: {
        posthog: {
          enabled: true,
          mode: 'manual',
          projectKey: 'phc_test',
          serviceName: 'svc',
        },
      },
    });

    logger.info('manual-mode');

    expect(runtime.emitted).toHaveLength(0);
  });

  it('supports manual PostHog-only loggers and structured loggers', () => {
    const runtime = createFakePostHogRuntime();
    setPostHogTestHooks(runtime.hooks);

    const logger = createPosthogLogger({
      connectors: {
        posthog: {
          enabled: true,
          projectKey: 'phc_test',
          serviceName: 'svc',
        },
      },
    }).child({ feature: 'checkout' });
    logger.warn('manual warning', { retryable: true });

    const structured = createStructuredPosthogLogger(
      'manual-checkout',
      { orderId: 'ord_2' },
      {
        connectors: {
          posthog: {
            enabled: true,
            projectKey: 'phc_test',
            serviceName: 'svc',
          },
        },
      }
    );
    structured.info('manual start');
    structured.emit({ status: 201 });

    expect(runtime.emitted).toHaveLength(2);
    const manualPayload = JSON.parse(String(runtime.emitted[0]?.attributes['blyp.payload'])) as {
      bindings?: Record<string, unknown>;
    };
    expect(manualPayload.bindings).toEqual({ feature: 'checkout' });
    expect(runtime.emitted[1]?.attributes['blyp.group_id']).toBe('manual-checkout');
    expect(fs.existsSync(path.join(tempDir, 'log.ndjson'))).toBe(false);
  });

  it('supports manual PostHog error trackers and convenience capture', () => {
    const runtime = createFakePostHogRuntime();
    setPostHogTestHooks(runtime.hooks);

    const tracker = createPosthogErrorTracker({
      connectors: {
        posthog: {
          enabled: true,
          projectKey: 'phc_test',
          serviceName: 'svc',
        },
      },
    }).child({ feature: 'checkout' });

    tracker.capture(new Error('manual exception'), {
      distinctId: 'user_123',
      properties: {
        step: 'payment',
      },
    });
    capturePosthogException(
      new Error('wrapped exception'),
      {
        properties: {
          area: 'billing',
        },
      },
      {
        connectors: {
          posthog: {
            enabled: true,
            projectKey: 'phc_test',
            serviceName: 'svc',
          },
        },
      }
    );

    expect(runtime.exceptionCalls).toHaveLength(2);
    expect(runtime.exceptionCalls[0]?.distinctId).toBe('user_123');
    expect(runtime.exceptionCalls[0]?.additionalProperties).toMatchObject({
      feature: 'checkout',
      step: 'payment',
      'blyp.source': 'server',
      'blyp.manual': true,
    });
    expect(runtime.exceptionCalls[1]?.additionalProperties).toMatchObject({
      area: 'billing',
      'blyp.manual': true,
    });
    expect(fs.existsSync(path.join(tempDir, 'log.ndjson'))).toBe(false);
  });

  it('downgrades missing manual configuration to a single local error', () => {
    const errors: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };

    const logger = createPosthogLogger();
    logger.info('first');
    logger.info('second');

    console.error = originalError;
    expect(errors).toHaveLength(1);
    expect(String(errors[0]?.[0] ?? '')).toContain('PostHog connector is not configured');
  });

  it('auto-captures createError exceptions and dedupes later HTTP logging', () => {
    const runtime = createFakePostHogRuntime();
    setPostHogTestHooks(runtime.hooks);

    const logger = createStandaloneLogger({
      pretty: false,
      logDir: tempDir,
      connectors: {
        posthog: {
          enabled: true,
          projectKey: 'phc_test',
          serviceName: 'svc',
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
        'x-posthog-distinct-id': 'user_123',
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

    expect(runtime.exceptionCalls).toHaveLength(1);
    expect((runtime.exceptionCalls[0]?.error as Error).message).toBe('payment unavailable');
    expect(runtime.exceptionCalls[0]?.additionalProperties).toMatchObject({
      status: 503,
      statusCode: 503,
      'blyp.type': 'application_error',
    });
  });

  it('does not auto-capture handled errors when PostHog error tracking is manual', () => {
    const runtime = createFakePostHogRuntime();
    setPostHogTestHooks(runtime.hooks);

    const logger = createStandaloneLogger({
      pretty: false,
      logDir: tempDir,
      connectors: {
        posthog: {
          enabled: true,
          projectKey: 'phc_test',
          serviceName: 'svc',
          errorTracking: {
            mode: 'manual',
          },
        },
      },
    });

    createError({
      status: 500,
      message: 'manual only',
      logger,
    });

    expect(runtime.exceptionCalls).toHaveLength(0);
    expect(runtime.exceptionClientConfigs[0]?.enableExceptionAutocapture).toBe(false);
  });

  it('forwards client connector requests to PostHog during ingestion', async () => {
    const runtime = createFakePostHogRuntime();
    setPostHogTestHooks(runtime.hooks);

    const shared = resolveServerLogger({
      pretty: false,
      logDir: tempDir,
      clientLogging: true,
      connectors: {
        posthog: {
          enabled: true,
          mode: 'manual',
          projectKey: 'phc_test',
          serviceName: 'svc',
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
        body: JSON.stringify(createClientPayload({ connector: 'posthog' })),
      }),
      deliveryPath: '/inngest',
    });
    await waitForFileFlush();

    expect(result.status).toBe(204);
    expect(result.headers?.['x-blyp-posthog-status']).toBe('enabled');
    expect(runtime.emitted).toHaveLength(1);
    expect(runtime.emitted[0]?.attributes['blyp.source']).toBe('client');
    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    expect(records.some((record) => record.message === '[client] frontend rendered')).toBe(true);
  });

  it('promotes client error connector requests to PostHog exceptions in auto mode', async () => {
    const runtime = createFakePostHogRuntime();
    setPostHogTestHooks(runtime.hooks);

    const shared = resolveServerLogger({
      pretty: false,
      logDir: tempDir,
      clientLogging: true,
      connectors: {
        posthog: {
          enabled: true,
          mode: 'manual',
          projectKey: 'phc_test',
          serviceName: 'svc',
          errorTracking: {
            mode: 'auto',
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
          connector: 'posthog',
          level: 'error',
          message: 'frontend exploded',
          data: {
            name: 'ClientError',
            message: 'frontend exploded',
            stack: 'Error: frontend exploded',
          },
          metadata: {
            posthogDistinctId: 'person_123',
          },
        })),
      }),
      deliveryPath: '/inngest',
    });

    expect(result.status).toBe(204);
    expect(runtime.exceptionCalls).toHaveLength(1);
    expect(runtime.exceptionCalls[0]?.distinctId).toBe('person_123');
    expect(runtime.exceptionCalls[0]?.additionalProperties).toMatchObject({
      'blyp.source': 'client',
      'blyp.type': 'client_log',
      $session_id: 'session_123',
      $request_path: '/app',
      $current_url: 'https://dashboard.example.test/app',
      'client.runtime': undefined,
    });
  });

  it('returns a missing header when the client requests PostHog but the server has no connector', async () => {
    const runtime = createFakePostHogRuntime();
    setPostHogTestHooks(runtime.hooks);

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
        body: JSON.stringify(createClientPayload({ connector: 'posthog' })),
      }),
      deliveryPath: '/inngest',
    });
    await waitForFileFlush();

    expect(result.status).toBe(204);
    expect(result.headers?.['x-blyp-posthog-status']).toBe('missing');
    expect(runtime.emitted).toHaveLength(0);
    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    expect(records.some((record) => record.message === '[client] frontend rendered')).toBe(true);
  });
});
