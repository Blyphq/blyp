import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createSvelteKitLogger } from '../../src/frameworks/sveltekit';
import { resetConfigCache } from '../../src/core/config';
import { logger as rootLogger } from '../../src/frameworks/standalone';
import { createClientPayload } from '../helpers/client-payload';
import { makeTempDir, readJsonLines, waitForFileFlush } from '../helpers/fs';

describe('SvelteKit Integration', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir('blyp-sveltekit-');
    resetConfigCache();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    resetConfigCache();
  });

  it('attaches blypLog to locals and logs successful requests', async () => {
    const svelteLogger = createSvelteKitLogger({
      logDir: tempDir,
      pretty: false,
      customProps: () => ({ framework: 'sveltekit' }),
    });
    const event = {
      request: new Request('http://localhost/posts'),
      url: new URL('http://localhost/posts'),
      locals: {},
    };

    const response = await svelteLogger.handle({
      event,
      resolve: async (resolvedEvent) => {
        (resolvedEvent.locals.blypLog as { info(message: string): void }).info('sveltekit-route');
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

    expect(records.some((record) => record.message === 'sveltekit-route')).toBe(true);
    expect((requestRecord?.data as Record<string, unknown>)?.framework).toBe('sveltekit');
  });

  it('logs error responses and supports ignorePaths', async () => {
    const svelteLogger = createSvelteKitLogger({
      logDir: tempDir,
      pretty: false,
      ignorePaths: ['/health'],
    });

    await svelteLogger.handle({
      event: {
        request: new Request('http://localhost/health'),
        url: new URL('http://localhost/health'),
        locals: {},
      },
      resolve: async () => new Response('ok', { status: 200 }),
    });
    await svelteLogger.handle({
      event: {
        request: new Request('http://localhost/posts'),
        url: new URL('http://localhost/posts'),
        locals: {},
      },
      resolve: async () => new Response('fail', { status: 500 }),
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
    const svelteLogger = createSvelteKitLogger({
      logDir: tempDir,
      pretty: false,
    });

    const ok = await svelteLogger.clientLogHandler({
      request: new Request('http://localhost/inngest', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(createClientPayload()),
      }),
      url: new URL('http://localhost/inngest'),
      locals: {},
    });
    const mismatch = await svelteLogger.clientLogHandler({
      request: new Request('http://localhost/api/inngest', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(createClientPayload()),
      }),
      url: new URL('http://localhost/api/inngest'),
      locals: {},
    });
    await waitForFileFlush();

    expect(ok.status).toBe(204);
    expect(mismatch.status).toBe(500);
    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    expect(records.some((record) => record.message === '[client] frontend rendered')).toBe(true);
  });

  it('emits one structured request record and drops mixed root logger writes', async () => {
    const warnings: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };

    const svelteLogger = createSvelteKitLogger({
      logDir: tempDir,
      pretty: false,
      customProps: () => ({ framework: 'sveltekit' }),
    });

    const response = await svelteLogger.handle({
      event: {
        request: new Request('http://localhost/structured', { method: 'POST' }),
        url: new URL('http://localhost/structured'),
        locals: {},
      },
      resolve: async (resolvedEvent) => {
        const log = resolvedEvent.locals.blypLog as typeof rootLogger;
        const structured = log.createStructuredLog('checkout', { userId: 'user-1' });
        structured.set({ cartItems: 3 });
        structured.info('user logged in');
        log.info('scoped-allowed');
        rootLogger.info('root-ignored');
        structured.emit({ status: 200 });
        return new Response('ok', { status: 200 });
      },
    });
    await waitForFileFlush();

    expect(response.status).toBe(200);
    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    const structuredRecord = records.find((record) => record.groupId === 'checkout');

    expect(structuredRecord?.method).toBe('POST');
    expect(structuredRecord?.path).toBe('/structured');
    expect(structuredRecord?.framework).toBe('sveltekit');
    expect(records.some((record) => record.message === 'scoped-allowed')).toBe(true);
    expect(records.some((record) => record.message === 'root-ignored')).toBe(false);
    expect(
      records.some((record) => (record.data as Record<string, unknown>)?.url === '/structured')
    ).toBe(false);
    expect(warnings).toHaveLength(1);
    console.warn = originalWarn;
  });
});
