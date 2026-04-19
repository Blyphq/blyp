import fs from 'fs';
import path from 'path';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createFastifyLogger } from '../../src/frameworks/fastify';
import { clerk } from '../../src/clerk';
import { resetConfigCache } from '../../src/core/config';
import { logger as rootLogger } from '../../src/frameworks/standalone';
import { createClientPayload } from '../helpers/client-payload';
import { createMockClerkClient } from '../helpers/clerk';
import { makeTempDir, readJsonLines, waitForFileFlush } from '../helpers/fs';

describe('Fastify Integration', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir('blyp-fastify-');
    resetConfigCache();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    resetConfigCache();
  });

  it('decorates requests with blypLog and logs successful requests', async () => {
    const app = Fastify();
    let requestTraceId = '';
    await app.register(createFastifyLogger({
      logDir: tempDir,
      pretty: false,
      customProps: () => ({ framework: 'fastify' }),
    }));
    app.get('/hello', async (request) => {
      requestTraceId = request.blypTraceId ?? '';
      request.blypLog.info('fastify-route');
      return { ok: true };
    });

    const response = await app.inject({
      method: 'GET',
      url: '/hello',
    });
    await waitForFileFlush();

    expect(response.statusCode).toBe(200);
    const traceId = response.headers['x-blyp-trace-id'];
    if (typeof traceId !== 'string') {
      throw new Error('missing x-blyp-trace-id header');
    }
    expect(requestTraceId).toBe(traceId);
    expect(traceId).toMatch(/^trace_/);
    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    const requestRecord = records.find((record) => {
      const data = record.data as Record<string, unknown> | undefined;
      return data?.type === 'http_request' && data?.url === '/hello';
    });

    expect(records.some((record) => record.message === 'fastify-route')).toBe(true);
    expect((requestRecord?.data as Record<string, unknown>)?.framework).toBe('fastify');
    expect(requestRecord?.traceId).toBe(traceId);
    await app.close();
  });

  it('supports error logging and ignorePaths', async () => {
    const app = Fastify();
    await app.register(createFastifyLogger({
      logDir: tempDir,
      pretty: false,
      ignorePaths: ['/health'],
    }));
    app.get('/health', async () => ({ ok: true }));
    app.get('/boom', async () => {
      throw new Error('fastify-fail');
    });

    await app.inject({ method: 'GET', url: '/health' });
    await app.inject({ method: 'GET', url: '/boom' });
    await waitForFileFlush();

    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    expect(
      records.some((record) => (record.data as Record<string, unknown>)?.url === '/health')
    ).toBe(false);
    expect(
      records.some((record) => (record.data as Record<string, unknown>)?.type === 'http_error')
    ).toBe(true);
    await app.close();
  });

  it('sets the trace header for failures before preHandler runs', async () => {
    const app = Fastify();
    await app.register(createFastifyLogger({
      logDir: tempDir,
      pretty: false,
    }));
    app.addHook('preValidation', async () => {
      throw new Error('fastify-prevalidation-fail');
    });
    app.get('/prevalidation-boom', async () => ({ ok: true }));

    const response = await app.inject({
      method: 'GET',
      url: '/prevalidation-boom',
    });

    expect(response.statusCode).toBe(500);
    expect(response.headers['x-blyp-trace-id']).toMatch(/^trace_/);
    await app.close();
  });

  it('ingests client logs and rejects malformed payloads', async () => {
    const app = Fastify();
    await app.register(createFastifyLogger({
      logDir: tempDir,
      pretty: false,
    }));

    const ok = await app.inject({
      method: 'POST',
      url: '/inngest',
      headers: {
        'content-type': 'application/json',
      },
      payload: createClientPayload(),
    });
    const bad = await app.inject({
      method: 'POST',
      url: '/inngest',
      headers: {
        'content-type': 'application/json',
      },
      payload: { nope: true },
    });
    await waitForFileFlush();

    expect(ok.statusCode).toBe(204);
    expect(bad.statusCode).toBe(400);
    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    expect(records.some((record) => record.message === '[client] frontend rendered')).toBe(true);
    await app.close();
  });

  it('logs signed-out Clerk requests as unauthenticated without crashing', async () => {
    const app = Fastify();
    await app.register(createFastifyLogger({
      logDir: tempDir,
      pretty: false,
      auth: {
        clerk: clerk({
          clerkClient: createMockClerkClient(),
        }),
      },
    }));
    app.get('/clerk-signed-out', async (request) => {
      request.blypLog.info('fastify clerk signed out');
      return { ok: true };
    });

    await app.inject({
      method: 'GET',
      url: '/clerk-signed-out',
    });
    await app.inject({
      method: 'POST',
      url: '/inngest',
      headers: {
        'content-type': 'application/json',
      },
      payload: createClientPayload(),
    });
    await waitForFileFlush();

      const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
      const routeRecord = records.find((record) => record.message === 'fastify clerk signed out');
      const clientRecord = records.find((record) => record.message === '[client] frontend rendered');

    expect(routeRecord?.auth).toEqual({
      provider: 'clerk',
      authenticated: false,
      actor: {
        kind: 'anonymous',
      },
      lookup: {
        provider: 'clerk',
      },
    });
      expect(clientRecord?.auth).toEqual({
        provider: 'clerk',
        authenticated: false,
        actor: {
          kind: 'anonymous',
        },
        lookup: {
          provider: 'clerk',
        },
      });
    await app.close();
  });

  it('resolves Better Auth ingestion auth with source=client_ingestion', async () => {
    const app = Fastify();
    await app.register(createFastifyLogger({
      logDir: tempDir,
      pretty: false,
      auth: {
        betterAuth: {
          api: {
            async getSession() {
              return {
                session: {
                  id: 'sess_1',
                },
                user: {
                  id: 'user_1',
                },
              };
            },
          },
        },
        enrich: async ({ source }) => ({
          claims: {
            source,
          },
        }),
      },
    }));

    const response = await app.inject({
      method: 'POST',
      url: '/inngest',
      headers: {
        'content-type': 'application/json',
      },
      payload: createClientPayload(),
    });
    await waitForFileFlush();

    expect(response.statusCode).toBe(204);
    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    const clientRecord = records.find((record) => record.message === '[client] frontend rendered');

    expect(clientRecord?.auth).toMatchObject({
      provider: 'better-auth',
      claims: {
        source: 'client_ingestion',
      },
    });
    await app.close();
  });

  it('includes Better Auth resolution latency in logged response times', async () => {
    const app = Fastify();
    await app.register(createFastifyLogger({
      logDir: tempDir,
      pretty: false,
      auth: {
        betterAuth: {
          api: {
            async getSession() {
              await new Promise((resolve) => setTimeout(resolve, 20));
              return {
                session: {
                  id: 'sess_1',
                },
                user: {
                  id: 'user_1',
                },
              };
            },
          },
        },
      },
    }));
    app.get('/timed', async () => ({ ok: true }));

    const response = await app.inject({
      method: 'GET',
      url: '/timed',
    });
    await waitForFileFlush();

    expect(response.statusCode).toBe(200);
    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    const requestRecord = records.find((record) => {
      const data = record.data as Record<string, unknown> | undefined;
      return data?.type === 'http_request' && data?.url === '/timed';
    });

    expect((requestRecord?.data as Record<string, unknown>)?.responseTime).toBeGreaterThanOrEqual(15);
    await app.close();
  });
  it('emits one structured request record and drops mixed root logger writes', async () => {
    const warnings: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };

    const app = Fastify();
    await app.register(createFastifyLogger({
      logDir: tempDir,
      pretty: false,
      customProps: () => ({ framework: 'fastify' }),
    }));
    app.post('/structured', async (request) => {
      const structured = request.blypLog.createStructuredLog('checkout', { userId: 'user-1' });
      structured.set({ cartItems: 3 });
      structured.info('user logged in');
      request.blypLog.info('scoped-allowed');
      rootLogger.info('root-ignored');
      structured.emit({ status: 200 });
      return { ok: true };
    });

    const response = await app.inject({
      method: 'POST',
      url: '/structured',
    });
    await waitForFileFlush();

    expect(response.statusCode).toBe(200);
    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    const structuredRecord = records.find((record) => record.groupId === 'checkout');

    expect(structuredRecord?.method).toBe('POST');
    expect(structuredRecord?.path).toBe('/structured');
    expect(structuredRecord?.framework).toBe('fastify');
    expect(records.some((record) => record.message === 'scoped-allowed')).toBe(true);
    expect(records.some((record) => record.message === 'root-ignored')).toBe(false);
    expect(
      records.some((record) => (record.data as Record<string, unknown>)?.url === '/structured')
    ).toBe(false);
    expect(warnings).toHaveLength(1);
    console.warn = originalWarn;
    await app.close();
  });
});
