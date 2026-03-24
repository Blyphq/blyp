import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createNuxtLogger } from '../../src/frameworks/nuxt';
import type { NuxtLoggerPlugin } from '../../src/types/frameworks/nuxt';
import { resetConfigCache } from '../../src/core/config';
import { logger as rootLogger } from '../../src/frameworks/standalone';
import { createClientPayload } from '../helpers/client-payload';
import { makeTempDir, readJsonLines, waitForFileFlush } from '../helpers/fs';

type HookMap = Map<string, Array<(...args: unknown[]) => unknown>>;

async function registerPlugin(plugin: NuxtLoggerPlugin): Promise<HookMap> {
  const hooks: HookMap = new Map();
  await plugin({
    hooks: {
      hook(name, callback) {
        const existing = hooks.get(name) ?? [];
        existing.push(callback);
        hooks.set(name, existing);
      },
    },
  });
  return hooks;
}

async function runHooks(hooks: HookMap, name: string, ...args: unknown[]): Promise<void> {
  for (const callback of hooks.get(name) ?? []) {
    await callback(...args);
  }
}

function createEvent(url: string, method: string = 'GET', body?: unknown) {
  return {
    request: new Request(url, body === undefined
      ? { method }
      : {
          method,
          headers: { 'content-type': 'application/json' },
          body: typeof body === 'string' ? body : JSON.stringify(body),
        }),
    context: {},
    node: {
      res: { statusCode: 200 },
    },
    body,
  };
}

describe('Nuxt Integration', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir('blyp-nuxt-');
    resetConfigCache();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    resetConfigCache();
  });

  it('exposes a Nuxt-named server plugin surface and logs requests', async () => {
    const nuxtLogger = createNuxtLogger({
      logDir: tempDir,
      pretty: false,
      customProps: () => ({ framework: 'nuxt' }),
    });
    const hooks = await registerPlugin(nuxtLogger.serverPlugin);
    const event = createEvent('http://localhost/posts');

    await runHooks(hooks, 'request', event);
    nuxtLogger.getLogger(event).info('nuxt-route');
    await runHooks(hooks, 'beforeResponse', event, new Response('ok', { status: 200 }));
    await runHooks(hooks, 'afterResponse', event);
    await waitForFileFlush();

    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    const requestRecord = records.find((record) => {
      const data = record.data as Record<string, unknown> | undefined;
      return data?.type === 'http_request' && data?.url === '/posts';
    });

    expect(records.some((record) => record.message === 'nuxt-route')).toBe(true);
    expect((requestRecord?.data as Record<string, unknown>)?.framework).toBe('nuxt');
  });

  it('handles client ingestion and exposes scoped loggers', async () => {
    const nuxtLogger = createNuxtLogger({
      logDir: tempDir,
      pretty: false,
    });
    const hooks = await registerPlugin(nuxtLogger.serverPlugin);
    const event = createEvent('http://localhost/structured', 'POST');

    await runHooks(hooks, 'request', event);
    const log = nuxtLogger.getLogger(event) as typeof rootLogger;
    const structured = log.createStructuredLog('checkout', { userId: 'user-1' });
    structured.emit({ status: 200 });
    await runHooks(hooks, 'beforeResponse', event, new Response('ok', { status: 200 }));
    await runHooks(hooks, 'afterResponse', event);

    const ok = await nuxtLogger.clientLogHandler(
      createEvent('http://localhost/inngest', 'POST', createClientPayload())
    );
    await waitForFileFlush();

    expect(ok.status).toBe(204);
    const records = readJsonLines(path.join(tempDir, 'log.ndjson'));
    expect(records.some((record) => record.groupId === 'checkout')).toBe(true);
    expect(records.some((record) => (record.data as Record<string, unknown>)?.url === '/structured')).toBe(false);
  });
});
