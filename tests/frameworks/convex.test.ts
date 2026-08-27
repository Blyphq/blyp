import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  applyConvexBlypConfig,
  configureConvexLogger,
  createConvexLogger,
  logger,
  resetConvexConfigWarningsForTests,
  resolveConvexFunctionKind,
} from '../../src/frameworks/convex';
import {
  canSendRemoteLogs,
} from '../../src/frameworks/convex/context';
import {
  buildOtlpLogsBody,
  resetConvexOtlpWarningsForTests,
  sendOtlpLog,
} from '../../src/frameworks/convex/otlp';

type ConsoleMethod = 'debug' | 'info' | 'warn' | 'error' | 'log' | 'table';
type ConsoleCalls = Record<ConsoleMethod, unknown[][]>;

const originalConsole = {
  debug: console.debug,
  info: console.info,
  warn: console.warn,
  error: console.error,
  log: console.log,
  table: console.table,
};

const ENV_KEYS = [
  'BLYP_OTLP_ENDPOINT',
  'BLYP_OTLP_AUTH',
  'BLYP_SERVICE_NAME',
  'OTEL_EXPORTER_OTLP_LOGS_ENDPOINT',
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'POSTHOG_PROJECT_KEY',
  'POSTHOG_HOST',
  'AXIOM_TOKEN',
  'AXIOM_API_TOKEN',
  'AXIOM_DATASET',
  'AXIOM_URL',
  'SOURCE_TOKEN',
  'BETTERSTACK_SOURCE_TOKEN',
  'INGESTING_HOST',
  'BETTERSTACK_INGESTING_HOST',
  'SENTRY_DSN',
  'DATABUDDY_API_KEY',
  'DATABUDDY_WEBSITE_ID',
  'DATABUDDY_API_URL',
] as const;

const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

function snapshotEnv(): void {
  for (const key of ENV_KEYS) {
    originalEnv[key] = process.env[key];
    delete process.env[key];
  }
}

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function createConsoleCalls(): ConsoleCalls {
  return {
    debug: [],
    info: [],
    warn: [],
    error: [],
    log: [],
    table: [],
  };
}

function installConsoleSpies(calls: ConsoleCalls): void {
  console.debug = (...args: unknown[]) => {
    calls.debug.push(args);
  };
  console.info = (...args: unknown[]) => {
    calls.info.push(args);
  };
  console.warn = (...args: unknown[]) => {
    calls.warn.push(args);
  };
  console.error = (...args: unknown[]) => {
    calls.error.push(args);
  };
  console.log = (...args: unknown[]) => {
    calls.log.push(args);
  };
  console.table = ((...args: unknown[]) => {
    calls.table.push(args);
  }) as typeof console.table;
}

function restoreConsole(): void {
  console.debug = originalConsole.debug;
  console.info = originalConsole.info;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
  console.log = originalConsole.log;
  console.table = originalConsole.table;
}

function queryCtx(): { db: object; auth: object } {
  return { db: {}, auth: {} };
}

function mutationCtx(): { db: object; auth: object; scheduler: object } {
  return { db: {}, auth: {}, scheduler: {} };
}

function actionCtx(): {
  runQuery: () => Promise<null>;
  runMutation: () => Promise<null>;
  runAction: () => Promise<null>;
} {
  return {
    runQuery: async () => null,
    runMutation: async () => null,
    runAction: async () => null,
  };
}

function firstPayload(calls: ConsoleCalls, method: ConsoleMethod = 'info'): Record<string, unknown> {
  return (calls[method][0]?.[0] ?? {}) as Record<string, unknown>;
}

function parseOtlp(body: string): {
  serviceName: string;
  message: string;
  severityText: string;
  severityNumber: number;
  attributes: Record<string, string>;
} {
  const parsed = JSON.parse(body) as {
    resourceLogs: Array<{
      resource: { attributes: Array<{ key: string; value: { stringValue: string } }> };
      scopeLogs: Array<{
        logRecords: Array<{
          body: { stringValue: string };
          severityText: string;
          severityNumber: number;
          attributes: Array<{ key: string; value: { stringValue: string } }>;
        }>;
      }>;
    }>;
  };

  const resource = parsed.resourceLogs[0]!;
  const record = resource.scopeLogs[0]!.logRecords[0]!;
  return {
    serviceName: resource.resource.attributes[0]!.value.stringValue,
    message: record.body.stringValue,
    severityText: record.severityText,
    severityNumber: record.severityNumber,
    attributes: Object.fromEntries(
      record.attributes.map((attribute) => [attribute.key, attribute.value.stringValue])
    ),
  };
}

