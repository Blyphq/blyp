import fs from 'fs';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { DEFAULT_CONFIG, mergeBlypConfig, resetConfigCache } from '../src/core/config';
import { resolveNewRelicConnector } from '../src/connectors/newrelic/config';
import { createNewRelicLogger, createStructuredNewRelicLogger } from '../src/connectors/newrelic';
import { setOTLPTestHooks, resetOTLPTestHooks } from '../src/connectors/otlp/sender';
import { createStandaloneLogger } from '../src/frameworks/standalone';
import { handleClientLogIngestion, resolveServerLogger } from '../src/frameworks/shared';
import { resolveConvexOtlpTargets } from '../src/frameworks/convex/config';
import { isClientLogEvent } from '../src/shared/client-log';
import type { OTLPNormalizedRecord } from '../src/types/connectors/otlp';
import { createClientPayload } from './helpers/client-payload';
import { makeTempDir } from './helpers/fs';

describe('New Relic connector', () => {
  let tempDir: string;
  beforeEach(() => {
    tempDir = makeTempDir('blyp-newrelic-');
    resetConfigCache();
    resetOTLPTestHooks();
  });
  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    resetConfigCache();
    resetOTLPTestHooks();
  });

  it('resolves account endpoints, credentials, readiness and overrides without duplicates', () => {
    const config = mergeBlypConfig(DEFAULT_CONFIG, {
      connectors: {
        newrelic: { enabled: true, licenseKey: ' license ', serviceName: 'api' },
        otlp: [{ name: 'collector', enabled: true, endpoint: 'http://localhost:4318' }],
      },
    });
    expect(config.connectors.newrelic).toMatchObject({
      endpoint: 'https://otlp.nr-data.net/v1/logs', headers: { 'api-key': 'license' }, ready: true,
    });
    const overridden = mergeBlypConfig(config, { connectors: { newrelic: { region: 'eu', mode: 'manual' } } });
    expect(overridden.connectors.otlp).toHaveLength(2);
    expect(overridden.connectors.newrelic).toMatchObject({
      endpoint: 'https://otlp.eu01.nr-data.net/v1/logs', mode: 'manual', serviceName: 'api',
    });
    expect(mergeBlypConfig(overridden).connectors.otlp).toHaveLength(2);
    for (const settings of [{}, { enabled: true }, { enabled: false, licenseKey: 'key' },
      { enabled: true, licenseKey: ' ' }, { enabled: true, licenseKey: 'key', endpoint: 'invalid' }]) {
      expect(resolveNewRelicConnector(settings, 'api').ready).toBe(false);
    }
    expect(resolveNewRelicConnector({ enabled: true, licenseKey: 'key', endpoint: 'https://proxy.test/v1/logs' }, 'api').ready).toBe(true);
  });

  it('auto-forwards ordinary and structured logs with redaction and service identity', async () => {
    const emitted: OTLPNormalizedRecord[] = [];
    setOTLPTestHooks({ createTransport: () => ({ emit: (payload) => { emitted.push(payload); } }) });
    const logger = createStandaloneLogger({
      pretty: false, logDir: tempDir,
      connectors: { newrelic: { enabled: true, licenseKey: 'license', serviceName: 'billing' } },
    });
    logger.child({ tenant: 't1' }).info('payment started', { password: 'secret' });
    logger.createStructuredLog('checkout', { traceId: 'trace-1', orderId: 'ord-1' }).emit({ status: 200 });
    await logger.flush();
    expect(emitted).toHaveLength(2);
    expect(emitted[0]?.resourceAttributes['service.name']).toBe('billing');
    expect(String(emitted[0]?.attributes['blyp.payload'])).not.toContain('secret');
    expect(emitted[1]?.attributes['blyp.trace_id']).toBe('trace-1');
    expect(String(emitted[1]?.attributes['blyp.payload'])).toContain('ord-1');
  });

  it('supports manual loggers, structured records, and flush', async () => {
    const emitted: OTLPNormalizedRecord[] = [];
    let flushes = 0;
    setOTLPTestHooks({ createTransport: () => ({
      emit: (payload) => { emitted.push(payload); }, flush: async () => { flushes++; },
    }) });
    const connectors = { newrelic: { enabled: true, licenseKey: 'key', mode: 'manual' as const } };
    const auto = createStandaloneLogger({ pretty: false, logDir: tempDir, connectors });
    auto.info('skip auto');
    const manual = createNewRelicLogger({ connectors });
    manual.child({ requestId: 'r1' }).error('manual error');
    createStructuredNewRelicLogger('ai_call', { model: 'example' }, { connectors }).emit();
    await manual.flush();
    expect(emitted).toHaveLength(2);
    expect(emitted[0]?.severityText).toBe('error');
    expect(String(emitted[1]?.attributes['blyp.payload'])).toContain('example');
    expect(flushes).toBe(1);
    await auto.flush();
  });

  it('uses the shared delivery queue and retries failed New Relic exports', async () => {
    let attempts = 0;
    const delivered: string[] = [];
    setOTLPTestHooks({ createTransport: () => ({ emit(payload) {
      attempts++;
      if (attempts === 1) throw new Error('temporary outage');
      delivered.push(payload.body);
    } }) });
    const logger = createStandaloneLogger({ pretty: false, logDir: tempDir,
      connectors: {
        newrelic: { enabled: true, licenseKey: 'key' },
        delivery: { enabled: true, durableQueuePath: `${tempDir}/queue.db`,
          retry: { initialBackoffMs: 0, maxBackoffMs: 0, jitter: false } },
      } });
    try {
      logger.info('queued export');
      await logger.flush();
      expect(attempts).toBe(2);
      expect(delivered).toEqual(['queued export']);
    } finally {
      await logger.shutdown();
    }
  });

  it('accepts and forwards browser/Expo records once through server ingestion', async () => {
    const emitted: OTLPNormalizedRecord[] = [];
    setOTLPTestHooks({ createTransport: () => ({ emit: (payload) => { emitted.push(payload); } }) });
    const config = resolveServerLogger({
      pretty: false, logDir: tempDir,
      connectors: { newrelic: { enabled: true, licenseKey: 'key' } },
    });
    for (const runtime of ['browser', 'expo'] as const) {
      const payload = createClientPayload({ connector: 'newrelic', device: { runtime }, data: { password: 'secret' } });
      expect(isClientLogEvent(payload)).toBe(true);
      const result = await handleClientLogIngestion({ config, ctx: {}, request: { method: 'POST', url: '/inngest' }, body: payload });
      expect(result).toMatchObject({ status: 204, headers: { 'x-blyp-newrelic-status': 'enabled' } });
    }
    await config.logger.flush();
    expect(emitted).toHaveLength(2);
    expect(emitted[0]?.attributes['blyp.source']).toBe('client');
    expect(String(emitted[0]?.attributes['blyp.payload'])).not.toContain('secret');
  });

  it('reports missing credentials to clients and does not export', async () => {
    let transports = 0;
    setOTLPTestHooks({ createTransport: () => { transports++; return { emit() {} }; } });
    const config = resolveServerLogger({ pretty: false, logDir: tempDir,
      connectors: { newrelic: { enabled: true } } });
    const result = await handleClientLogIngestion({ config, ctx: {}, request: { method: 'POST', url: '/inngest' }, body: createClientPayload({ connector: 'newrelic' }) });
    expect(result).toMatchObject({ status: 204, headers: { 'x-blyp-newrelic-status': 'missing' } });
    expect(transports).toBe(0);
    await config.logger.flush();
  });

  it('maps shared config to Convex exports and respects manual/disabled settings', () => {
    const newrelic = { enabled: true, licenseKey: 'key', region: 'eu' as const };
    expect(resolveConvexOtlpTargets({ connectors: { newrelic }, serviceName: 'convex-api' })).toMatchObject([
      { name: 'newrelic', endpoint: 'https://otlp.eu01.nr-data.net/v1/logs', headers: { 'api-key': 'key' }, serviceName: 'convex-api' },
    ]);
    expect(resolveConvexOtlpTargets({ connectors: { newrelic: { ...newrelic, mode: 'manual' } } })).toEqual([]);
    expect(resolveConvexOtlpTargets({ connectors: { newrelic: { enabled: true } } })).toEqual([]);
    expect(resolveConvexOtlpTargets({ connectors: { newrelic }, otlp: false })).toEqual([]);
  });

  it('sends a real OTLP HTTP request with the New Relic authentication header', async () => {
    let received: { key: string | null; body: any; path: string } | undefined;
    const server = Bun.serve({ port: 0, async fetch(request) {
      received = { key: request.headers.get('api-key'), body: await request.json(), path: new URL(request.url).pathname };
      return Response.json({});
    } });
    try {
      const logger = createNewRelicLogger({ connectors: { newrelic: {
        enabled: true, licenseKey: 'test-license', serviceName: 'integration-test',
        endpoint: `http://localhost:${server.port}/v1/logs`,
      } } });
      logger.info('real export', { orderId: 'ord-1' });
      await logger.flush();
      expect(received?.key).toBe('test-license');
      expect(received?.path).toBe('/v1/logs');
      const resource = received?.body.resourceLogs[0];
      expect(resource.resource.attributes).toContainEqual({ key: 'service.name', value: { stringValue: 'integration-test' } });
      expect(resource.scopeLogs[0].logRecords[0].body.stringValue).toBe('real export');
    } finally {
      server.stop(true);
    }
  });
});
