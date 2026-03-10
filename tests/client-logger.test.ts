import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createClientLogger } from '../src/frameworks/client';
import { DEFAULT_CLIENT_LOG_ENDPOINT } from '../src/shared/client-log';

type GlobalKey =
  | 'fetch'
  | 'navigator'
  | 'location'
  | 'document'
  | 'sessionStorage';

const globalTarget = globalThis as Record<string, unknown>;
const originalDescriptors = new Map<PropertyKey, PropertyDescriptor | undefined>();

function setGlobal(key: GlobalKey, value: unknown): void {
  if (!originalDescriptors.has(key)) {
    originalDescriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  }

  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value,
  });
}

function restoreGlobals(): void {
  for (const [key, descriptor] of originalDescriptors.entries()) {
    if (descriptor) {
      Object.defineProperty(globalThis, key, descriptor);
    } else {
      delete globalTarget[key as string];
    }
  }

  originalDescriptors.clear();
}

function createSessionStorage() {
  const store = new Map<string, string>();

  return {
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
    clear() {
      store.clear();
    },
  };
}

function installBrowserGlobals(options: {
  fetchImpl?: typeof fetch;
  sendBeaconImpl?: (url: string, data?: BodyInit | null) => boolean;
} = {}): void {
  setGlobal('location', {
    href: 'https://dashboard.example.test/app?tab=logs#state',
    pathname: '/app',
    search: '?tab=logs',
    hash: '#state',
  });
  setGlobal('document', {
    title: 'Dashboard',
    referrer: 'https://dashboard.example.test/login',
  });
  setGlobal('sessionStorage', createSessionStorage());
  setGlobal('navigator', {
    userAgent: 'Mozilla/5.0 Test Browser',
    language: 'en-US',
    platform: 'MacIntel',
    sendBeacon: options.sendBeaconImpl,
  });
  if (options.fetchImpl) {
    setGlobal('fetch', options.fetchImpl);
  }
}

