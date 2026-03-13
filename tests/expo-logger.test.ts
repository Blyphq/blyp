import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createExpoLogger } from '../src/frameworks/expo';
import {
  resetExpoNetworkStateForTests,
  setExpoNetworkLoaderForTests,
} from '../src/frameworks/expo/network';
import { resetExpoWarningsForTests } from '../src/frameworks/expo/logger';

type GlobalKey = 'fetch';

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

function flushAsyncWork(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createExpoNetworkHarness(initialState: {
  type?: string;
  isConnected?: boolean;
  isInternetReachable?: boolean;
}) {
  let state = initialState;
  const listeners = new Set<(value: typeof initialState) => void>();

  return {
    loader: async () => ({
      getNetworkStateAsync: async () => state,
      addNetworkStateListener: (listener: (value: typeof initialState) => void) => {
        listeners.add(listener);
        return {
          remove: () => {
            listeners.delete(listener);
          },
        };
      },
    }),
    setState(nextState: typeof initialState) {
      state = nextState;
    },
    emit(nextState: typeof initialState) {
      state = nextState;
      for (const listener of [...listeners]) {
        listener(nextState);
      }
    },
    get listenerCount() {
      return listeners.size;
    },
  };
}

describe('Expo Logger', () => {
  const originalInfo = console.info;
  const originalWarn = console.warn;
  const originalError = console.error;
  const originalDebug = console.debug;
  const originalLog = console.log;
  const originalTable = console.table;

  beforeEach(() => {
    restoreGlobals();
    resetExpoNetworkStateForTests();
    resetExpoWarningsForTests();
    console.info = originalInfo;
    console.warn = originalWarn;
    console.error = originalError;
    console.debug = originalDebug;
    console.log = originalLog;
    console.table = originalTable;
  });

  afterEach(() => {
    restoreGlobals();
    resetExpoNetworkStateForTests();
    resetExpoWarningsForTests();
    setExpoNetworkLoaderForTests(async () => {
      try {
        const module = await import('expo-network');
        if (typeof module.getNetworkStateAsync !== 'function') {
          return null;
        }

        return module;
      } catch {
        return null;
      }
    });
    console.info = originalInfo;
    console.warn = originalWarn;
    console.error = originalError;
    console.debug = originalDebug;
    console.log = originalLog;
    console.table = originalTable;
  });

  it('sends a structured Expo payload to an absolute endpoint', async () => {
    let requestBody = '';
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];

    setExpoNetworkLoaderForTests(async () => ({
      getNetworkStateAsync: async () => ({
        type: 'WIFI',
        isConnected: true,
        isInternetReachable: true,
      }),
    }));
    setGlobal('fetch', ((url: string | URL | Request, init?: RequestInit) => {
      fetchCalls.push({ url: String(url), init });
      requestBody = String(init?.body ?? '');
      return Promise.resolve(new Response(null, { status: 204 }));
    }) as typeof fetch);

    createExpoLogger({
      endpoint: 'https://api.example.test/inngest',
      metadata: { app: 'mobile' },
    }).info('mobile ready', { screen: 'home' });
    await flushAsyncWork();

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]?.url).toBe('https://api.example.test/inngest');

    const payload = JSON.parse(requestBody) as Record<string, unknown>;
    expect(payload.type).toBe('client_log');
    expect(payload.source).toBe('client');
    expect(payload.message).toBe('mobile ready');
    expect(payload.data).toEqual({ screen: 'home' });
    expect(payload.page).toEqual({});
    expect(payload.browser).toEqual({});
    expect(payload.metadata).toEqual({ app: 'mobile' });
    expect((payload.device as Record<string, unknown>)?.runtime).toBe('expo');
    expect((payload.device as Record<string, any>)?.network?.type).toBe('WIFI');
    expect((payload.session as Record<string, unknown>)?.pageId).toEqual(expect.any(String));
    expect((payload.session as Record<string, unknown>)?.sessionId).toEqual(expect.any(String));
  });

  it('preserves child bindings, metadata, warning normalization, and error serialization', async () => {
    const requestBodies: string[] = [];

    setExpoNetworkLoaderForTests(async () => ({
      getNetworkStateAsync: async () => ({
        type: 'CELLULAR',
        isConnected: true,
        isInternetReachable: true,
      }),
    }));
    setGlobal('fetch', ((_url: string | URL | Request, init?: RequestInit) => {
      requestBodies.push(String(init?.body ?? ''));
      return Promise.resolve(new Response(null, { status: 204 }));
    }) as typeof fetch);

    const logger = createExpoLogger({
      endpoint: 'https://api.example.test/inngest',
      metadata: () => ({ app: 'mobile' }),
    }).child({ feature: 'checkout' });

    logger.warn('expo warning', { retryable: true });
    logger.error(new Error('boom'));
    await flushAsyncWork();

    const warningPayload = JSON.parse(requestBodies[0] ?? '') as Record<string, unknown>;
    expect(warningPayload.level).toBe('warning');
    expect(warningPayload.bindings).toEqual({ feature: 'checkout' });
    expect(warningPayload.metadata).toEqual({ app: 'mobile' });

    const errorPayload = JSON.parse(requestBodies[1] ?? '') as Record<string, unknown>;
    expect(errorPayload.message).toBe('boom');
    expect((errorPayload.data as Record<string, unknown>)?.name).toBe('Error');
    expect((errorPayload.data as Record<string, unknown>)?.stack).toEqual(expect.any(String));
  });

  it('includes the PostHog connector and reports missing server configuration once', async () => {
    const errorCalls: unknown[][] = [];
    let requestBody = '';

    setExpoNetworkLoaderForTests(async () => ({
      getNetworkStateAsync: async () => ({
        type: 'WIFI',
        isConnected: true,
        isInternetReachable: true,
      }),
    }));
    setGlobal('fetch', ((_url: string | URL | Request, init?: RequestInit) => {
      requestBody = String(init?.body ?? '');
      return Promise.resolve(new Response(null, {
        status: 204,
        headers: {
          'x-blyp-posthog-status': 'missing',
        },
      }));
    }) as typeof fetch);
    console.error = (...args: unknown[]) => {
      errorCalls.push(args);
    };

    const logger = createExpoLogger({
      endpoint: 'https://api.example.test/inngest',
      connector: 'posthog',
    });

    logger.info('first');
    logger.info('second');
    await flushAsyncWork();

    const payload = JSON.parse(requestBody) as Record<string, unknown>;
    expect(payload.connector).toBe('posthog');
    expect(errorCalls).toHaveLength(1);
    expect(String(errorCalls[0]?.[0] ?? '')).toContain('PostHog connector requested');
  });

  it('includes the Better Stack connector and reports missing server configuration once', async () => {
    const errorCalls: unknown[][] = [];
    let requestBody = '';

    setExpoNetworkLoaderForTests(async () => ({
      getNetworkStateAsync: async () => ({
        type: 'WIFI',
        isConnected: true,
        isInternetReachable: true,
      }),
    }));
    setGlobal('fetch', ((_url: string | URL | Request, init?: RequestInit) => {
      requestBody = String(init?.body ?? '');
      return Promise.resolve(new Response(null, {
        status: 204,
        headers: {
          'x-blyp-betterstack-status': 'missing',
        },
      }));
    }) as typeof fetch);
    console.error = (...args: unknown[]) => {
      errorCalls.push(args);
    };

    const logger = createExpoLogger({
      endpoint: 'https://api.example.test/inngest',
      connector: 'betterstack',
    });

    logger.info('first');
    logger.info('second');
    await flushAsyncWork();

    const payload = JSON.parse(requestBody) as Record<string, unknown>;
    expect(payload.connector).toBe('betterstack');
    expect(errorCalls).toHaveLength(1);
    expect(String(errorCalls[0]?.[0] ?? '')).toContain('Better Stack connector requested');
  });

  it('includes the named OTLP connector and reports missing server configuration once', async () => {
    const errorCalls: unknown[][] = [];
    let requestBody = '';

    setExpoNetworkLoaderForTests(async () => ({
      getNetworkStateAsync: async () => ({
        type: 'WIFI',
        isConnected: true,
        isInternetReachable: true,
      }),
    }));
    setGlobal('fetch', ((_url: string | URL | Request, init?: RequestInit) => {
      requestBody = String(init?.body ?? '');
      return Promise.resolve(new Response(null, {
        status: 204,
        headers: {
          'x-blyp-otlp-status': 'missing',
        },
      }));
    }) as typeof fetch);
    console.error = (...args: unknown[]) => {
      errorCalls.push(args);
    };

    const logger = createExpoLogger({
      endpoint: 'https://api.example.test/inngest',
      connector: { type: 'otlp', name: 'grafana' },
    });

    logger.info('first');
    logger.info('second');
    await flushAsyncWork();

    const payload = JSON.parse(requestBody) as Record<string, unknown>;
    expect(payload.connector).toEqual({ type: 'otlp', name: 'grafana' });
    expect(errorCalls).toHaveLength(1);
    expect(String(errorCalls[0]?.[0] ?? '')).toContain('OTLP target "grafana"');
  });

  it('includes the Sentry connector and reports missing server configuration once', async () => {
    const errorCalls: unknown[][] = [];
    let requestBody = '';

    setExpoNetworkLoaderForTests(async () => ({
      getNetworkStateAsync: async () => ({
        type: 'WIFI',
        isConnected: true,
        isInternetReachable: true,
      }),
    }));
    setGlobal('fetch', ((_url: string | URL | Request, init?: RequestInit) => {
      requestBody = String(init?.body ?? '');
      return Promise.resolve(new Response(null, {
        status: 204,
        headers: {
          'x-blyp-sentry-status': 'missing',
        },
      }));
    }) as typeof fetch);
    console.error = (...args: unknown[]) => {
      errorCalls.push(args);
    };

    const logger = createExpoLogger({
      endpoint: 'https://api.example.test/inngest',
      connector: 'sentry',
    });

    logger.info('first');
    logger.info('second');
    await flushAsyncWork();

    const payload = JSON.parse(requestBody) as Record<string, unknown>;
    expect(payload.connector).toBe('sentry');
    expect(errorCalls).toHaveLength(1);
    expect(String(errorCalls[0]?.[0] ?? '')).toContain('Sentry not setup');
  });

  it('skips remote sync safely when remoteSync is false', async () => {
    let fetchCount = 0;

    setGlobal('fetch', (() => {
      fetchCount += 1;
      return Promise.resolve(new Response(null, { status: 204 }));
    }) as unknown as typeof fetch);

    expect(() => {
      createExpoLogger({
        endpoint: 'https://api.example.test/inngest',
        remoteSync: false,
      }).info('local only');
    }).not.toThrow();
    await flushAsyncWork();

    expect(fetchCount).toBe(0);
  });

  it('warns once and skips remote sync when expo-network is missing', async () => {
    const warnCalls: unknown[][] = [];
    let fetchCount = 0;

    setExpoNetworkLoaderForTests(async () => null);
    setGlobal('fetch', (() => {
      fetchCount += 1;
      return Promise.resolve(new Response(null, { status: 204 }));
    }) as unknown as typeof fetch);
    console.warn = (...args: unknown[]) => {
      warnCalls.push(args);
    };

    const logger = createExpoLogger({
      endpoint: 'https://api.example.test/inngest',
    });

    logger.info('first');
    logger.info('second');
    await flushAsyncWork();

    expect(fetchCount).toBe(0);
    expect(warnCalls).toHaveLength(1);
    expect(String(warnCalls[0]?.[0] ?? '')).toContain('expo-network');
  });

  it('warns once and skips remote sync when the endpoint is invalid', async () => {
    const warnCalls: unknown[][] = [];
    let fetchCount = 0;

    setExpoNetworkLoaderForTests(async () => ({
      getNetworkStateAsync: async () => ({
        type: 'WIFI',
      }),
    }));
    setGlobal('fetch', (() => {
      fetchCount += 1;
      return Promise.resolve(new Response(null, { status: 204 }));
    }) as unknown as typeof fetch);
    console.warn = (...args: unknown[]) => {
      warnCalls.push(args);
    };

    const logger = createExpoLogger({
      endpoint: '/inngest',
    });

    logger.info('first');
    logger.info('second');
    await flushAsyncWork();

    expect(fetchCount).toBe(0);
    expect(warnCalls).toHaveLength(1);
    expect(String(warnCalls[0]?.[0] ?? '')).toContain('absolute http(s) URL');
  });

  it('swallows fetch failures without throwing', async () => {
    setExpoNetworkLoaderForTests(async () => ({
      getNetworkStateAsync: async () => ({
        type: 'WIFI',
      }),
    }));
    setGlobal('fetch', (() => Promise.reject(new Error('network'))) as unknown as typeof fetch);

    expect(() => {
      createExpoLogger({
        endpoint: 'https://api.example.test/inngest',
      }).info('retry me');
    }).not.toThrow();
    await flushAsyncWork();
  });

  it('retries transient Expo delivery failures and succeeds later', async () => {
    const harness = createExpoNetworkHarness({
      type: 'WIFI',
      isConnected: true,
      isInternetReachable: true,
    });
    const retryCalls: Array<{ attempt: number; retriesRemaining: number }> = [];
    const successCalls: number[] = [];
    let attemptCount = 0;

    setExpoNetworkLoaderForTests(harness.loader);
    setGlobal('fetch', (() => {
      attemptCount += 1;

      if (attemptCount < 3) {
        return Promise.reject(new Error('network'));
      }

      return Promise.resolve(new Response(null, { status: 204 }));
    }) as unknown as typeof fetch);

    createExpoLogger({
      endpoint: 'https://api.example.test/inngest',
      delivery: {
        retryDelayMs: 5,
        onRetry: (ctx) => {
          retryCalls.push({
            attempt: ctx.attempt,
            retriesRemaining: ctx.retriesRemaining,
          });
        },
        onSuccess: (ctx) => {
          successCalls.push(ctx.attempt);
        },
      },
    }).info('expo retry');

    await wait(30);

    expect(retryCalls).toEqual([
      { attempt: 1, retriesRemaining: 3 },
      { attempt: 2, retriesRemaining: 2 },
    ]);
    expect(successCalls).toEqual([3]);
  });

  it('queues while offline and flushes when Expo connectivity returns', async () => {
    const harness = createExpoNetworkHarness({
      type: 'NONE',
      isConnected: false,
      isInternetReachable: false,
    });
    const deliveredMessages: string[] = [];

    setExpoNetworkLoaderForTests(harness.loader);
    setGlobal('fetch', ((_url: string | URL | Request, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body ?? '')) as Record<string, unknown>;
      deliveredMessages.push(String(payload.message));
      return Promise.resolve(new Response(null, { status: 204 }));
    }) as typeof fetch);

    createExpoLogger({
      endpoint: 'https://api.example.test/inngest',
      delivery: {
        retryDelayMs: 50,
      },
    }).child({ feature: 'checkout' }).info('offline expo');
    await flushAsyncWork();

    expect(deliveredMessages).toEqual([]);
    expect(harness.listenerCount).toBe(1);

    harness.emit({
      type: 'WIFI',
      isConnected: true,
      isInternetReachable: true,
    });
    await wait(20);

    expect(deliveredMessages).toEqual(['offline expo']);
    expect(harness.listenerCount).toBe(0);
  });

  it('fires onFailure for terminal Expo setup errors while keeping warn-once messaging', async () => {
    const missingTransportFailures: string[] = [];
    const invalidEndpointFailures: string[] = [];
    const warnCalls: string[] = [];

    setExpoNetworkLoaderForTests(async () => null);
    setGlobal('fetch', (() => Promise.resolve(new Response(null, { status: 204 }))) as unknown as typeof fetch);
    console.warn = (...args: unknown[]) => {
      warnCalls.push(String(args[0] ?? ''));
    };

    const missingTransportLogger = createExpoLogger({
      endpoint: 'https://api.example.test/inngest',
      delivery: {
        onFailure: (ctx) => {
          missingTransportFailures.push(ctx.reason);
        },
      },
    });

    missingTransportLogger.info('first');
    missingTransportLogger.info('second');
    await flushAsyncWork();

    const harness = createExpoNetworkHarness({
      type: 'WIFI',
      isConnected: true,
      isInternetReachable: true,
    });

    setExpoNetworkLoaderForTests(harness.loader);
    const invalidEndpointLogger = createExpoLogger({
      endpoint: '/inngest',
      delivery: {
        onFailure: (ctx) => {
          invalidEndpointFailures.push(ctx.reason);
        },
      },
    });

    invalidEndpointLogger.info('third');
    invalidEndpointLogger.info('fourth');
    await flushAsyncWork();

    expect(missingTransportFailures).toEqual(['missing_transport', 'missing_transport']);
    expect(invalidEndpointFailures).toEqual(['invalid_endpoint', 'invalid_endpoint']);
    expect(warnCalls.filter((entry) => entry.includes('expo-network'))).toHaveLength(1);
    expect(warnCalls.filter((entry) => entry.includes('absolute http(s) URL'))).toHaveLength(1);
  });
});
