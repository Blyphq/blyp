import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createNextJsLogger } from '../../src/frameworks/nextjs';
import { resetConfigCache } from '../../src/core/config';
import { createClientPayload } from '../helpers/client-payload';
import { makeTempDir, readJsonLines, waitForFileFlush } from '../helpers/fs';

describe('Next.js Integration', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir('blyp-next-');
    resetConfigCache();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    resetConfigCache();
  });

  it('wraps route handlers with a logger helper and logs requests', async () => {
    const nextLogger = createNextJsLogger({
      logDir: tempDir,
      pretty: false,
      customProps: () => ({ framework: 'nextjs' }),
    });
    const handler = nextLogger.withLogger(async (_request, _context, { log }) => {
      log.info('next-route');
      return new Response('ok', { status: 200 });
    });

    const response = await handler(new Request('http://localhost/api/hello'), {});
    await waitForFileFlush();

    expect(response.status).toBe(200);
    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    const requestRecord = records.find((record) => {
      const data = record.data as Record<string, unknown> | undefined;
      return data?.type === 'http_request' && data?.url === '/api/hello';
    });

    expect(records.some((record) => record.message === 'next-route')).toBe(true);
    expect((requestRecord?.data as Record<string, unknown>)?.framework).toBe('nextjs');
  });

  it('logs error responses and respects ignorePaths', async () => {
    const nextLogger = createNextJsLogger({
      logDir: tempDir,
      pretty: false,
      ignorePaths: ['/api/health'],
    });
    const ignored = nextLogger.withLogger(async () => new Response('ok', { status: 200 }));
    const failing = nextLogger.withLogger(async () => new Response('fail', { status: 500 }));

    await ignored(new Request('http://localhost/api/health'), {});
    await failing(new Request('http://localhost/api/boom'), {});
    await waitForFileFlush();

    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    expect(
      records.some((record) => (record.data as Record<string, unknown>)?.url === '/api/health')
    ).toBe(false);
    expect(
      records.some((record) => (record.data as Record<string, unknown>)?.type === 'http_error')
    ).toBe(true);
  });

  it('handles client ingestion and rejects mounted-path mismatches', async () => {
    const nextLogger = createNextJsLogger({
      logDir: tempDir,
      pretty: false,
    });

    const ok = await nextLogger.clientLogHandler(
      new Request('http://localhost/inngest', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(createClientPayload()),
      })
    );
    const mismatch = await nextLogger.clientLogHandler(
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
