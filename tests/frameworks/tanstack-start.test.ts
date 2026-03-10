import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createTanStackStartLogger } from '../../src/frameworks/tanstack-start';
import { resetConfigCache } from '../../src/core/config';
import { createClientPayload } from '../helpers/client-payload';
import { makeTempDir, readJsonLines, waitForFileFlush } from '../helpers/fs';

describe('TanStack Start Integration', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir('blyp-tanstack-');
    resetConfigCache();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    resetConfigCache();
  });

  it('injects blypLog into middleware context and logs successful requests', async () => {
    const tanstackLogger = createTanStackStartLogger({
      logDir: tempDir,
      pretty: false,
      customProps: () => ({ framework: 'tanstack-start' }),
    });

    const response = await tanstackLogger.requestMiddleware({
      request: new Request('http://localhost/posts'),
      context: {},
      next: async (options) => {
        (options?.context?.blypLog as { info(message: string): void }).info('tanstack-route');
        return new Response('ok', { status: 200 });
      },
    });
    await waitForFileFlush();

    expect(response.status).toBe(200);
    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    const requestRecord = records.find((record) => {
      const data = record.data as Record<string, unknown> | undefined;
      return data?.type === 'http_request' && data?.url === '/posts';
    });

    expect(records.some((record) => record.message === 'tanstack-route')).toBe(true);
    expect((requestRecord?.data as Record<string, unknown>)?.framework).toBe('tanstack-start');
  });

  it('logs failing responses and supports ignorePaths', async () => {
    const tanstackLogger = createTanStackStartLogger({
      logDir: tempDir,
      pretty: false,
      ignorePaths: ['/health'],
    });

    await tanstackLogger.requestMiddleware({
      request: new Request('http://localhost/health'),
      context: {},
      next: async () => new Response('ok', { status: 200 }),
    });
    await tanstackLogger.requestMiddleware({
      request: new Request('http://localhost/posts'),
      context: {},
      next: async () => new Response('fail', { status: 500 }),
    });
    await waitForFileFlush();

    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    expect(
      records.some((record) => (record.data as Record<string, unknown>)?.url === '/health')
    ).toBe(false);
    expect(
      records.some((record) => (record.data as Record<string, unknown>)?.type === 'http_error')
    ).toBe(true);
  });

  it('handles client ingestion and mounted-path validation', async () => {
    const tanstackLogger = createTanStackStartLogger({
      logDir: tempDir,
      pretty: false,
    });

    const ok = await tanstackLogger.clientLogHandlers.POST(
      new Request('http://localhost/inngest', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(createClientPayload()),
      })
    );
    const mismatch = await tanstackLogger.clientLogHandlers.POST(
      new Request('http://localhost/api/inngest', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(createClientPayload()),
      })
    );
    await waitForFileFlush();

    expect(ok.status).toBe(204);
    expect(mismatch.status).toBe(500);
    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    expect(records.some((record) => record.message === '[client] frontend rendered')).toBe(true);
  });
});
