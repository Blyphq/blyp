import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { createHonoLogger } from '../../src/frameworks/hono';
import { resetConfigCache } from '../../src/core/config';
import { createClientPayload } from '../helpers/client-payload';
import { makeTempDir, readJsonLines, waitForFileFlush } from '../helpers/fs';

describe('Hono Integration', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir('blyp-hono-');
    resetConfigCache();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    resetConfigCache();
  });

  it('attaches blypLog to the request context and logs successful requests', async () => {
    const app = new Hono();
    app.use('*', createHonoLogger({
      logDir: tempDir,
      pretty: false,
      customProps: () => ({ framework: 'hono' }),
    }));
    app.get('/hello', (context) => {
      ((context as any).get('blypLog') as { info(message: string): void }).info('hono-route');
      return context.text('ok');
    });

    const response = await app.fetch(new Request('http://localhost/hello'));
    await waitForFileFlush();

    expect(response.status).toBe(200);
    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    const requestRecord = records.find((record) => {
      const data = record.data as Record<string, unknown> | undefined;
      return data?.type === 'http_request' && data?.url === '/hello';
    });

    expect(records.some((record) => record.message === 'hono-route')).toBe(true);
    expect((requestRecord?.data as Record<string, unknown>)?.framework).toBe('hono');
  });

  it('supports ignorePaths and error logging', async () => {
    const app = new Hono();
    app.use('*', createHonoLogger({
      logDir: tempDir,
      pretty: false,
      ignorePaths: ['/health'],
    }));
    app.onError(() => new Response('fail', { status: 500 }));
    app.get('/health', (context) => context.text('ok'));
    app.get('/boom', () => {
      throw new Error('hono-fail');
    });

    await app.fetch(new Request('http://localhost/health'));
    await app.fetch(new Request('http://localhost/boom'));
    await waitForFileFlush();

    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    expect(
      records.some((record) => (record.data as Record<string, unknown>)?.url === '/health')
    ).toBe(false);
    expect(
      records.some((record) => (record.data as Record<string, unknown>)?.type === 'http_error')
    ).toBe(true);
  });

  it('ingests client logs and rejects malformed payloads', async () => {
    const app = new Hono();
    app.use('*', createHonoLogger({
      logDir: tempDir,
      pretty: false,
    }));

    const ok = await app.fetch(
      new Request('http://localhost/inngest', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(createClientPayload()),
      })
    );
    const bad = await app.fetch(
      new Request('http://localhost/inngest', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ nope: true }),
      })
    );
    await waitForFileFlush();

    expect(ok.status).toBe(204);
    expect(bad.status).toBe(400);
    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    expect(records.some((record) => record.message === '[client] frontend rendered')).toBe(true);
  });
});
