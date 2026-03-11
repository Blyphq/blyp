import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  createWorkersLogger,
  initWorkersLogger,
} from '../../src/frameworks/workers';

type ConsoleMethod = 'debug' | 'info' | 'warn' | 'error' | 'log' | 'table';
type ConsoleCalls = Record<ConsoleMethod, unknown[][]>;

const originalConsole = {
  debug: console.debug,
  info: console.info,
  warn: console.warn,
  error: console.error,
  log: console.log,
  table: console.table,
};

function createConsoleCalls(): ConsoleCalls {
  return {
    debug: [],
    info: [],
    warn: [],
    error: [],
    log: [],
    table: [],
  };
}

function installConsoleSpies(calls: ConsoleCalls): void {
  console.debug = (...args: unknown[]) => {
    calls.debug.push(args);
  };
  console.info = (...args: unknown[]) => {
    calls.info.push(args);
  };
  console.warn = (...args: unknown[]) => {
    calls.warn.push(args);
  };
  console.error = (...args: unknown[]) => {
    calls.error.push(args);
  };
  console.log = (...args: unknown[]) => {
    calls.log.push(args);
  };
  console.table = ((...args: unknown[]) => {
    calls.table.push(args);
  }) as typeof console.table;
}

function restoreConsole(): void {
  console.debug = originalConsole.debug;
  console.info = originalConsole.info;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
  console.log = originalConsole.log;
  console.table = originalConsole.table;
}

describe('Workers Integration', () => {
  let calls: ConsoleCalls;

  beforeEach(() => {
    calls = createConsoleCalls();
    restoreConsole();
    installConsoleSpies(calls);
    initWorkersLogger();
  });

  afterEach(() => {
    initWorkersLogger();
    restoreConsole();
  });

  it('applies env and customProps fields to emitted request logs', () => {
    initWorkersLogger({
      env: { service: 'worker-app' },
      customProps: (request) => ({
        requestId: request.headers.get('x-request-id'),
      }),
    });

    const log = createWorkersLogger(
      new Request('https://edge.example.test/api/posts?draft=true', {
        method: 'POST',
        headers: {
          'x-request-id': 'req-123',
          'cf-connecting-ip': '203.0.113.10',
          'user-agent': 'Mozilla/5.0 Test Browser',
        },
      })
    );

    const payload = log
      .set({ action: 'handle_request' })
      .emit();

    expect(payload.type).toBe('http_request');
    expect(payload.method).toBe('POST');
    expect(payload.url).toBe('/api/posts');
    expect(payload.statusCode).toBe(200);
    expect(typeof payload.responseTime).toBe('number');
    expect(payload.responseTime).toBeGreaterThanOrEqual(0);
    expect(payload.service).toBe('worker-app');
    expect(payload.requestId).toBe('req-123');
    expect(payload.action).toBe('handle_request');
    expect(payload.ip).toBe('203.0.113.10');
    expect(calls.info).toHaveLength(1);
    expect((calls.info[0]?.[1] as Record<string, unknown>).service).toBe('worker-app');
  });

  it('uses response and explicit status overrides when emitting', () => {
    const createdLog = createWorkersLogger(
      new Request('https://edge.example.test/items', { method: 'PUT' })
    );
    const createdPayload = createdLog.emit({
      response: new Response(null, { status: 201 }),
    });

    const noContentLog = createWorkersLogger(
      new Request('https://edge.example.test/items/1', { method: 'DELETE' })
    );
    const noContentPayload = noContentLog.emit({ status: 204 });

    expect(createdPayload.statusCode).toBe(201);
    expect(createdPayload.type).toBe('http_request');
    expect(noContentPayload.statusCode).toBe(204);
    expect(noContentPayload.type).toBe('http_request');
    expect(calls.info).toHaveLength(2);
  });

  it('treats errors and 4xx responses as http_error logs', () => {
    const thrownLog = createWorkersLogger(
      new Request('https://edge.example.test/fail', { method: 'GET' })
    );
    const thrownPayload = thrownLog.emit({ error: new Error('boom') });

    const notFoundLog = createWorkersLogger(
      new Request('https://edge.example.test/missing', { method: 'GET' })
    );
    const notFoundPayload = notFoundLog.emit({ status: 404 });

    expect(thrownPayload.type).toBe('http_error');
    expect(thrownPayload.statusCode).toBe(500);
    expect(thrownPayload.error).toBe('boom');
    expect(typeof thrownPayload.stack).toBe('string');
    expect(notFoundPayload.type).toBe('http_error');
    expect(notFoundPayload.statusCode).toBe(404);
    expect(notFoundPayload.error).toBe('HTTP 404');
    expect(calls.error).toHaveLength(2);
  });

  it('writes scoped console logs before the final emit', () => {
    initWorkersLogger({
      env: { service: 'worker-app' },
    });

    const log = createWorkersLogger(
      new Request('https://edge.example.test/dashboard', { method: 'GET' })
    );

    log.set({ action: 'hydrate' });
    log.info('worker started', { route: 'dashboard' });

    expect(calls.info).toHaveLength(1);
    expect(calls.info[0]?.[0]).toBe('worker started');

    const payload = calls.info[0]?.[1] as Record<string, unknown>;
    expect((payload.request as Record<string, unknown>).url).toBe('/dashboard');
    expect(payload.service).toBe('worker-app');
    expect(payload.action).toBe('hydrate');
    expect(payload.data).toEqual({ route: 'dashboard' });
  });

  it('uses console.table when table logging is requested', () => {
    const log = createWorkersLogger(
      new Request('https://edge.example.test/report', { method: 'GET' })
    );

    log.table('report table', [{ status: 'ok' }]);

    expect(calls.log).toHaveLength(1);
    expect(calls.log[0]?.[0]).toBe('report table');
    expect(calls.table).toHaveLength(1);
    expect(calls.table[0]?.[0]).toEqual([{ status: 'ok' }]);
  });

  it('returns the first emitted record without logging again', () => {
    const log = createWorkersLogger(
      new Request('https://edge.example.test/repeat', { method: 'GET' })
    );

    const first = log.emit({ status: 202 });
    const second = log.emit({ status: 204 });

    expect(first).toBe(second);
    expect(first.statusCode).toBe(202);
    expect(calls.info).toHaveLength(1);
  });

  it('creates structured worker logs with flat payload fields', () => {
    initWorkersLogger({
      env: { service: 'worker-app' },
    });

    const log = createWorkersLogger(
      new Request('https://edge.example.test/checkout', { method: 'POST' })
    );

    const payload = log
      .createStructuredLog('checkout', { userId: 'user-1' })
      .set({ cartItems: 3 })
      .info('worker started', { route: '/checkout' })
      .emit({ status: 200 });

    expect(payload.groupId).toBe('checkout');
    expect(payload.method).toBe('POST');
    expect(payload.path).toBe('/checkout');
    expect(payload.service).toBe('worker-app');
    expect(payload.status).toBe(200);
    expect(payload.events?.[0]?.message).toBe('worker started');
    expect(calls.info).toHaveLength(1);
    expect((calls.info[0]?.[1] as Record<string, unknown>).groupId).toBe('checkout');
  });
});
