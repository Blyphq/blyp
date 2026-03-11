import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { resetConfigCache, resolveConfig } from '../src/core/config';
import {
  resetOTLPTestHooks,
  setOTLPTestHooks,
} from '../src/connectors/otlp/sender';
import type { OTLPNormalizedRecord } from '../src/types/connectors/otlp';
import { createOtlpLogger, createStructuredOtlpLogger } from '../src/connectors/otlp';
import { resolveServerLogger, handleClientLogIngestion } from '../src/frameworks/shared';
import { createStandaloneLogger } from '../src/frameworks/standalone';
import { createClientPayload } from './helpers/client-payload';
import { makeTempDir, readJsonLines, waitForFileFlush } from './helpers/fs';
import { isClientLogEvent } from '../src/shared/client-log';

describe('OTLP Connector', () => {
  let originalCwd: string;
  let tempDir: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tempDir = makeTempDir('blyp-otlp-');
    resetConfigCache();
    resetOTLPTestHooks();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
    resetConfigCache();
    resetOTLPTestHooks();
  });

  it('loads OTLP connector config from blyp.config.ts', () => {
    process.chdir(tempDir);
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify({ name: 'otlp-app' }, null, 2)
    );
    fs.writeFileSync(
      path.join(tempDir, 'blyp.config.ts'),
      [
        'export default {',
        '  connectors: {',
        '    otlp: [',
        '      {',
        '        name: "grafana",',
        '        enabled: true,',
        '        endpoint: "http://localhost:4318",',
        '      },',
        '    ],',
        '  },',
        '};',
      ].join('\n')
    );

    const resolved = resolveConfig();
    const connector = resolved.connectors?.otlp?.[0] as {
      enabled?: boolean;
      endpoint?: string;
      serviceName?: string;
      ready?: boolean;
    } | undefined;

    expect(connector?.enabled).toBe(true);
    expect(connector?.endpoint).toBe('http://localhost:4318');
    expect(connector?.serviceName).toBe('otlp-app');
    expect(connector?.ready).toBe(true);
    expect(fs.existsSync(path.join(tempDir, 'blyp.config.json'))).toBe(false);
  });

  it('replaces the config OTLP array when runtime overrides provide OTLP connectors', () => {
    process.chdir(tempDir);
    fs.writeFileSync(
      path.join(tempDir, 'blyp.config.json'),
      JSON.stringify({
        connectors: {
          otlp: [
            {
              name: 'grafana',
              enabled: true,
              endpoint: 'http://localhost:4318',
            },
          ],
        },
      })
    );

    const resolved = resolveConfig({
      connectors: {
        otlp: [
          {
            name: 'honeycomb',
            enabled: true,
            endpoint: 'https://api.honeycomb.io',
          },
        ],
      },
    });

    expect(resolved.connectors?.otlp).toHaveLength(1);
    expect(resolved.connectors?.otlp?.[0]?.name).toBe('honeycomb');
  });

  it('auto-forwards server logs to every ready OTLP auto target and skips client_log records', () => {
    const emitted: Array<{ name: string; payload: OTLPNormalizedRecord }> = [];
    setOTLPTestHooks({
      createTransport: (config) => ({
        emit(payload) {
          emitted.push({ name: config.name, payload });
        },
      }),
    });

    const logger = createStandaloneLogger({
      pretty: false,
      logDir: tempDir,
      connectors: {
        otlp: [
          {
            name: 'grafana',
            enabled: true,
            mode: 'auto',
            endpoint: 'http://localhost:4318',
            serviceName: 'svc',
          },
          {
            name: 'honeycomb',
            enabled: true,
            mode: 'auto',
            endpoint: 'https://api.honeycomb.io',
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
      'grafana',
      'honeycomb',
      'grafana',
      'honeycomb',
    ]);
    expect(emitted[2]?.payload.attributes['blyp.group_id']).toBe('checkout');
  });

  it('does not auto-forward regular Blyp logs in manual mode', () => {
    const emitted: OTLPNormalizedRecord[] = [];
    setOTLPTestHooks({
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
        otlp: [
          {
            name: 'grafana',
            enabled: true,
            mode: 'manual',
            endpoint: 'http://localhost:4318',
            serviceName: 'svc',
          },
        ],
      },
    });

    logger.info('manual-mode');

    expect(emitted).toHaveLength(0);
  });

  it('supports manual OTLP-only loggers and structured loggers for named targets', () => {
    const emitted: Array<{ name: string; payload: OTLPNormalizedRecord }> = [];
    setOTLPTestHooks({
      createTransport: (config) => ({
        emit(payload) {
          emitted.push({ name: config.name, payload });
        },
      }),
    });

    const connectors = {
      otlp: [
        {
          name: 'grafana',
          enabled: true,
          endpoint: 'http://localhost:4318',
          serviceName: 'svc',
        },
        {
          name: 'honeycomb',
          enabled: true,
          endpoint: 'https://api.honeycomb.io',
          serviceName: 'svc',
        },
      ],
    };

    const logger = createOtlpLogger({
      name: 'grafana',
      connectors,
    }).child({ feature: 'checkout' });
    logger.warn('manual warning', { retryable: true });

    const structured = createStructuredOtlpLogger(
      'manual-checkout',
      { orderId: 'ord_2' },
      {
        name: 'honeycomb',
        connectors,
      }
    );
    structured.info('manual start');
    structured.emit({ status: 201 });

    expect(emitted).toHaveLength(2);
    expect(emitted[0]?.name).toBe('grafana');
    expect(emitted[1]?.name).toBe('honeycomb');
    const manualPayload = JSON.parse(String(emitted[0]?.payload.attributes['blyp.payload'])) as {
      bindings?: Record<string, unknown>;
    };
    expect(manualPayload.bindings).toEqual({ feature: 'checkout' });
    expect(emitted[1]?.payload.attributes['blyp.group_id']).toBe('manual-checkout');
    expect(fs.existsSync(path.join(tempDir, 'log.ndjson'))).toBe(false);
  });

  it('downgrades missing manual OTLP targets to a single local error', () => {
    const errors: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };

    const logger = createOtlpLogger({
      name: 'grafana',
      connectors: {
        otlp: [],
      },
    });
    logger.info('first');
    logger.info('second');

    console.error = originalError;
    expect(errors).toHaveLength(1);
    expect(String(errors[0]?.[0] ?? '')).toContain('OTLP target "grafana"');
  });

  it('prefers headers.Authorization over auth', () => {
    const captured: string[] = [];
    setOTLPTestHooks({
      createTransport: (config) => {
        captured.push(config.headers.Authorization ?? '');
        return {
          emit() {},
        };
      },
    });

    const logger = createStandaloneLogger({
      pretty: false,
      logDir: tempDir,
      connectors: {
        otlp: [
          {
            name: 'grafana',
            enabled: true,
            endpoint: 'http://localhost:4318',
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

  it('forwards client connector requests to named OTLP targets during ingestion', async () => {
    const emitted: Array<{ name: string; payload: OTLPNormalizedRecord }> = [];
    setOTLPTestHooks({
      createTransport: (config) => ({
        emit(payload) {
          emitted.push({ name: config.name, payload });
        },
      }),
    });

    const shared = resolveServerLogger({
      pretty: false,
      logDir: tempDir,
      clientLogging: true,
      connectors: {
        otlp: [
          {
            name: 'grafana',
            enabled: true,
            mode: 'manual',
            endpoint: 'http://localhost:4318',
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
          connector: { type: 'otlp', name: 'grafana' },
        })),
      }),
      deliveryPath: '/inngest',
    });
    await waitForFileFlush();

    expect(result.status).toBe(204);
    expect(result.headers?.['x-blyp-otlp-status']).toBe('enabled');
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.name).toBe('grafana');
    expect(emitted[0]?.payload.attributes['blyp.source']).toBe('client');
    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    expect(records.some((record) => record.message === '[client] frontend rendered')).toBe(true);
  });

  it('returns a missing header when the requested OTLP target is absent', async () => {
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
          connector: { type: 'otlp', name: 'grafana' },
        })),
      }),
      deliveryPath: '/inngest',
    });
    await waitForFileFlush();

    expect(result.status).toBe(204);
    expect(result.headers?.['x-blyp-otlp-status']).toBe('missing');
  });

  it('returns a missing header when the requested OTLP target is invalid', async () => {
    const shared = resolveServerLogger({
      pretty: false,
      logDir: tempDir,
      clientLogging: true,
      connectors: {
        otlp: [
          {
            name: 'grafana',
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
          connector: { type: 'otlp', name: 'grafana' },
        })),
      }),
      deliveryPath: '/inngest',
    });
    await waitForFileFlush();

    expect(result.status).toBe(204);
    expect(result.headers?.['x-blyp-otlp-status']).toBe('missing');
  });

  it('accepts OTLP client connector payloads and rejects invalid connector objects', () => {
    expect(isClientLogEvent(createClientPayload({
      connector: { type: 'otlp', name: 'grafana' },
    }))).toBe(true);

    expect(isClientLogEvent(createClientPayload({
      connector: { type: 'otlp', name: '' },
    }))).toBe(false);

    const invalidPayload = createClientPayload() as unknown as {
      connector?: unknown;
    };
    invalidPayload.connector = { type: 'else', name: 'grafana' };

    expect(isClientLogEvent(invalidPayload)).toBe(false);
  });
});
