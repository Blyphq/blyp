import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { resetConfigCache, resolveConfig } from '../src/core/config';
import {
  resetBetterStackTestHooks,
  setBetterStackTestHooks,
} from '../src/connectors/betterstack/sender';
import {
  createBetterStackLogger,
  createStructuredBetterStackLogger,
} from '../src/connectors/betterstack';
import { handleClientLogIngestion, resolveServerLogger } from '../src/frameworks/shared';
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

describe('Better Stack Connector', () => {
  let originalCwd: string;
  let tempDir: string;
  let originalSourceToken: string | undefined;
  let originalIngestingHost: string | undefined;

  beforeEach(() => {
    originalCwd = process.cwd();
    originalSourceToken = process.env.SOURCE_TOKEN;
    originalIngestingHost = process.env.INGESTING_HOST;
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
        '    },',
        '  },',
        '};',
      ].join('\n')
    );
    process.env.SOURCE_TOKEN = 'src_test_token';
    process.env.INGESTING_HOST = 'https://in.logs.betterstack.com';

    const resolved = resolveConfig();
    const connector = resolved.connectors?.betterstack as {
      enabled?: boolean;
      sourceToken?: string;
      ingestingHost?: string;
      serviceName?: string;
      ready?: boolean;
    } | undefined;

    expect(connector?.enabled).toBe(true);
    expect(connector?.sourceToken).toBe('src_test_token');
    expect(connector?.ingestingHost).toBe('https://in.logs.betterstack.com');
    expect(connector?.serviceName).toBe('betterstack-app');
    expect(connector?.ready).toBe(true);
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

  it('forwards client connector requests to Better Stack during ingestion', async () => {
    const runtime = createFakeBetterStackClient();
    setBetterStackTestHooks({ createClient: () => runtime.client });

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
    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    expect(records.some((record) => record.message === '[client] frontend rendered')).toBe(true);
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