function flushAsyncWork(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('Client Logger', () => {
  const originalInfo = console.info;
  const originalWarn = console.warn;
  const originalError = console.error;
  const originalDebug = console.debug;
  const originalLog = console.log;
  const originalTable = console.table;

  beforeEach(() => {
    restoreGlobals();
    console.info = originalInfo;
    console.warn = originalWarn;
    console.error = originalError;
    console.debug = originalDebug;
    console.log = originalLog;
    console.table = originalTable;
  });

  afterEach(() => {
    restoreGlobals();
    console.info = originalInfo;
    console.warn = originalWarn;
    console.error = originalError;
    console.debug = originalDebug;
    console.log = originalLog;
    console.table = originalTable;
  });

  it('uses the default endpoint and performs local plus remote logging', async () => {
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    const infoCalls: unknown[][] = [];

    installBrowserGlobals({
      fetchImpl: ((url: string | URL | Request, init?: RequestInit) => {
        fetchCalls.push({ url: String(url), init });
        return Promise.resolve(new Response(null, { status: 204 }));
      }) as typeof fetch,
    });
    console.info = (...args: unknown[]) => {
      infoCalls.push(args);
    };

    const logger = createClientLogger();
    logger.info('frontend ready', { tab: 'logs' });
    await flushAsyncWork();

    expect(infoCalls).toHaveLength(1);
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]?.url).toBe(DEFAULT_CLIENT_LOG_ENDPOINT);
    expect(fetchCalls[0]?.init?.credentials).toBe('same-origin');
    expect(fetchCalls[0]?.init?.keepalive).toBe(true);

    const payload = JSON.parse(String(fetchCalls[0]?.init?.body)) as Record<string, unknown>;
    expect(payload.type).toBe('client_log');
    expect(payload.source).toBe('client');
    expect(payload.message).toBe('frontend ready');
    expect(payload.data).toEqual({ tab: 'logs' });
    expect((payload.page as Record<string, unknown>)?.pathname).toBe('/app');
    expect((payload.browser as Record<string, unknown>)?.language).toBe('en-US');
  });

  it('honors endpoint overrides', async () => {
    const fetchCalls: string[] = [];

    installBrowserGlobals({
      fetchImpl: ((url: string | URL | Request) => {
        fetchCalls.push(String(url));
        return Promise.resolve(new Response(null, { status: 204 }));
      }) as typeof fetch,
    });

    createClientLogger({ endpoint: '/custom-inngest' }).info('override');
    await flushAsyncWork();

    expect(fetchCalls).toEqual(['/custom-inngest']);
  });

  it('normalizes warning level, child bindings, and metadata', async () => {
    let body = '';

    installBrowserGlobals({
      fetchImpl: ((_url: string | URL | Request, init?: RequestInit) => {
        body = String(init?.body ?? '');
        return Promise.resolve(new Response(null, { status: 204 }));
      }) as typeof fetch,
    });

    createClientLogger({
      metadata: { app: 'web' },
    })
      .child({ feature: 'checkout' })
      .warn('client warning', { retryable: true });
    await flushAsyncWork();

    const payload = JSON.parse(body) as Record<string, unknown>;
    expect(payload.level).toBe('warning');
    expect(payload.bindings).toEqual({ feature: 'checkout' });
    expect(payload.metadata).toEqual({ app: 'web' });
  });

  it('serializes Error payloads into structured data', async () => {
    let body = '';

    installBrowserGlobals({
      fetchImpl: ((_url: string | URL | Request, init?: RequestInit) => {
        body = String(init?.body ?? '');
        return Promise.resolve(new Response(null, { status: 204 }));
      }) as typeof fetch,
    });

    createClientLogger().error(new Error('boom'));
    await flushAsyncWork();

    const payload = JSON.parse(body) as Record<string, unknown>;
    expect(payload.message).toBe('boom');
    expect((payload.data as Record<string, unknown>)?.name).toBe('Error');
    expect((payload.data as Record<string, unknown>)?.stack).toEqual(expect.any(String));
  });

  it('logs tables locally and sends them remotely as table events', async () => {
    let body = '';
    const logCalls: unknown[][] = [];
    const tableCalls: unknown[][] = [];

    installBrowserGlobals({
      fetchImpl: ((_url: string | URL | Request, init?: RequestInit) => {
        body = String(init?.body ?? '');
        return Promise.resolve(new Response(null, { status: 204 }));
      }) as typeof fetch,
    });
    console.log = (...args: unknown[]) => {
      logCalls.push(args);
    };
    console.table = (...args: unknown[]) => {
      tableCalls.push(args);
    };

    createClientLogger().table('Users', { count: 2 });
    await flushAsyncWork();

    const payload = JSON.parse(body) as Record<string, unknown>;
    expect(payload.level).toBe('table');
    expect(logCalls[0]?.[0]).toBe('Users');
    expect(tableCalls[0]?.[0]).toEqual({ count: 2 });
  });

  it('swallows fetch failures and falls back to sendBeacon when eligible', async () => {
    const beaconCalls: Array<{ url: string; data?: BodyInit | null }> = [];

    installBrowserGlobals({
      fetchImpl: (() => Promise.reject(new Error('network'))) as unknown as typeof fetch,
      sendBeaconImpl: (url, data) => {
        beaconCalls.push({ url, data });
        return true;
      },
    });

    expect(() => createClientLogger().info('retry me')).not.toThrow();
    await flushAsyncWork();

    expect(beaconCalls).toHaveLength(1);
    expect(beaconCalls[0]?.url).toBe(DEFAULT_CLIENT_LOG_ENDPOINT);
  });

  it('does not use sendBeacon fallback when custom headers are configured', async () => {
    let beaconCallCount = 0;

    installBrowserGlobals({
      fetchImpl: (() => Promise.reject(new Error('network'))) as unknown as typeof fetch,
      sendBeaconImpl: () => {
        beaconCallCount += 1;
        return true;
      },
    });

    createClientLogger({
      headers: {
        authorization: 'Bearer test',
      },
    }).info('no beacon');
    await flushAsyncWork();

    expect(beaconCallCount).toBe(0);
  });

  it('skips remote sync safely outside the browser runtime', () => {
    setGlobal('fetch', undefined);
    setGlobal('navigator', undefined);
    setGlobal('location', undefined);
    setGlobal('document', undefined);
    setGlobal('sessionStorage', undefined);

    expect(() => createClientLogger().info('server-side render')).not.toThrow();
  });
});
