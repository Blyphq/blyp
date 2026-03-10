import { describe, expect, it } from 'bun:test';
import {
  BlypError,
  createError,
  parseError,
} from '../src';
import {
  HTTP_CODES as CLIENT_HTTP_CODES,
  parseError as clientParseError,
} from '../src/frameworks/client';
import type { ErrorLoggerLike } from '../src/shared/errors';

interface RecordedCall {
  level: string;
  message: unknown;
  meta: unknown[];
}

function createFakeLogger(): { logger: ErrorLoggerLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];

  const logger: ErrorLoggerLike = {
    debug: (message: unknown, ...meta: unknown[]) => {
      calls.push({ level: 'debug', message, meta });
    },
    info: (message: unknown, ...meta: unknown[]) => {
      calls.push({ level: 'info', message, meta });
    },
    warning: (message: unknown, ...meta: unknown[]) => {
      calls.push({ level: 'warning', message, meta });
    },
    error: (message: unknown, ...meta: unknown[]) => {
      calls.push({ level: 'error', message, meta });
    },
    critical: (message: unknown, ...meta: unknown[]) => {
      calls.push({ level: 'critical', message, meta });
    },
  };

  return { logger, calls };
}

describe('parseError payload hydration', () => {
  it('returns the same BlypError instance', () => {
    const original = createError({
      status: 402,
      message: 'Payment failed',
      skipLogging: true,
    });

    const parsed = parseError(original);

    expect(parsed).toBe(original);
  });

  it('hydrates generic Error instances into BlypError', () => {
    const original = new Error('Boom');
    const parsed = parseError(original);

    expect(parsed).toBeInstanceOf(BlypError);
    expect(parsed.message).toBe('Boom');
    expect(parsed.stack).toBe(original.stack);
    expect(parsed.status).toBe(500);
  });

  it('preserves flat Blyp error payload fields', () => {
    const parsed = parseError({
      status: 402,
      code: 'PAYMENT_DECLINED',
      message: 'Payment failed',
      why: 'Card declined by issuer',
      fix: 'Try a different card',
      link: 'https://docs.example.com/payments/declined',
      details: { paymentId: 'pay_123' },
    });

    expect(parsed.status).toBe(402);
    expect(parsed.code).toBe('PAYMENT_DECLINED');
    expect(parsed.message).toBe('Payment failed');
    expect(parsed.why).toBe('Card declined by issuer');
    expect(parsed.fix).toBe('Try a different card');
    expect(parsed.link).toBe('https://docs.example.com/payments/declined');
    expect(parsed.details).toEqual({ paymentId: 'pay_123' });
  });

  it('unwraps nested error objects', () => {
    const parsed = parseError({
      error: {
        status: 404,
        message: 'User not found',
        fix: 'Check the user id',
      },
    });

    expect(parsed.status).toBe(404);
    expect(parsed.message).toBe('User not found');
    expect(parsed.fix).toBe('Check the user id');
  });

  it('uses nested string error messages', () => {
    const parsed = parseError({
      status: 404,
      error: 'User not found',
    });

    expect(parsed.status).toBe(404);
    expect(parsed.message).toBe('User not found');
  });

  it('unwraps doubly nested error payloads', () => {
    const parsed = parseError({
      data: {
        error: {
          status: 403,
          message: 'Forbidden',
          why: 'Missing permission',
        },
      },
    });

    expect(parsed.status).toBe(403);
    expect(parsed.message).toBe('Forbidden');
    expect(parsed.why).toBe('Missing permission');
  });

  it('uses raw string payloads directly', () => {
    const parsed = parseError('plain text failure');

    expect(parsed.message).toBe('plain text failure');
    expect(parsed.status).toBe(500);
  });

  it('falls back to HTTP preset reason phrases', () => {
    const parsed = parseError(undefined, {
      fallbackStatus: 404,
    });

    expect(parsed.status).toBe(404);
    expect(parsed.message).toBe('Not Found');
  });

  it('is exported from the client entrypoint', () => {
    const parsed = clientParseError({
      status: 404,
      message: 'Client missing user',
    });

    expect(parsed).toBeInstanceOf(BlypError);
    expect(parsed.message).toBe('Client missing user');
    expect(CLIENT_HTTP_CODES.NOT_FOUND.message).toBe('Not Found');
  });
});