describe('Convex context classification', () => {
  it('classifies Convex ctx objects without importing convex/server', () => {
    expect(resolveConvexFunctionKind(queryCtx())).toBe('query');
    expect(resolveConvexFunctionKind(mutationCtx())).toBe('mutation');
    expect(resolveConvexFunctionKind(actionCtx())).toBe('action');
    expect(resolveConvexFunctionKind({})).toBe('unknown');
    expect(resolveConvexFunctionKind(null)).toBe('unknown');
    expect(resolveConvexFunctionKind(undefined)).toBe('unknown');
    expect(resolveConvexFunctionKind('mutation')).toBe('unknown');
  });

  it('treats HTTP-action-shaped ctx with runQuery and runMutation as an action', () => {
    expect(resolveConvexFunctionKind({
      runQuery: async () => null,
      runMutation: async () => null,
      request: new Request('https://example.com/webhook'),
    })).toBe('action');
  });

  it('does not treat a null scheduler as a mutation', () => {
    expect(resolveConvexFunctionKind({ db: {}, scheduler: null })).toBe('query');
  });

  it('only allows remote export from actions', () => {
    expect(canSendRemoteLogs('action')).toBe(true);
    expect(canSendRemoteLogs('query')).toBe(false);
    expect(canSendRemoteLogs('mutation')).toBe(false);
    expect(canSendRemoteLogs('unknown')).toBe(false);
  });
});

