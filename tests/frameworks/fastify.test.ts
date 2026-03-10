import fs from 'fs';
import path from 'path';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createFastifyLogger } from '../../src/frameworks/fastify';
import { resetConfigCache } from '../../src/core/config';
import { createClientPayload } from '../helpers/client-payload';
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
    await app.register(createFastifyLogger({
      logDir: tempDir,
      pretty: false,
      customProps: () => ({ framework: 'fastify' }),
    }));
    app.get('/hello', async (request) => {
      request.blypLog.info('fastify-route');
      return { ok: true };
    });

    const response = await app.inject({
      method: 'GET',
      url: '/hello',
    });
    await waitForFileFlush();

    expect(response.statusCode).toBe(200);
    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    const requestRecord = records.find((record) => {
      const data = record.data as Record<string, unknown> | undefined;
      return data?.type === 'http_request' && data?.url === '/hello';
    });

    expect(records.some((record) => record.message === 'fastify-route')).toBe(true);
    expect((requestRecord?.data as Record<string, unknown>)?.framework).toBe('fastify');
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
});
