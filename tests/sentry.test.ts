import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { resetConfigCache, resolveConfig } from '../src/core/config';
import {
  resetSentryTestHooks,
  setSentryTestHooks,
} from '../src/core/sentry';
import {
  createSentryLogger,
  createStructuredSentryLogger,
} from '../src/frameworks/sentry';
import { resolveServerLogger, handleClientLogIngestion } from '../src/frameworks/shared';
import { createStandaloneLogger } from '../src/frameworks/standalone';
import { createClientPayload } from './helpers/client-payload';
import { makeTempDir, readJsonLines, waitForFileFlush } from './helpers/fs';

interface FakeClientOptions {
  dsn?: string;
  environment?: string;
  release?: string;
}

function createFakeSentryModule(initialClientOptions?: FakeClientOptions) {
  const logCalls: Array<{ level: string; message: string; attributes?: Record<string, unknown> }> = [];
  const exceptionCalls: Array<{
    error: unknown;
    level?: string;
    contexts: Record<string, unknown>;
    extras: Record<string, unknown>;
  }> = [];
  const initCalls: FakeClientOptions[] = [];
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
      init(options: FakeClientOptions) {
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
        debug(message: string, attributes?: Record<string, unknown>) {
          logCalls.push({ level: 'debug', message, attributes });
        },
        info(message: string, attributes?: Record<string, unknown>) {
          logCalls.push({ level: 'info', message, attributes });
        },
        warn(message: string, attributes?: Record<string, unknown>) {
          logCalls.push({ level: 'warn', message, attributes });
        },
        error(message: string, attributes?: Record<string, unknown>) {
          logCalls.push({ level: 'error', message, attributes });
        },
        fatal(message: string, attributes?: Record<string, unknown>) {
          logCalls.push({ level: 'fatal', message, attributes });
        },
      },
    },
    logCalls,
    exceptionCalls,
    initCalls,
    getClient() {
      return currentClient;
    },
  };
}

