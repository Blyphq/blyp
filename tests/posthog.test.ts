import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { resetConfigCache, resolveConfig } from '../src/core/config';
import {
  resetPostHogTestHooks,
  setPostHogTestHooks,
  type PostHogNormalizedRecord,
} from '../src/core/posthog';
import { createPosthogLogger, createStructuredPosthogLogger } from '../src/frameworks/posthog';
import { resolveServerLogger, handleClientLogIngestion } from '../src/frameworks/shared';
import { createStandaloneLogger } from '../src/frameworks/standalone';
import { createClientPayload } from './helpers/client-payload';
import { makeTempDir, readJsonLines, waitForFileFlush } from './helpers/fs';

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
    const emitted: PostHogNormalizedRecord[] = [];
    setPostHogTestHooks({
      createTransport: () => ({
        emit(payload) {
          emitted.push(payload);
        },
      }),
    });

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

    expect(emitted).toHaveLength(4);
    expect(emitted.map((entry) => entry.body)).toEqual([
      'hello',
      'boom',
      'Users',
      'structured_log',
    ]);
    expect(emitted[3]?.attributes['blyp.group_id']).toBe('checkout');
  });

  it('does not auto-forward regular Blyp logs in manual mode', () => {
    const emitted: PostHogNormalizedRecord[] = [];
    setPostHogTestHooks({
      createTransport: () => ({
        emit(payload) {
          emitted.push(payload);
        },
      }),
    });

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

    expect(emitted).toHaveLength(0);
  });

  it('supports manual PostHog-only loggers and structured loggers', () => {
    const emitted: PostHogNormalizedRecord[] = [];
    setPostHogTestHooks({
      createTransport: () => ({
        emit(payload) {
          emitted.push(payload);
        },
      }),
    });

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

    expect(emitted).toHaveLength(2);
    const manualPayload = JSON.parse(String(emitted[0]?.attributes['blyp.payload'])) as {
      bindings?: Record<string, unknown>;
    };
    expect(manualPayload.bindings).toEqual({ feature: 'checkout' });
    expect(emitted[1]?.attributes['blyp.group_id']).toBe('manual-checkout');
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

  it('forwards client connector requests to PostHog during ingestion', async () => {
    const emitted: PostHogNormalizedRecord[] = [];
    setPostHogTestHooks({
      createTransport: () => ({
        emit(payload) {
          emitted.push(payload);
        },
      }),
    });

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
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.attributes['blyp.source']).toBe('client');
    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    expect(records.some((record) => record.message === '[client] frontend rendered')).toBe(true);
  });

  it('returns a missing header when the client requests PostHog but the server has no connector', async () => {
    const emitted: PostHogNormalizedRecord[] = [];
    setPostHogTestHooks({
      createTransport: () => ({
        emit(payload) {
          emitted.push(payload);
        },
      }),
    });

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
    expect(emitted).toHaveLength(0);
    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    expect(records.some((record) => record.message === '[client] frontend rendered')).toBe(true);
  });
});
