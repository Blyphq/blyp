import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createElysiaLogger } from '../../src/frameworks/elysia';
import { resetConfigCache } from '../../src/core/config';
import { createClientPayload } from '../helpers/client-payload';
import { makeTempDir, readJsonLines, waitForFileFlush } from '../helpers/fs';

describe('Elysia Integration', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tempDir = makeTempDir('blyp-elysia-');
    resetConfigCache();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
    resetConfigCache();
  });

  it('exposes a usable logger in route handlers and logs requests', async () => {
    const app = createElysiaLogger({
      logDir: tempDir,
      pretty: false,
      customProps: () => ({ framework: 'elysia' }),
    });

    app.get('/hello', ({ log }) => {
      log.info('elysia-route');
      return 'ok';
    });

    const response = await app.handle(new Request('http://localhost/hello'));
    await waitForFileFlush();

    expect(response.status).toBe(200);
    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    const requestRecord = records.find((record) => {
      const data = record.data as Record<string, unknown> | undefined;
      return data?.type === 'http_request' && data?.url === '/hello';
    });

    expect(records.some((record) => record.message === 'elysia-route')).toBe(true);
    expect(requestRecord?.message).not.toContain('\u001b[');
    expect((requestRecord?.data as Record<string, unknown>)?.framework).toBe('elysia');
  });

  it('supports ignorePaths and autoLogging flags', async () => {
    const app = createElysiaLogger({
      logDir: tempDir,
      pretty: false,
      ignorePaths: ['/health'],
    });

    app.get('/health', () => 'ok');
    await app.handle(new Request('http://localhost/health'));
    await waitForFileFlush();

    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    const ignored = records.find((record) => {
      const data = record.data as Record<string, unknown> | undefined;
      return data?.type === 'http_request' && data?.url === '/health';
    });

    expect(ignored).toBeUndefined();
  });

  it('logs error responses when enabled and skips them when disabled', async () => {
    const enabledApp = createElysiaLogger({
      logDir: tempDir,
      pretty: false,
    });

    enabledApp.get('/boom', ({ set }) => {
      set.status = 500;
      return 'fail';
    });

    await enabledApp.handle(new Request('http://localhost/boom'));
    await waitForFileFlush();

    let records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    expect(
      records.some((record) => (record.data as Record<string, unknown>)?.type === 'http_error')
    ).toBe(true);

    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.mkdirSync(tempDir, { recursive: true });

    const disabledApp = createElysiaLogger({
      logDir: tempDir,
      pretty: false,
      logErrors: false,
    });

    disabledApp.get('/boom', ({ set }) => {
      set.status = 500;
      return 'fail';
    });

    await disabledApp.handle(new Request('http://localhost/boom'));
    await waitForFileFlush();

    records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    expect(
      records.some((record) => (record.data as Record<string, unknown>)?.type === 'http_error')
    ).toBe(false);
  });

  it('ingests client logs and avoids duplicate HTTP request records for the ingestion path', async () => {
    const app = createElysiaLogger({
      logDir: tempDir,
      pretty: false,
    });

    const response = await app.handle(
      new Request('http://localhost/inngest', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': '203.0.113.10',
        },
        body: JSON.stringify(createClientPayload()),
      })
    );
    await waitForFileFlush();

    expect(response.status).toBe(204);
    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    const clientRecord = records.find((record) => record.message === '[client] frontend rendered');
    const duplicateHttpRecord = records.find((record) => {
      const data = record.data as Record<string, unknown> | undefined;
      return data?.type === 'http_request' && data?.url === '/inngest';
    });

    expect(clientRecord).toBeDefined();
    expect(((clientRecord?.data as Record<string, unknown>)?.delivery as Record<string, unknown>)?.ip).toBe(
      '203.0.113.10'
    );
    expect(duplicateHttpRecord).toBeUndefined();
  });

  it('rejects invalid client logs and supports custom ingestion paths', async () => {
    const app = createElysiaLogger({
      logDir: tempDir,
      pretty: false,
      clientLogging: {
        path: '/client-ingest',
        validate: async (_ctx, payload) => payload.id !== 'blocked',
      },
    });

    const blocked = await app.handle(
      new Request('http://localhost/client-ingest', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(createClientPayload({ id: 'blocked' })),
      })
    );
    const malformed = await app.handle(
      new Request('http://localhost/client-ingest', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ nope: true }),
      })
    );

    expect(blocked.status).toBe(403);
    expect(malformed.status).toBe(400);
  });
});