describe('Sentry Connector', () => {
  let originalCwd: string;
  let tempDir: string;
  let originalDsn: string | undefined;
  let originalEnvironment: string | undefined;
  let originalRelease: string | undefined;

  beforeEach(() => {
    originalCwd = process.cwd();
    originalDsn = process.env.SENTRY_DSN;
    originalEnvironment = process.env.SENTRY_ENVIRONMENT;
    originalRelease = process.env.SENTRY_RELEASE;
    tempDir = makeTempDir('blyp-sentry-');
    resetConfigCache();
    resetSentryTestHooks();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (originalDsn === undefined) {
      delete process.env.SENTRY_DSN;
    } else {
      process.env.SENTRY_DSN = originalDsn;
    }
    if (originalEnvironment === undefined) {
      delete process.env.SENTRY_ENVIRONMENT;
    } else {
      process.env.SENTRY_ENVIRONMENT = originalEnvironment;
    }
    if (originalRelease === undefined) {
      delete process.env.SENTRY_RELEASE;
    } else {
      process.env.SENTRY_RELEASE = originalRelease;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
    resetConfigCache();
    resetSentryTestHooks();
  });

  it('loads Sentry connector config from blyp.config.ts', () => {
    process.chdir(tempDir);
    fs.writeFileSync(
      path.join(tempDir, 'blyp.config.ts'),
      [
        'export default {',
        '  connectors: {',
        '    sentry: {',
        '      enabled: true,',
        '      dsn: process.env.SENTRY_DSN,',
        '      environment: process.env.SENTRY_ENVIRONMENT,',
        '      release: process.env.SENTRY_RELEASE,',
        '    },',
        '  },',
        '};',
      ].join('\n')
    );
    process.env.SENTRY_DSN = 'https://public@example.ingest.sentry.io/1';
    process.env.SENTRY_ENVIRONMENT = 'production';
    process.env.SENTRY_RELEASE = '2026.03.11';

    const resolved = resolveConfig();
    const connector = resolved.connectors?.sentry as {
      enabled?: boolean;
      dsn?: string;
      environment?: string;
      release?: string;
      ready?: boolean;
    } | undefined;

    expect(connector?.enabled).toBe(true);
    expect(connector?.dsn).toBe(process.env.SENTRY_DSN);
    expect(connector?.environment).toBe('production');
    expect(connector?.release).toBe('2026.03.11');
    expect(connector?.ready).toBe(true);
  });

  it('auto-forwards server logs to Sentry and captures exceptions for Error payloads', () => {
    const fakeSentry = createFakeSentryModule();
    setSentryTestHooks({ module: fakeSentry.module as never });

    const logger = createStandaloneLogger({
      pretty: false,
      logDir: tempDir,
      connectors: {
        sentry: {
          enabled: true,
          mode: 'auto',
          dsn: 'https://public@example.ingest.sentry.io/1',
        },
      },
    });

    logger.info('hello');
    logger.error(new Error('boom'));
    const structured = logger.createStructuredLog('checkout', { orderId: 'ord_1' });
    structured.info('started');
    structured.emit({ status: 500, level: 'error', error: new Error('checkout failed') });

    expect(fakeSentry.initCalls).toHaveLength(1);
    expect(fakeSentry.logCalls.map((entry) => entry.message)).toEqual([
      'hello',
      'boom',
      'structured_log',
    ]);
    expect(fakeSentry.logCalls[1]?.level).toBe('error');
    expect(fakeSentry.logCalls[2]?.level).toBe('error');
    expect(fakeSentry.exceptionCalls).toHaveLength(2);
    const firstError = fakeSentry.exceptionCalls[0]?.error as Error;
    const secondError = fakeSentry.exceptionCalls[1]?.error as Error;
    expect(firstError.message).toBe('boom');
    expect(secondError.message).toBe('checkout failed');
  });

  it('does not auto-forward regular Blyp logs in manual mode', () => {
    const fakeSentry = createFakeSentryModule();
    setSentryTestHooks({ module: fakeSentry.module as never });

    const logger = createStandaloneLogger({
      pretty: false,
      logDir: tempDir,
      connectors: {
        sentry: {
          enabled: true,
          mode: 'manual',
          dsn: 'https://public@example.ingest.sentry.io/1',
        },
      },
    });

    logger.info('manual-mode');

    expect(fakeSentry.logCalls).toHaveLength(0);
  });

  it('supports manual Sentry-only loggers and structured loggers', () => {
    const fakeSentry = createFakeSentryModule();
    setSentryTestHooks({ module: fakeSentry.module as never });

    const logger = createSentryLogger({
      connectors: {
        sentry: {
          enabled: true,
          dsn: 'https://public@example.ingest.sentry.io/1',
        },
      },
    }).child({ feature: 'checkout' });
    logger.warn('manual warning', { retryable: true });

    const structured = createStructuredSentryLogger(
      'manual-checkout',
      { orderId: 'ord_2' },
      {
        connectors: {
          sentry: {
            enabled: true,
            dsn: 'https://public@example.ingest.sentry.io/1',
          },
        },
      }
    );
    structured.info('manual start');
    structured.emit({ status: 201 });

    expect(fakeSentry.logCalls).toHaveLength(2);
    const firstPayload = JSON.parse(
      String(fakeSentry.logCalls[0]?.attributes?.['blyp.payload'])
    ) as {
      bindings?: Record<string, unknown>;
    };
    expect(firstPayload.bindings).toEqual({ feature: 'checkout' });
    expect(fakeSentry.logCalls[1]?.attributes?.['blyp.group_id']).toBe('manual-checkout');
    expect(fs.existsSync(path.join(tempDir, 'log.ndjson'))).toBe(false);
  });

  it('downgrades missing manual configuration to a single local error', () => {
    const errors: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };

    const logger = createSentryLogger();
    logger.info('first');
    logger.info('second');

    console.error = originalError;
    expect(errors).toHaveLength(1);
    expect(String(errors[0]?.[0] ?? '')).toContain('Sentry connector is not configured');
  });

  it('reuses an existing initialized Sentry client instead of reinitializing', () => {
    const fakeSentry = createFakeSentryModule({
      dsn: 'https://existing@example.ingest.sentry.io/1',
    });
    setSentryTestHooks({ module: fakeSentry.module as never });

    const logger = createStandaloneLogger({
      pretty: false,
      logDir: tempDir,
      connectors: {
        sentry: {
          enabled: true,
        },
      },
    });

    logger.info('hello');

    expect(fakeSentry.initCalls).toHaveLength(0);
    expect(fakeSentry.logCalls).toHaveLength(1);
  });

  it('warns once and reuses the existing client when connector options differ', () => {
    const fakeSentry = createFakeSentryModule({
      dsn: 'https://existing@example.ingest.sentry.io/1',
      environment: 'staging',
      release: 'old',
    });
    setSentryTestHooks({ module: fakeSentry.module as never });

    const errors: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };

    const logger = createStandaloneLogger({
      pretty: false,
      logDir: tempDir,
      connectors: {
        sentry: {
          enabled: true,
          dsn: 'https://new@example.ingest.sentry.io/1',
          environment: 'production',
          release: 'new',
        },
      },
    });
    logger.info('first');
    logger.info('second');

    console.error = originalError;
    expect(fakeSentry.initCalls).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(String(errors[0]?.[0] ?? '')).toContain('already initialized');
    expect(fakeSentry.logCalls).toHaveLength(2);
  });

  it('forwards client connector requests to Sentry during ingestion', async () => {
    const fakeSentry = createFakeSentryModule();
    setSentryTestHooks({ module: fakeSentry.module as never });

    const shared = resolveServerLogger({
      pretty: false,
      logDir: tempDir,
      clientLogging: true,
      connectors: {
        sentry: {
          enabled: true,
          mode: 'manual',
          dsn: 'https://public@example.ingest.sentry.io/1',
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
        body: JSON.stringify(createClientPayload({ connector: 'sentry' })),
      }),
      deliveryPath: '/inngest',
    });
    await waitForFileFlush();

    expect(result.status).toBe(204);
    expect(result.headers?.['x-blyp-sentry-status']).toBe('enabled');
    expect(fakeSentry.logCalls).toHaveLength(1);
    expect(fakeSentry.logCalls[0]?.attributes?.['blyp.source']).toBe('client');
    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    expect(records.some((record) => record.message === '[client] frontend rendered')).toBe(true);
  });

  it('returns a missing header when the client requests Sentry but the server has no connector', async () => {
    const fakeSentry = createFakeSentryModule();
    setSentryTestHooks({ module: fakeSentry.module as never });

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
        body: JSON.stringify(createClientPayload({ connector: 'sentry' })),
      }),
      deliveryPath: '/inngest',
    });
    await waitForFileFlush();

    expect(result.status).toBe(204);
    expect(result.headers?.['x-blyp-sentry-status']).toBe('missing');
    expect(fakeSentry.logCalls).toHaveLength(0);
    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    expect(records.some((record) => record.message === '[client] frontend rendered')).toBe(true);
  });
});