describe('parseError response hydration', () => {
  it('round-trips serialized Blyp errors from JSON responses', async () => {
    const error = createError({
      status: 402,
      code: 'PAYMENT_DECLINED',
      message: 'Payment failed',
      why: 'Card declined by issuer',
      fix: 'Try a different payment method',
      skipLogging: true,
    });
    const response = new Response(JSON.stringify(error.toJSON()), {
      status: 402,
      headers: {
        'content-type': 'application/json',
      },
    });

    const parsed = await parseError(response);

    expect(parsed.status).toBe(402);
    expect(parsed.code).toBe('PAYMENT_DECLINED');
    expect(parsed.message).toBe('Payment failed');
    expect(parsed.why).toBe('Card declined by issuer');
    expect(parsed.fix).toBe('Try a different payment method');
  });

  it('parses nested JSON error objects from responses', async () => {
    const response = new Response(
      JSON.stringify({
        error: {
          status: 404,
          message: 'User not found',
          fix: 'Check the user id',
        },
      }),
      {
        status: 404,
        headers: {
          'content-type': 'application/json',
        },
      }
    );

    const parsed = await parseError(response);

    expect(parsed.status).toBe(404);
    expect(parsed.message).toBe('User not found');
    expect(parsed.fix).toBe('Check the user id');
  });

  it('parses flat JSON message responses', async () => {
    const response = new Response(JSON.stringify({ message: 'User not found' }), {
      status: 404,
      headers: {
        'content-type': 'application/json',
      },
    });

    const parsed = await parseError(response);

    expect(parsed.status).toBe(404);
    expect(parsed.message).toBe('User not found');
  });

  it('uses text bodies as the message', async () => {
    const response = new Response('fail', {
      status: 500,
      headers: {
        'content-type': 'text/plain',
      },
    });

    const parsed = await parseError(response);

    expect(parsed.status).toBe(500);
    expect(parsed.message).toBe('fail');
  });

  it('falls back to statusText for empty response bodies', async () => {
    const response = new Response('', {
      status: 404,
      statusText: 'Missing resource',
    });

    const parsed = await parseError(response);

    expect(parsed.status).toBe(404);
    expect(parsed.message).toBe('Missing resource');
  });

  it('falls back to HTTP reason phrases when statusText is empty', async () => {
    const response = new Response('', {
      status: 401,
      statusText: '',
    });

    const parsed = await parseError(response);

    expect(parsed.status).toBe(401);
    expect(parsed.message).toBe('Unauthorized');
  });

  it('falls back to text when JSON parsing fails', async () => {
    const response = new Response('{', {
      status: 400,
      headers: {
        'content-type': 'application/json',
      },
    });

    const parsed = await parseError(response);

    expect(parsed.status).toBe(400);
    expect(parsed.message).toBe('{');
  });

  it('treats the response status as authoritative', async () => {
    const response = new Response(JSON.stringify({
      status: 400,
      message: 'Body says bad request',
    }), {
      status: 404,
      headers: {
        'content-type': 'application/json',
      },
    });

    const parsed = await parseError(response);

    expect(parsed.status).toBe(404);
    expect(parsed.statusCode).toBe(404);
    expect(parsed.message).toBe('Body says bad request');
  });
});

describe('parseError optional logging', () => {
  it('logs once for payload parsing when a logger is provided', () => {
    const { logger, calls } = createFakeLogger();

    const parsed = parseError({
      status: 404,
      message: 'User not found',
    }, {
      logger,
    });

    expect(parsed.message).toBe('User not found');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      level: 'error',
      message: 'User not found',
    });
  });

  it('logs once for response parsing when a logger is provided', async () => {
    const { logger, calls } = createFakeLogger();
    const response = new Response(JSON.stringify({ message: 'Payment failed' }), {
      status: 502,
      headers: {
        'content-type': 'application/json',
      },
    });

    const parsed = await parseError(response, {
      logger,
    });

    expect(parsed.status).toBe(502);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.level).toBe('critical');
  });

  it('honors explicit parse-time log levels', () => {
    const { logger, calls } = createFakeLogger();

    parseError({
      status: 503,
      message: 'Service unavailable',
    }, {
      logger,
      logLevel: 'warning',
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.level).toBe('warning');
  });
});