describe('Convex logger', () => {
  let calls: ConsoleCalls;

  beforeEach(() => {
    snapshotEnv();
    calls = createConsoleCalls();
    restoreConsole();
    installConsoleSpies(calls);
    resetConvexOtlpWarningsForTests();
    resetConvexConfigWarningsForTests();
    configureConvexLogger({ otlp: false });
  });

  afterEach(async () => {
    await logger.flush();
    configureConvexLogger({ otlp: false });
    restoreConsole();
    restoreEnv();
  });

  it('writes a compact structured console payload from the default logger', () => {
    logger.info('send started', { body: 'hello' });

    expect(calls.info).toHaveLength(1);
    expect(firstPayload(calls)).toMatchObject({
      blyp: 1,
      level: 'info',
      msg: 'send started',
      source: 'convex',
      data: { body: 'hello' },
    });
  });

  it('maps each log level to the matching console method', () => {
    logger.debug('debug');
    logger.warn('warn');
    logger.warning('warning');
    logger.error('error');
    logger.critical('critical');
    logger.success('success');
    logger.table('rows', { ok: true });

    expect(firstPayload(calls, 'debug').level).toBe('debug');
    expect(firstPayload(calls, 'warn').level).toBe('warn');
    expect(calls.warn[1]?.[0]).toMatchObject({ level: 'warning', msg: 'warning' });
    expect(firstPayload(calls, 'error').level).toBe('error');
    expect(calls.error[1]?.[0]).toMatchObject({ level: 'critical', msg: 'critical' });
    expect(firstPayload(calls, 'log').level).toBe('success');
    expect(firstPayload(calls, 'info').level).toBe('table');
    expect(calls.table[0]?.[0]).toEqual({ ok: true });
  });

  it('redacts secrets before they reach console', () => {
    logger.info('auth', { token: 'super-secret', userId: 'user_1' });

    expect(firstPayload(calls).data).toEqual({
      token: '[REDACTED]',
      userId: 'user_1',
    });
  });

  it('applies extra redaction keys from logger config', () => {
    const log = createConvexLogger({
      otlp: false,
      redact: { keys: ['orderId'] },
    });

    log.info('charged', { orderId: 'ord_secret', plan: 'pro' });

    expect(firstPayload(calls).data).toEqual({
      orderId: '[REDACTED]',
      plan: 'pro',
    });
  });

  it('uses createConvexLogger for a separate instance', () => {
    const billing = createConvexLogger({
      serviceName: 'billing',
      function: 'billing:charge',
      otlp: false,
    });

    billing.info('charged');

    expect(firstPayload(calls)).toMatchObject({
      msg: 'charged',
      service: 'billing',
      function: 'billing:charge',
    });
  });

  it('lets child loggers add bindings without replacing the parent', () => {
    const parent = createConvexLogger({
      serviceName: 'api',
      function: 'messages:send',
      otlp: false,
    });
    parent.child({ requestId: 'req_1' }).info('child');
    parent.info('parent');

    expect(calls.info[0]?.[0]).toMatchObject({
      function: 'messages:send',
      requestId: 'req_1',
      msg: 'child',
    });
    expect(calls.info[1]?.[0]).toMatchObject({
      function: 'messages:send',
      msg: 'parent',
    });
    expect((calls.info[1]?.[0] as Record<string, unknown>).requestId).toBeUndefined();
  });

  it('updates the default logger through configureConvexLogger', () => {
    configureConvexLogger({
      serviceName: 'configured',
      otlp: false,
    });

    logger.info('after configure');

    expect(firstPayload(calls)).toMatchObject({
      service: 'configured',
      msg: 'after configure',
    });
  });

  it('does not export Convex function builders', async () => {
    const module = await import('../../src/frameworks/convex');
    expect('mutation' in module).toBe(false);
    expect('query' in module).toBe(false);
    expect('action' in module).toBe(false);
    expect('httpAction' in module).toBe(false);
    expect('internalMutation' in module).toBe(false);
  });

  it('does not send OTLP from queries, mutations, or unbound loggers', async () => {
    const sent: string[] = [];
    const log = createConvexLogger({
      otlp: { endpoint: 'https://otlp.example/v1/logs' },
      transport: async (body) => {
        sent.push(body);
        return { ok: true, status: 200 };
      },
    });

    log.info('unbound');
    log.bind(queryCtx()).info('query log');
    log.bind(mutationCtx()).info('mutation log');
    await log.flush();

    expect(sent).toEqual([]);
    expect(calls.info).toHaveLength(3);
  });

  it('does not send OTLP when otlp is disabled even on actions', async () => {
    const sent: string[] = [];
    const log = createConvexLogger({
      otlp: false,
      transport: async (body) => {
        sent.push(body);
        return { ok: true, status: 200 };
      },
    });

    log.bind(actionCtx()).info('action log');
    await log.flush();

    expect(sent).toEqual([]);
  });

  it('ignores non-http OTLP endpoints', async () => {
    const sent: string[] = [];
    const log = createConvexLogger({
      otlp: { endpoint: 'not-a-url' },
      transport: async (body) => {
        sent.push(body);
        return { ok: true, status: 200 };
      },
    });

    log.bind(actionCtx()).info('action log');
    await log.flush();

    expect(sent).toEqual([]);
  });

  it('sends OTLP from bound action loggers and flushes before returning', async () => {
    const sent: string[] = [];
    const log = createConvexLogger({
      serviceName: 'api',
      function: 'feeds:import',
      otlp: { endpoint: 'https://otlp.example/v1/logs' },
      transport: async (body) => {
        sent.push(body);
        return { ok: true, status: 200 };
      },
    });

    const bound = log.bind(actionCtx());
    bound.info('action log', { orderId: 'ord_1' });
    await bound.flush();

    expect(sent).toHaveLength(1);
    const otlp = parseOtlp(sent[0]!);
    expect(otlp.serviceName).toBe('api');
    expect(otlp.message).toBe('action log');
    expect(otlp.severityText).toBe('INFO');
    expect(otlp.attributes['blyp.function_kind']).toBe('action');
    expect(otlp.attributes['blyp.function']).toBe('feeds:import');
  });

  it('reads OTLP config from environment variables', async () => {
    process.env.BLYP_OTLP_ENDPOINT = 'https://otlp.env.example/v1/logs';
    process.env.BLYP_OTLP_AUTH = 'Bearer env-token';
    process.env.BLYP_SERVICE_NAME = 'from-env';

    const sent: Array<{ body: string; endpoint: string }> = [];
    const log = createConvexLogger({
      transport: async (body, endpoint) => {
        sent.push({ body, endpoint });
        return { ok: true, status: 200 };
      },
    });

    log.bind(actionCtx()).info('env log');
    await log.flush();

    expect(sent).toHaveLength(1);
    expect(sent[0]?.endpoint).toBe('https://otlp.env.example/v1/logs');
    expect(parseOtlp(sent[0]!.body).serviceName).toBe('from-env');
  });

  it('appends /v1/logs to OTEL_EXPORTER_OTLP_ENDPOINT', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://otel.example';

    const sent: string[] = [];
    const log = createConvexLogger({
      transport: async (_body, endpoint) => {
        sent.push(endpoint);
        return { ok: true, status: 200 };
      },
    });

    log.bind(actionCtx()).info('otel root');
    await log.flush();

    expect(sent).toEqual(['https://otel.example/v1/logs']);
  });

  it('lets wrap bind ctx for the default logger without wrapping Convex builders', async () => {
    const sent: string[] = [];
    configureConvexLogger({
      otlp: { endpoint: 'https://otlp.example/v1/logs' },
      transport: async (body) => {
        sent.push(body);
        return { ok: true, status: 200 };
      },
    });

    const handler = logger.wrap(async (_ctx: ReturnType<typeof actionCtx>, args: { id: string }) => {
      logger.info('wrapped', { id: args.id });
      return args.id;
    });

    const result = await handler(actionCtx(), { id: 'abc' });
    expect(result).toBe('abc');
    expect(sent).toHaveLength(1);
    expect(firstPayload(calls)).toMatchObject({
      msg: 'wrapped',
      functionKind: 'action',
      data: { id: 'abc' },
    });
  });

  it('does not fetch when wrap runs a query or mutation handler', async () => {
    const sent: string[] = [];
    const log = createConvexLogger({
      otlp: { endpoint: 'https://otlp.example/v1/logs' },
      transport: async (body) => {
        sent.push(body);
        return { ok: true, status: 200 };
      },
    });

    await log.wrap(async (_ctx: ReturnType<typeof queryCtx>) => {
      log.info('inside query');
    })(queryCtx());

    await log.wrap(async (_ctx: ReturnType<typeof mutationCtx>) => {
      log.info('inside mutation');
    })(mutationCtx());

    expect(sent).toEqual([]);
  });

  it('flushes action OTLP when the wrapped handler throws', async () => {
    const sent: string[] = [];
    const log = createConvexLogger({
      otlp: { endpoint: 'https://otlp.example/v1/logs' },
      transport: async (body) => {
        sent.push(body);
        return { ok: true, status: 200 };
      },
    });

    const handler = log.wrap(async (_ctx: ReturnType<typeof actionCtx>) => {
      log.info('before throw');
      throw new Error('boom');
    });

    await expect(handler(actionCtx())).rejects.toThrow('boom');
    expect(sent).toHaveLength(1);
  });

  it('prefers bind ctx over wrap ctx on that logger instance', async () => {
    const sent: string[] = [];
    const log = createConvexLogger({
      otlp: { endpoint: 'https://otlp.example/v1/logs' },
      transport: async (body) => {
        sent.push(body);
        return { ok: true, status: 200 };
      },
    });

    const queryBound = log.bind(queryCtx());
    await log.wrap(async () => {
      queryBound.info('still a query logger');
    })(actionCtx());

    expect(sent).toEqual([]);
    expect(firstPayload(calls).functionKind).toBe('query');
  });

  it('keeps wrap ctx isolated across overlapping action runs', async () => {
    const sent: Array<Record<string, unknown>> = [];
    const log = createConvexLogger({
      otlp: { endpoint: 'https://otlp.example/v1/logs' },
      transport: async (body) => {
        sent.push(JSON.parse(body) as Record<string, unknown>);
        return { ok: true, status: 200 };
      },
    });

    const handler = log.wrap(async (
      _ctx: ReturnType<typeof actionCtx>,
      args: { label: string; delayMs: number }
    ) => {
      await Bun.sleep(args.delayMs);
      log.child({ function: args.label }).info(args.label);
    });

    await Promise.all([
      handler(actionCtx(), { label: 'first', delayMs: 20 }),
      handler(actionCtx(), { label: 'second', delayMs: 5 }),
    ]);

    const messages = sent.map((body) => parseOtlp(JSON.stringify(body)).message);
    expect(messages.sort()).toEqual(['first', 'second']);
  });

  it('writes structured logs to console and OTLP from actions', async () => {
    const sent: string[] = [];
    const log = createConvexLogger({
      serviceName: 'api',
      otlp: { endpoint: 'https://otlp.example/v1/logs' },
      transport: async (body) => {
        sent.push(body);
        return { ok: true, status: 200 };
      },
    });

    const structured = log.bind(actionCtx()).createStructuredLog('checkout', { cart: 1 });
    structured.info('item added');
    structured.emit({ status: 200, message: 'checkout done' });
    await log.flush();

    expect(firstPayload(calls)).toMatchObject({
      blyp: 1,
      groupId: 'checkout',
      msg: 'checkout done',
      status: 200,
      source: 'convex',
      functionKind: 'action',
    });
    expect(sent).toHaveLength(1);
    expect(parseOtlp(sent[0]!).message).toBe('checkout done');
  });

  it('truncates oversized console payloads', () => {
    const log = createConvexLogger({ otlp: false });
    log.info('huge', { blob: 'x'.repeat(8_000) });

    const payload = firstPayload(calls);
    expect(payload.is_truncated).toBe(true);
    expect(payload.data).toBeUndefined();
    expect(JSON.stringify(payload).length).toBeLessThan(4_096);
  });

  it('posts OTLP over fetch when no test transport is provided', async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; method: string; contentType: string | null; body: string }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        method: init?.method ?? 'GET',
        contentType: new Headers(init?.headers).get('content-type'),
        body: String(init?.body ?? ''),
      });
      return new Response(null, { status: 200 });
    }) as typeof fetch;

    try {
      const log = createConvexLogger({
        otlp: {
          endpoint: 'https://otlp.example/v1/logs',
          headers: { Authorization: 'Bearer test' },
        },
      });

      log.bind(actionCtx()).error('export me');
      await log.flush();
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      url: 'https://otlp.example/v1/logs',
      method: 'POST',
      contentType: 'application/json',
    });
    expect(parseOtlp(requests[0]!.body).severityText).toBe('ERROR');
  });

  it('warns once when OTLP export fails and does not throw', async () => {
    const log = createConvexLogger({
      otlp: { endpoint: 'https://otlp.example/v1/logs' },
      transport: async () => ({ ok: false, status: 503, error: 'unavailable' }),
    });

    log.bind(actionCtx()).info('first');
    log.bind(actionCtx()).info('second');
    await log.flush();

    const warnings = calls.warn.map((args) => String(args[0]));
    expect(warnings.filter((message) => message.includes('Convex export failed'))).toHaveLength(1);
  });

  it('shutdown flushes pending action logs', async () => {
    const sent: string[] = [];
    const log = createConvexLogger({
      otlp: { endpoint: 'https://otlp.example/v1/logs' },
      transport: async (body) => {
        sent.push(body);
        return { ok: true, status: 200 };
      },
    });

    log.bind(actionCtx()).info('pending');
    await log.shutdown();
    expect(sent).toHaveLength(1);
  });

  it('uses auto OTLP targets from a shared blyp.config object', async () => {
    const sent: string[] = [];
    const log = createConvexLogger({
      destination: 'file',
      connectors: {
        posthog: {
          enabled: true,
          projectKey: 'phc_test',
        },
        otlp: [
          {
            name: 'axiom',
            endpoint: 'https://api.axiom.co/v1/logs',
            auth: 'Bearer axiom-token',
            headers: {
              'X-Axiom-Dataset': 'convex',
            },
          },
          {
            name: 'posthog',
            endpoint: 'https://us.i.posthog.com/i/v1/logs',
            auth: 'Bearer phc_test',
          },
          {
            name: 'manual-only',
            mode: 'manual',
            endpoint: 'https://manual.example/v1/logs',
          },
        ],
      },
      transport: async (_body, endpoint) => {
        sent.push(endpoint);
        return { ok: true, status: 200 };
      },
    });

    log.bind(actionCtx()).info('shared config');
    await log.flush();

    expect(sent.sort()).toEqual([
      'https://api.axiom.co/v1/logs',
      'https://us.i.posthog.com/i/v1/logs',
    ]);

    const warnings = calls.warn.map((args) => String(args[0]));
    expect(warnings.some((message) => message.includes('ignores file logging'))).toBe(true);
    expect(warnings.some((message) => message.includes('ignores connectors.posthog'))).toBe(false);
    expect(warnings.some((message) => message.includes('no remote sink'))).toBe(false);
  });

  it('maps connectors.posthog to PostHog logs OTLP', async () => {
    const sent: Array<{ endpoint: string }> = [];
    const log = createConvexLogger({
      connectors: {
        posthog: {
          enabled: true,
          projectKey: 'phc_test',
        },
      },
      transport: async (_body, endpoint) => {
        sent.push({ endpoint });
        return { ok: true, status: 200 };
      },
    });

    log.bind(actionCtx()).info('posthog shared');
    await log.flush();

    expect(sent.map((entry) => entry.endpoint)).toEqual([
      'https://us.i.posthog.com/i/v1/logs',
    ]);
    expect(calls.warn.some((args) => String(args[0]).includes('no remote sink'))).toBe(false);
  });

  it('exports Convex-local posthog and axiom configs over OTLP', async () => {
    const sent: string[] = [];
    const log = createConvexLogger({
      serviceName: 'api',
      posthog: {
        projectKey: 'phc_test',
      },
      axiom: {
        token: 'axiom-token',
        dataset: 'convex',
      },
      transport: async (_body, endpoint) => {
        sent.push(endpoint);
        return { ok: true, status: 200 };
      },
    });

    log.bind(actionCtx()).info('vendors');
    await log.flush();

    expect(sent.sort()).toEqual([
      'https://api.axiom.co/v1/logs',
      'https://us.i.posthog.com/i/v1/logs',
    ]);

    const resolved = applyConvexBlypConfig({
      serviceName: 'api',
      posthog: { projectKey: 'phc_test' },
      axiom: { token: 'axiom-token', dataset: 'convex' },
    });

    expect(resolved.otlp.targets).toEqual([
      {
        name: 'posthog',
        endpoint: 'https://us.i.posthog.com/i/v1/logs',
        headers: { Authorization: 'Bearer phc_test' },
        serviceName: 'api',
      },
      {
        name: 'axiom',
        endpoint: 'https://api.axiom.co/v1/logs',
        headers: {
          Authorization: 'Bearer axiom-token',
          'X-Axiom-Dataset': 'convex',
        },
        serviceName: 'api',
      },
    ]);
  });

  it('reads posthog and axiom env vars from empty vendor objects', () => {
    process.env.POSTHOG_PROJECT_KEY = 'phc_from_env';
    process.env.POSTHOG_HOST = 'https://eu.i.posthog.com';
    process.env.AXIOM_TOKEN = 'axiom-from-env';
    process.env.AXIOM_DATASET = 'convex-env';
    process.env.AXIOM_URL = 'https://api.eu.axiom.co';

    const resolved = applyConvexBlypConfig({
      posthog: {},
      axiom: {},
    });

    expect(resolved.otlp.targets).toEqual([
      {
        name: 'posthog',
        endpoint: 'https://eu.i.posthog.com/i/v1/logs',
        headers: { Authorization: 'Bearer phc_from_env' },
        serviceName: 'convex',
      },
      {
        name: 'axiom',
        endpoint: 'https://api.eu.axiom.co/v1/logs',
        headers: {
          Authorization: 'Bearer axiom-from-env',
          'X-Axiom-Dataset': 'convex-env',
        },
        serviceName: 'convex',
      },
    ]);
  });

  it('lets otlp: false disable every vendor target', () => {
    const resolved = applyConvexBlypConfig({
      otlp: false,
      posthog: { projectKey: 'phc_test' },
      axiom: { token: 'axiom-token', dataset: 'convex' },
      betterstack: {
        sourceToken: 'src_token',
        ingestingHost: 'https://in.logs.betterstack.com',
      },
      sentry: { dsn: 'https://public@o1.ingest.sentry.io/99' },
      databuddy: { apiKey: 'db_key', websiteId: 'site_1' },
      http: [{ name: 'webhook', endpoint: 'https://hooks.example/logs' }],
    });

    expect(resolved.otlp.enabled).toBe(false);
    expect(resolved.otlp.targets).toEqual([]);
  });

  it('lets vendor false skip the matching shared connector', () => {
    const resolved = applyConvexBlypConfig({
      posthog: false,
      betterstack: false,
      sentry: false,
      databuddy: false,
      http: false,
      connectors: {
        posthog: {
          enabled: true,
          projectKey: 'phc_test',
        },
        betterstack: {
          enabled: true,
          sourceToken: 'src_token',
          ingestingHost: 'https://in.logs.betterstack.com',
        },
        sentry: {
          enabled: true,
          dsn: 'https://public@o1.ingest.sentry.io/99',
        },
        databuddy: {
          enabled: true,
          apiKey: 'db_key',
          websiteId: 'site_1',
        },
        http: [{
          name: 'webhook',
          endpoint: 'https://hooks.example/logs',
        }],
      },
    });

    expect(resolved.otlp.enabled).toBe(false);
    expect(resolved.otlp.targets).toEqual([]);
  });

  it('maps Convex-local betterstack, sentry, databuddy, and http configs', async () => {
    const sent: Array<{ endpoint: string; body: string }> = [];
    const log = createConvexLogger({
      serviceName: 'api',
      betterstack: {
        sourceToken: 'src_token',
        ingestingHost: 'https://in.logs.betterstack.com',
      },
      sentry: {
        dsn: 'https://public@o123.ingest.sentry.io/456',
      },
      databuddy: {
        apiKey: 'db_key',
        websiteId: 'site_1',
        namespace: 'convex',
      },
      http: [{
        name: 'webhook',
        endpoint: 'https://hooks.example/logs',
        auth: 'Bearer hook-token',
      }],
      transport: async (body, endpoint) => {
        sent.push({ body, endpoint });
        return { ok: true, status: 200 };
      },
    });

    log.bind(actionCtx()).info('vendors');
    await log.flush();

    expect(sent.map((entry) => entry.endpoint).sort()).toEqual([
      'https://basket.databuddy.cc/track',
      'https://hooks.example/logs',
      'https://in.logs.betterstack.com/v1/logs',
      'https://o123.ingest.sentry.io/api/456/integration/otlp/v1/logs',
    ]);

    const resolved = applyConvexBlypConfig({
      serviceName: 'api',
      betterstack: {
        sourceToken: 'src_token',
        ingestingHost: 'https://in.logs.betterstack.com',
      },
      sentry: {
        dsn: 'https://public@o123.ingest.sentry.io/456',
      },
      databuddy: {
        apiKey: 'db_key',
        websiteId: 'site_1',
        namespace: 'convex',
      },
      http: [{
        name: 'webhook',
        endpoint: 'https://hooks.example/logs',
        auth: 'Bearer hook-token',
      }],
    });

    expect(resolved.otlp.targets).toEqual([
      {
        name: 'betterstack',
        endpoint: 'https://in.logs.betterstack.com/v1/logs',
        headers: { Authorization: 'Bearer src_token' },
        serviceName: 'api',
      },
      {
        name: 'sentry',
        endpoint: 'https://o123.ingest.sentry.io/api/456/integration/otlp/v1/logs',
        headers: { 'x-sentry-auth': 'sentry sentry_key=public' },
        serviceName: 'api',
      },
      {
        name: 'databuddy',
        endpoint: 'https://basket.databuddy.cc/track',
        headers: { Authorization: 'Bearer db_key' },
        serviceName: 'api',
        format: 'databuddy',
        websiteId: 'site_1',
        namespace: 'convex',
        source: 'convex',
      },
      {
        name: 'webhook',
        endpoint: 'https://hooks.example/logs',
        headers: { Authorization: 'Bearer hook-token' },
        serviceName: 'api',
        format: 'http',
      },
    ]);

    const databuddyBody = JSON.parse(
      sent.find((entry) => entry.endpoint.includes('basket.databuddy.cc'))!.body
    ) as { name: string; websiteId: string; properties: { message: string } };
    expect(databuddyBody).toMatchObject({
      name: 'log',
      websiteId: 'site_1',
      properties: { message: 'vendors' },
    });

    const httpBody = JSON.parse(
      sent.find((entry) => entry.endpoint === 'https://hooks.example/logs')!.body
    ) as { source: string; target: string; message: string };
    expect(httpBody).toMatchObject({
      source: 'server',
      target: 'webhook',
      message: 'vendors',
    });

    const sentryBody = sent.find((entry) => entry.endpoint.includes('ingest.sentry.io'))!.body;
    expect(parseOtlp(sentryBody).severityText).toBe('INFO');
  });

  it('maps shared betterstack, sentry, databuddy, and http connectors', () => {
    const resolved = applyConvexBlypConfig({
      connectors: {
        betterstack: {
          enabled: true,
          sourceToken: 'src_token',
          ingestingHost: 'https://in.logs.betterstack.com',
        },
        sentry: {
          enabled: true,
          dsn: 'https://public@example.ingest.sentry.io/1',
        },
        databuddy: {
          enabled: true,
          apiKey: 'db_key',
          websiteId: 'site_1',
        },
        http: [{
          name: 'webhook',
          endpoint: 'https://hooks.example/logs',
        }],
      },
    });

    expect(resolved.otlp.targets?.map((target) => target.name)).toEqual([
      'betterstack',
      'sentry',
      'databuddy',
      'webhook',
    ]);
    expect(calls.warn.some((args) => String(args[0]).includes('ignores connectors.'))).toBe(false);
  });

  it('reads sentry and databuddy env vars from empty vendor objects', () => {
    process.env.SENTRY_DSN = 'https://key@o9.ingest.sentry.io/77';
    process.env.DATABUDDY_API_KEY = 'db_from_env';
    process.env.DATABUDDY_WEBSITE_ID = 'site_env';

    const resolved = applyConvexBlypConfig({
      sentry: {},
      databuddy: {},
    });

    expect(resolved.otlp.targets).toEqual([
      {
        name: 'sentry',
        endpoint: 'https://o9.ingest.sentry.io/api/77/integration/otlp/v1/logs',
        headers: { 'x-sentry-auth': 'sentry sentry_key=key' },
        serviceName: 'convex',
      },
      {
        name: 'databuddy',
        endpoint: 'https://basket.databuddy.cc/track',
        headers: { Authorization: 'Bearer db_from_env' },
        serviceName: 'convex',
        format: 'databuddy',
        websiteId: 'site_env',
        source: 'convex',
      },
    ]);
  });

  it('keeps two Axiom datasets as separate targets', () => {
    const resolved = applyConvexBlypConfig({
      axiom: {
        token: 'shared-token',
        dataset: 'frontend',
      },
      connectors: {
        otlp: [{
          name: 'axiom-backend',
          endpoint: 'https://api.axiom.co/v1/logs',
          auth: 'Bearer shared-token',
          headers: {
            'X-Axiom-Dataset': 'backend',
          },
        }],
      },
    });

    expect(resolved.otlp.targets).toEqual([
      {
        name: 'axiom-backend',
        endpoint: 'https://api.axiom.co/v1/logs',
        headers: {
          Authorization: 'Bearer shared-token',
          'X-Axiom-Dataset': 'backend',
        },
        serviceName: 'convex',
      },
      {
        name: 'axiom',
        endpoint: 'https://api.axiom.co/v1/logs',
        headers: {
          Authorization: 'Bearer shared-token',
          'X-Axiom-Dataset': 'frontend',
        },
        serviceName: 'convex',
      },
    ]);
  });

  it('warns and stays console-only when a shared config has no remote sink', () => {
    const log = createConvexLogger({
      destination: 'file',
      connectors: {
        delivery: {
          enabled: true,
        },
      },
    });

    log.bind(actionCtx()).info('console only');

    expect(firstPayload(calls)).toMatchObject({
      msg: 'console only',
      source: 'convex',
    });

    const warnings = calls.warn.map((args) => String(args[0]));
    expect(warnings.some((message) => message.includes('ignores file logging'))).toBe(true);
    expect(warnings.some((message) => message.includes('ignores connector delivery queues'))).toBe(true);
    expect(warnings.some((message) => message.includes('no remote sink configured'))).toBe(true);
  });

  it('does not warn about unused sinks for Convex-only otlp config', () => {
    createConvexLogger({
      otlp: { endpoint: 'https://otlp.example/v1/logs' },
    });

    expect(calls.warn).toEqual([]);
  });

  it('respects level from a shared blyp config', () => {
    const log = createConvexLogger({
      level: 'error',
      otlp: false,
    });

    log.debug('hidden');
    log.info('also hidden');
    log.error('visible');

    expect(calls.info).toEqual([]);
    expect(firstPayload(calls, 'error').msg).toBe('visible');
  });

  it('lets otlp: false disable shared connectors.otlp targets', () => {
    const resolved = applyConvexBlypConfig({
      otlp: false,
      connectors: {
        otlp: [{
          name: 'axiom',
          endpoint: 'https://api.axiom.co/v1/logs',
        }],
      },
    });

    expect(resolved.otlp.enabled).toBe(false);
    expect(resolved.otlp.targets).toEqual([]);
  });

  it('does not import node logger internals', async () => {
    const files = [
      '../../src/frameworks/convex/logger.ts',
      '../../src/frameworks/convex/config.ts',
      '../../src/frameworks/convex/otlp.ts',
      '../../src/frameworks/convex/index.ts',
      '../../src/config.ts',
      '../../src/core/define-config.ts',
    ];

    for (const file of files) {
      const source = await Bun.file(new URL(file, import.meta.url)).text();
      expect(source).not.toContain("from '../../core/logger'");
      expect(source).not.toContain("from '../../core/file-logger'");
      expect(source).not.toContain("from '../../core/config'");
      expect(source).not.toContain("from '../../connectors/otlp/sender'");
      expect(source).not.toContain("from 'pino'");
      expect(source).not.toContain('convex/server');
      expect(source).not.toContain('from \'zod\'');
      expect(source).not.toContain("from 'fs'");
      expect(source).not.toContain("from 'jiti'");
    }
  });
});

