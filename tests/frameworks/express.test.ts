import fs from 'fs';
import path from 'path';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  createExpressErrorLogger,
  createExpressLogger,
} from '../../src/frameworks/express';
import { clerk } from '../../src/clerk';
import { resetConfigCache } from '../../src/core/config';
import { logger as rootLogger } from '../../src/frameworks/standalone';
import { createClientPayload } from '../helpers/client-payload';
import { createMachineClerkAuth, createMockClerkClient } from '../helpers/clerk';
import { makeTempDir, readJsonLines, waitForFileFlush } from '../helpers/fs';
import { listen } from '../helpers/http';

describe('Express Integration', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir('blyp-express-');
    resetConfigCache();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    resetConfigCache();
  });

  it('attaches blypLog to req and logs successful requests', async () => {
    const app = express();
    let requestTraceId = '';
    app.use(createExpressLogger({
      logDir: tempDir,
      pretty: false,
      customProps: () => ({ framework: 'express' }),
    }));
    app.get('/hello', (req, res) => {
      requestTraceId = req.blypTraceId ?? '';
      req.blypLog.info('express-route');
      res.status(200).send('ok');
    });

    const server = await listen(app as unknown as Parameters<typeof listen>[0]);
    try {
      const response = await fetch(`${server.baseUrl}/hello`);
      await waitForFileFlush();

      expect(response.status).toBe(200);
      const traceId = response.headers.get('x-blyp-trace-id');
      if (traceId === null) {
        throw new Error('missing x-blyp-trace-id header');
      }
      expect(requestTraceId).toBe(traceId);
      expect(traceId).toMatch(/^trace_/);
      const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
      const requestRecord = records.find((record) => {
        const data = record.data as Record<string, unknown> | undefined;
        return data?.type === 'http_request' && data?.url === '/hello';
      });

      expect(records.some((record) => record.message === 'express-route')).toBe(true);
      expect((requestRecord?.data as Record<string, unknown>)?.framework).toBe('express');
      expect(requestRecord?.traceId).toBe(traceId);
    } finally {
      await server.close();
    }
  });

  it('supports error logging and ignorePaths', async () => {
    const app = express();
    app.use(createExpressLogger({
      logDir: tempDir,
      pretty: false,
      ignorePaths: ['/health'],
    }));
    app.get('/health', (_req, res) => {
      res.status(200).send('ok');
    });
    app.get('/boom', () => {
      throw new Error('express-fail');
    });
    app.use(createExpressErrorLogger());
    app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
      res.status(500).send(error.message);
    });

    const server = await listen(app as unknown as Parameters<typeof listen>[0]);
    try {
      await fetch(`${server.baseUrl}/health`);
      await fetch(`${server.baseUrl}/boom`);
      await waitForFileFlush();

      const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
      expect(
        records.some((record) => (record.data as Record<string, unknown>)?.url === '/health')
      ).toBe(false);
      expect(
        records.some((record) => (record.data as Record<string, unknown>)?.type === 'http_error')
      ).toBe(true);
    } finally {
      await server.close();
    }
  });

  it('supports includePaths and applies ignorePaths after includePaths', async () => {
    const app = express();
    app.use(createExpressLogger({
      logDir: tempDir,
      pretty: false,
      includePaths: ['/api/**'],
      ignorePaths: ['/api/internal/**'],
    }));
    app.get('/api/hello', (_req, res) => {
      res.status(200).send('ok');
    });
    app.get('/health', (_req, res) => {
      res.status(200).send('ok');
    });
    app.get('/api/fail', () => {
      throw new Error('express-include-fail');
    });
    app.get('/other-fail', () => {
      throw new Error('express-non-include-fail');
    });
    app.get('/api/internal/stats', (_req, res) => {
      res.status(200).send('ok');
    });
    app.use(createExpressErrorLogger());
    app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
      res.status(500).send(error.message);
    });

    const server = await listen(app as unknown as Parameters<typeof listen>[0]);
    try {
      await fetch(`${server.baseUrl}/api/hello`);
      await fetch(`${server.baseUrl}/health`);
      await fetch(`${server.baseUrl}/api/fail`);
      await fetch(`${server.baseUrl}/other-fail`);
      await fetch(`${server.baseUrl}/api/internal/stats`);
      await waitForFileFlush();

      const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
      expect(
        records.some((record) => {
          const data = record.data as Record<string, unknown> | undefined;
          return data?.type === 'http_request' && data?.url === '/api/hello';
        })
      ).toBe(true);
      expect(
        records.some((record) => {
          const data = record.data as Record<string, unknown> | undefined;
          return data?.type === 'http_request' && data?.url === '/health';
        })
      ).toBe(false);
      expect(
        records.some((record) => {
          const data = record.data as Record<string, unknown> | undefined;
          return data?.type === 'http_error' && data?.url === '/api/fail';
        })
      ).toBe(true);
      expect(
        records.some((record) => {
          const data = record.data as Record<string, unknown> | undefined;
          return data?.type === 'http_error' && data?.url === '/other-fail';
        })
      ).toBe(false);
      expect(
        records.some((record) => {
          const data = record.data as Record<string, unknown> | undefined;
          return data?.url === '/api/internal/stats';
        })
      ).toBe(false);
    } finally {
      await server.close();
    }
  });

  it('ingests client logs and rejects unauthorized payloads', async () => {
    const app = express();
    app.use(createExpressLogger({
      logDir: tempDir,
      pretty: false,
      connectors: {
        posthog: {
          enabled: true,
          projectKey: 'phc_test',
          serviceName: 'svc',
        },
      },
      clientLogging: {
        validate: async (_ctx, payload) => payload.id !== 'blocked',
      },
    }));

    const server = await listen(app as unknown as Parameters<typeof listen>[0]);
    try {
      const ok = await fetch(`${server.baseUrl}/inngest`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(createClientPayload({ connector: 'posthog' })),
      });
      const blocked = await fetch(`${server.baseUrl}/inngest`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(createClientPayload({ id: 'blocked' })),
      });
      await waitForFileFlush();

      expect(ok.status).toBe(204);
      expect(ok.headers.get('x-blyp-posthog-status')).toBe('enabled');
      expect(blocked.status).toBe(403);
      const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
      const duplicateHttpRecord = records.find((record) => {
        const data = record.data as Record<string, unknown> | undefined;
        return data?.type === 'http_request' && data?.url === '/inngest';
      });

      expect(records.some((record) => record.message === '[client] frontend rendered')).toBe(true);
      expect(duplicateHttpRecord).toBeUndefined();
    } finally {
      await server.close();
    }
  });

  it('enriches request and client logs with Clerk machine auth context', async () => {
    const app = express();
    app.use(createExpressLogger({
      logDir: tempDir,
      pretty: false,
      auth: {
        clerk: clerk({
          clerkClient: createMockClerkClient({
            auth: createMachineClerkAuth(),
          }),
        }),
      },
    }));
    app.get('/clerk', (req, res) => {
      req.blypLog.info('express clerk route');
      res.status(200).send('ok');
    });

    const server = await listen(app as unknown as Parameters<typeof listen>[0]);
    try {
      await fetch(`${server.baseUrl}/clerk`);
      await fetch(`${server.baseUrl}/inngest`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(createClientPayload()),
      });
      await waitForFileFlush();

      const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
      const routeRecord = records.find((record) => record.message === 'express clerk route');
      const clientRecord = records.find((record) => record.message === '[client] frontend rendered');

      expect(routeRecord?.auth).toMatchObject({
        provider: 'clerk',
        actor: {
          kind: 'machine',
          id: 'oauth_1',
        },
        lookup: {
          userId: 'user_1',
          tokenType: 'oauth_token',
        },
      });
      expect(clientRecord?.auth).toMatchObject({
        provider: 'clerk',
        actor: {
          kind: 'machine',
          id: 'oauth_1',
        },
      });
    } finally {
      await server.close();
    }
  });

  it('resolves Better Auth ingestion auth with source=client_ingestion', async () => {
    const app = express();
    app.use(createExpressLogger({
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

    const server = await listen(app as unknown as Parameters<typeof listen>[0]);
    try {
      const response = await fetch(`${server.baseUrl}/inngest`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(createClientPayload()),
      });
      await waitForFileFlush();

      expect(response.status).toBe(204);
      const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
      const clientRecord = records.find((record) => record.message === '[client] frontend rendered');

      expect(clientRecord?.auth).toMatchObject({
        provider: 'better-auth',
        claims: {
          source: 'client_ingestion',
        },
      });
    } finally {
      await server.close();
    }
  });

  it('emits one structured request record and drops mixed root logger writes', async () => {
    const warnings: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };

    const app = express();
    app.use(createExpressLogger({
      logDir: tempDir,
      pretty: false,
      customProps: () => ({ framework: 'express' }),
    }));
    app.post('/structured', (req, res) => {
      const structured = req.blypLog.createStructuredLog('checkout', { userId: 'user-1' });
      structured.set({ cartItems: 3 });
      structured.info('user logged in');
      req.blypLog.info('scoped-allowed');
      rootLogger.info('root-ignored');
      structured.emit({ status: 200 });
      res.status(200).json({ ok: true });
    });

    const server = await listen(app as unknown as Parameters<typeof listen>[0]);
    try {
      const response = await fetch(`${server.baseUrl}/structured`, { method: 'POST' });
      await waitForFileFlush();

      expect(response.status).toBe(200);
      const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
      const structuredRecord = records.find((record) => record.groupId === 'checkout');

      expect(structuredRecord?.method).toBe('POST');
      expect(structuredRecord?.path).toBe('/structured');
      expect(structuredRecord?.framework).toBe('express');
      expect(structuredRecord?.status).toBe(200);
      expect(records.some((record) => record.message === 'scoped-allowed')).toBe(true);
      expect(records.some((record) => record.message === 'root-ignored')).toBe(false);
      expect(
        records.some((record) => (record.data as Record<string, unknown>)?.url === '/structured')
      ).toBe(false);
      expect(warnings).toHaveLength(1);
    } finally {
      console.warn = originalWarn;
      await server.close();
    }
  });
});
