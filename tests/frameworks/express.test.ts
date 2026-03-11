import fs from 'fs';
import path from 'path';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  createExpressErrorLogger,
  createExpressLogger,
} from '../../src/frameworks/express';
import { resetConfigCache } from '../../src/core/config';
import { logger as rootLogger } from '../../src/frameworks/standalone';
import { createClientPayload } from '../helpers/client-payload';
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
    app.use(createExpressLogger({
      logDir: tempDir,
      pretty: false,
      customProps: () => ({ framework: 'express' }),
    }));
    app.get('/hello', (req, res) => {
      req.blypLog.info('express-route');
      res.status(200).send('ok');
    });

    const server = await listen(app as unknown as Parameters<typeof listen>[0]);
    try {
      const response = await fetch(`${server.baseUrl}/hello`);
      await waitForFileFlush();

      expect(response.status).toBe(200);
      const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
      const requestRecord = records.find((record) => {
        const data = record.data as Record<string, unknown> | undefined;
        return data?.type === 'http_request' && data?.url === '/hello';
      });

      expect(records.some((record) => record.message === 'express-route')).toBe(true);
      expect((requestRecord?.data as Record<string, unknown>)?.framework).toBe('express');
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

  it('ingests client logs and rejects unauthorized payloads', async () => {
    const app = express();
    app.use(createExpressLogger({
      logDir: tempDir,
      pretty: false,
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
        body: JSON.stringify(createClientPayload()),
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