describe('Convex OTLP payload', () => {
  it('maps blyp levels onto OTLP severity', () => {
    const config = {
      enabled: true,
      endpoint: 'https://otlp.example/v1/logs',
      headers: {},
      serviceName: 'api',
    };

    expect(parseOtlp(buildOtlpLogsBody({
      timestamp: '2026-08-24T00:00:00.000Z',
      level: 'debug',
      message: 'd',
      serviceName: 'api',
      attributes: {},
    }, config)).severityNumber).toBe(5);

    expect(parseOtlp(buildOtlpLogsBody({
      timestamp: '2026-08-24T00:00:00.000Z',
      level: 'warning',
      message: 'w',
      serviceName: 'api',
      attributes: {},
    }, config)).severityText).toBe('WARN');

    expect(parseOtlp(buildOtlpLogsBody({
      timestamp: '2026-08-24T00:00:00.000Z',
      level: 'critical',
      message: 'c',
      serviceName: 'api',
      attributes: {},
    }, config)).severityText).toBe('FATAL');
  });

  it('skips send when OTLP is not enabled', async () => {
    let called = false;
    await sendOtlpLog({
      timestamp: new Date().toISOString(),
      level: 'info',
      message: 'skip',
      serviceName: 'api',
      attributes: {},
    }, {
      enabled: false,
      headers: {},
      serviceName: 'api',
    }, async () => {
      called = true;
      return { ok: true };
    });

    expect(called).toBe(false);
  });
});