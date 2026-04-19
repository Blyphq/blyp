import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { resetConfigCache, resolveConfig } from '../src/core/config';
import {
  resetHTTPTestHooks,
  setHTTPTestHooks,
} from '../src/connectors/http/sender';
import type { HTTPNormalizedRecord } from '../src/types/connectors/http';
import {
  createHttpLogger,
  createStructuredHttpLogger,
  normalizeHTTPRecord,
} from '../src/connectors/http';
import { resolveServerLogger, handleClientLogIngestion } from '../src/frameworks/shared';
import { createStandaloneLogger } from '../src/frameworks/standalone';
import { createClientPayload } from './helpers/client-payload';
import { makeTempDir, readJsonLines, waitForFileFlush } from './helpers/fs';
import { isClientLogEvent } from '../src/shared/client-log';

describe('HTTP Connector', () => {
  let originalCwd: string;
  let tempDir: string;
  let originalFetch: typeof fetch | undefined;

  beforeEach(() => {
    originalCwd = process.cwd();
    tempDir = makeTempDir('blyp-http-');
    originalFetch = globalThis.fetch;
    resetConfigCache();
    resetHTTPTestHooks();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    } else {
      delete (globalThis as { fetch?: typeof fetch }).fetch;
    }
    resetConfigCache();
    resetHTTPTestHooks();
  });

  it('loads HTTP connector config from blyp.config.ts', () => {
    process.chdir(tempDir);
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify({ name: 'http-app' }, null, 2)
    );
    fs.writeFileSync(
      path.join(tempDir, 'blyp.config.ts'),
      [
        'export default {',
        '  connectors: {',
        '    http: [',
        '      {',
        '        name: "webhook",',
        '        enabled: true,',
        '        endpoint: "https://logs.example.test/ingest",',
        '      },',
        '    ],',
        '  },',
        '};',
      ].join('\n')
    );

    const resolved = resolveConfig();
    const connector = resolved.connectors?.http?.[0] as {
      enabled?: boolean;
      endpoint?: string;
      serviceName?: string;
      ready?: boolean;
    } | undefined;

    expect(connector?.enabled).toBe(true);
    expect(connector?.endpoint).toBe('https://logs.example.test/ingest');
    expect(connector?.serviceName).toBe('http-app');
    expect(connector?.ready).toBe(true);
    expect(fs.existsSync(path.join(tempDir, 'blyp.config.json'))).toBe(false);
  });

  it('replaces the config HTTP array when runtime overrides provide HTTP connectors', () => {
    process.chdir(tempDir);
    fs.writeFileSync(
      path.join(tempDir, 'blyp.config.json'),
      JSON.stringify({
        connectors: {
          http: [
            {
              name: 'webhook',
              enabled: true,
              endpoint: 'https://logs.example.test/ingest',
            },
          ],
        },
      })
    );

    const resolved = resolveConfig({
      connectors: {
        http: [
          {
            name: 'audit',
            enabled: true,
            endpoint: 'https://audit.example.test/logs',
          },
        ],
      },
    });

    expect(resolved.connectors?.http).toHaveLength(1);
    expect(resolved.connectors?.http?.[0]?.name).toBe('audit');
  });

  it('auto-forwards server logs to every ready HTTP auto target and skips client_log records', () => {
    const emitted: Array<{ name: string; payload: HTTPNormalizedRecord }> = [];
    setHTTPTestHooks({
      createTransport: (config) => ({
        emit(payload) {
          emitted.push({ name: config.name, payload });
          return { ok: true };
        },
      }),
    });

    const logger = createStandaloneLogger({
      pretty: false,
      logDir: tempDir,
      connectors: {
        http: [
          {
            name: 'webhook',
            enabled: true,
            mode: 'auto',
            endpoint: 'https://logs.example.test/ingest',
            serviceName: 'svc',
          },
          {
            name: 'audit',
            enabled: true,
            mode: 'auto',
            endpoint: 'https://audit.example.test/logs',
            serviceName: 'svc',
          },
        ],
      },
    });

    logger.info('hello');
    logger.info('[client] ignored', { type: 'client_log', page: { pathname: '/app' } });
    const structured = logger.createStructuredLog('checkout', { orderId: 'ord_1' });
    structured.info('started');
    structured.emit({ status: 200 });

    expect(emitted).toHaveLength(4);
    expect(emitted.map((entry) => entry.name)).toEqual([
      'webhook',
      'audit',
      'webhook',
      'audit',
    ]);
    expect(emitted[2]?.payload.metadata?.groupId).toBe('checkout');
    expect(emitted[2]?.payload.metadata?.traceId).toBeUndefined();
  });

  it('does not auto-forward regular Blyp logs in manual mode', () => {
    const emitted: HTTPNormalizedRecord[] = [];
    setHTTPTestHooks({
      createTransport: () => ({
        emit(payload) {
          emitted.push(payload);
          return { ok: true };
        },
      }),
    });

    const logger = createStandaloneLogger({
      pretty: false,
      logDir: tempDir,
      connectors: {
        http: [
          {
            name: 'webhook',
            enabled: true,
            mode: 'manual',
            endpoint: 'https://logs.example.test/ingest',
            serviceName: 'svc',
          },
        ],
      },
    });

    logger.info('manual-mode');

    expect(emitted).toHaveLength(0);
  });

  it('supports manual HTTP-only loggers and structured loggers for named targets', () => {
    const emitted: Array<{ name: string; payload: HTTPNormalizedRecord }> = [];
    setHTTPTestHooks({
      createTransport: (config) => ({
        emit(payload) {
          emitted.push({ name: config.name, payload });
          return { ok: true };
        },
      }),
    });

    const connectors = {
      http: [
        {
          name: 'webhook',
          enabled: true,
          endpoint: 'https://logs.example.test/ingest',
          serviceName: 'svc',
        },
        {
          name: 'audit',
          enabled: true,
          endpoint: 'https://audit.example.test/logs',
          serviceName: 'svc',
        },
      ],
    };

    const logger = createHttpLogger({
      name: 'webhook',
      connectors,
    }).child({ feature: 'checkout' });
    logger.warn('manual warning', { retryable: true });

    const structured = createStructuredHttpLogger(
      'manual-checkout',
      { orderId: 'ord_2' },
      {
        name: 'audit',
        connectors,
      }
    );
    structured.info('manual start');
    structured.emit({ status: 201 });

    expect(emitted).toHaveLength(2);
    expect(emitted[0]?.name).toBe('webhook');
    expect(emitted[1]?.name).toBe('audit');
    expect(emitted[0]?.payload.payload.bindings).toEqual({ feature: 'checkout' });
    expect(emitted[1]?.payload.metadata?.groupId).toBe('manual-checkout');
    expect(fs.existsSync(path.join(tempDir, 'log.ndjson'))).toBe(false);
  });

  it('downgrades missing manual HTTP targets to a single local error', () => {
    const errors: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };

    const logger = createHttpLogger({
      name: 'webhook',
      connectors: {
        http: [],
      },
    });
    logger.info('first');
    logger.info('second');

    console.error = originalError;
    expect(errors).toHaveLength(1);
    expect(String(errors[0]?.[0] ?? '')).toContain('HTTP target "webhook"');
  });

  it('prefers headers.Authorization over auth', () => {
    const captured: string[] = [];
    setHTTPTestHooks({
      createTransport: (config) => {
        captured.push(config.headers.Authorization ?? '');
        return {
          emit() {
            return { ok: true };
          },
        };
      },
    });

    const logger = createStandaloneLogger({
      pretty: false,
      logDir: tempDir,
      connectors: {
        http: [
          {
            name: 'webhook',
            enabled: true,
            endpoint: 'https://logs.example.test/ingest',
            headers: {
              Authorization: 'Api-Token explicit',
            },
            auth: 'Bearer ignored',
          },
        ],
      },
    });

    logger.info('hello');

    expect(captured).toEqual(['Api-Token explicit']);
  });

  it('sends POST application/json requests with the normalized wrapper payload', async () => {
    const requests: Array<{
      url: string;
      method?: string;
      headers?: HeadersInit;
      body?: string;
    }> = [];

    globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: typeof url === 'string' ? url : String(url),
        method: init?.method,
        headers: init?.headers,
        body: typeof init?.body === 'string' ? init.body : undefined,
      });

      return Promise.resolve(new Response(null, { status: 204 }));
    }) as typeof fetch;

    const logger = createStandaloneLogger({
      pretty: false,
      logDir: tempDir,
      connectors: {
        http: [
          {
            name: 'webhook',
            enabled: true,
            endpoint: 'https://logs.example.test/ingest',
            headers: {
              Accept: 'text/plain',
              'content-type': 'text/plain',
              'x-api-key': 'secret',
            },
            serviceName: 'svc',
          },
        ],
      },
    });

    logger.info('hello world', { type: 'http_request', path: '/checkout', status: 200 });
    await waitForFileFlush();

    expect(requests).toHaveLength(1);
    const request = requests[0]!;
    expect(request.url).toBe('https://logs.example.test/ingest');
    expect(request.method).toBe('POST');

    const headers = new Headers(request.headers);
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('accept')).toBe('application/json');
    expect(headers.get('x-api-key')).toBe('secret');

    const payload = JSON.parse(String(request.body)) as HTTPNormalizedRecord;
    expect(payload.message).toBe('hello world');
    expect(payload.serviceName).toBe('svc');
    expect(payload.target).toBe('webhook');
    expect(payload.source).toBe('server');
    expect(payload.payload.message).toBe('hello world');
    expect(payload.metadata?.type).toBe('http_request');
    expect(payload.metadata?.http).toEqual({
      path: '/checkout',
      statusCode: 200,
    });
  });

  it('normalizes HTTP wrapper metadata and omits empty sections', () => {
    const normalized = normalizeHTTPRecord(
      {
        timestamp: '2026-04-19T12:34:56.000Z',
        level: 'info',
        message: 'frontend rendered',
        caller: 'src/app.ts:42',
        traceId: 'abc123',
        groupId: 'checkout',
        type: 'http_request',
        path: '/checkout',
        method: 'GET',
        status: 200,
        duration: 18,
      },
      {
        name: 'customer-webhook',
        enabled: true,
        mode: 'auto',
        endpoint: 'https://logs.example.test/ingest',
        headers: {},
        auth: undefined,
        serviceName: 'blyp-app',
        ready: true,
        status: 'enabled',
      }
    );

    expect(normalized).toEqual({
      timestamp: '2026-04-19T12:34:56.000Z',
      level: 'info',
      message: 'frontend rendered',
      source: 'server',
      serviceName: 'blyp-app',
      target: 'customer-webhook',
      metadata: {
        type: 'http_request',
        caller: 'src/app.ts:42',
        groupId: 'checkout',
        traceId: 'abc123',
        http: {
          method: 'GET',
          path: '/checkout',
          statusCode: 200,
          durationMs: 18,
        },
      },
      payload: {
        timestamp: '2026-04-19T12:34:56.000Z',
        level: 'info',
        message: 'frontend rendered',
        caller: 'src/app.ts:42',
        traceId: 'abc123',
        groupId: 'checkout',
        type: 'http_request',
        path: '/checkout',
        method: 'GET',
        status: 200,
        duration: 18,
      },
    });
  });

  it('forwards client connector requests to named HTTP targets during ingestion', async () => {
    const emitted: Array<{ name: string; payload: HTTPNormalizedRecord }> = [];
    setHTTPTestHooks({
      createTransport: (config) => ({
        emit(payload) {
          emitted.push({ name: config.name, payload });
          return { ok: true };
        },
      }),
    });

    const shared = resolveServerLogger({
      pretty: false,
      logDir: tempDir,
      clientLogging: true,
      connectors: {
        http: [
          {
            name: 'webhook',
            enabled: true,
            mode: 'manual',
            endpoint: 'https://logs.example.test/ingest',
            serviceName: 'svc',
          },
        ],
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
          connector: { type: 'http', name: 'webhook' },
        })),
      }),
      deliveryPath: '/inngest',
    });
    await waitForFileFlush();

    expect(result.status).toBe(204);
    expect(result.headers?.['x-blyp-http-status']).toBe('enabled');
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.name).toBe('webhook');
    expect(emitted[0]?.payload.source).toBe('client');
    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    expect(records.some((record) => record.message === '[client] frontend rendered')).toBe(true);
  });

  it('returns a missing header when the requested HTTP target is absent', async () => {
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
        body: JSON.stringify(createClientPayload({
          connector: { type: 'http', name: 'webhook' },
        })),
      }),
      deliveryPath: '/inngest',
    });
    await waitForFileFlush();

    expect(result.status).toBe(204);
    expect(result.headers?.['x-blyp-http-status']).toBe('missing');
  });

  it('returns a missing header when the requested HTTP target is invalid', async () => {
    const shared = resolveServerLogger({
      pretty: false,
      logDir: tempDir,
      clientLogging: true,
      connectors: {
        http: [
          {
            name: 'webhook',
            enabled: true,
            mode: 'manual',
            endpoint: '/relative-path',
            serviceName: 'svc',
          },
        ],
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
          connector: { type: 'http', name: 'webhook' },
        })),
      }),
      deliveryPath: '/inngest',
    });
    await waitForFileFlush();

    expect(result.status).toBe(204);
    expect(result.headers?.['x-blyp-http-status']).toBe('missing');
  });

  it('accepts HTTP client connector payloads and rejects invalid connector objects', () => {
    expect(isClientLogEvent(createClientPayload({
      connector: { type: 'http', name: 'webhook' },
    }))).toBe(true);

    expect(isClientLogEvent(createClientPayload({
      connector: { type: 'http', name: '' },
    }))).toBe(false);

    const invalidPayload = createClientPayload() as unknown as {
      connector?: unknown;
    };
    invalidPayload.connector = { type: 'else', name: 'webhook' };

    expect(isClientLogEvent(invalidPayload)).toBe(false);
  });
});
