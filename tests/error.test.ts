import { describe, expect, it } from 'bun:test';
import {
  HTTP_CODES,
  BlypError,
  createError,
} from '../src';
import { emitHttpErrorLog, toErrorLike } from '../src/frameworks/shared/logger';
import type { BlypLogger } from '../src/core/logger';

interface RecordedCall {
  level: string;
  message: unknown;
  meta: unknown[];
}

function createFakeLogger() {
  const calls: RecordedCall[] = [];

  const logger: BlypLogger = {
    success: (message: unknown, ...meta: unknown[]) => {
      calls.push({ level: 'success', message, meta });
    },
    critical: (message: unknown, ...meta: unknown[]) => {
      calls.push({ level: 'critical', message, meta });
    },
    warning: (message: unknown, ...meta: unknown[]) => {
      calls.push({ level: 'warning', message, meta });
    },
    info: (message: unknown, ...meta: unknown[]) => {
      calls.push({ level: 'info', message, meta });
    },
    debug: (message: unknown, ...meta: unknown[]) => {
      calls.push({ level: 'debug', message, meta });
    },
    error: (message: unknown, ...meta: unknown[]) => {
      calls.push({ level: 'error', message, meta });
    },
    warn: (message: unknown, ...meta: unknown[]) => {
      calls.push({ level: 'warn', message, meta });
    },
    table: (message: string, data?: unknown) => {
      calls.push({ level: 'table', message, meta: data === undefined ? [] : [data] });
    },
    child: () => logger,
  };

  return { logger, calls };
}

describe('createError', () => {
  it('returns a throwable BlypError instance', () => {
    const error = createError({
      status: 400,
      message: 'Invalid payment amount',
      skipLogging: true,
    });

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(BlypError);
    expect(error.name).toBe('BlypError');
    expect(error.status).toBe(400);
    expect(error.statusCode).toBe(400);
    expect(error.message).toBe('Invalid payment amount');
  });

  it('uses the default HTTP reason phrase when only a status is provided', () => {
    const error = createError({
      status: 404,
      skipLogging: true,
    });

    expect(error.message).toBe('Not Found');
  });

  it('preserves metadata and exposes a JSON-safe representation', () => {
    const cause = new Error('issuer rejected');
    const error = createError({
      status: 402,
      code: 'PAYMENT_DECLINED',
      message: 'Payment failed',
      why: 'Card declined by issuer',
      fix: 'Try a different payment method',
      link: 'https://docs.example.com/payments/declined',
      details: { paymentId: 'pay_123' },
      cause,
      skipLogging: true,
    });

    expect(error.code).toBe('PAYMENT_DECLINED');
    expect(error.why).toBe('Card declined by issuer');
    expect(error.fix).toBe('Try a different payment method');
    expect(error.link).toBe('https://docs.example.com/payments/declined');
    expect(error.details).toEqual({ paymentId: 'pay_123' });
    expect(error.cause).toBe(cause);
    expect(error.toJSON()).toEqual({
      name: 'BlypError',
      message: 'Payment failed',
      status: 402,
      statusCode: 402,
      code: 'PAYMENT_DECLINED',
      why: 'Card declined by issuer',
      fix: 'Try a different payment method',
      link: 'https://docs.example.com/payments/declined',
      details: { paymentId: 'pay_123' },
    });
  });

  it('logs once at error level for 4xx errors', () => {
    const { logger, calls } = createFakeLogger();

    createError({
      status: 404,
      message: 'User not found',
      logger,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      level: 'error',
      message: 'User not found',
    });
    expect(calls[0]?.meta[0]).toEqual({
      type: 'application_error',
      status: 404,
      statusCode: 404,
      code: undefined,
      why: undefined,
      fix: undefined,
      link: undefined,
      details: undefined,
      cause: undefined,
    });
  });

  it('logs once at critical level for 5xx errors and normalizes causes', () => {
    const { logger, calls } = createFakeLogger();

    createError({
      status: 503,
      message: 'Payment gateway unavailable',
      cause: new Error('upstream timed out'),
      logger,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.level).toBe('critical');
    expect(calls[0]?.meta[0]).toMatchObject({
      type: 'application_error',
      status: 503,
      statusCode: 503,
      cause: {
        name: 'Error',
        message: 'upstream timed out',
      },
    });
  });

  it('supports explicit log levels and skipLogging', () => {
    const first = createFakeLogger();
    createError({
      status: 503,
      message: 'Payment gateway unavailable',
      logLevel: 'warning',
      logger: first.logger,
    });

    expect(first.calls).toHaveLength(1);
    expect(first.calls[0]?.level).toBe('warning');

    const second = createFakeLogger();
    createError({
      status: 400,
      message: 'Ignored',
      skipLogging: true,
      logger: second.logger,
    });

    expect(second.calls).toHaveLength(0);
  });
});

describe('HTTP_CODES', () => {
  it('exposes built-in HTTP presets', () => {
    expect(HTTP_CODES.BAD_REQUEST.status).toBe(400);
    expect(HTTP_CODES.BAD_REQUEST.statusCode).toBe(400);
    expect(HTTP_CODES.NOT_FOUND.message).toBe('Not Found');
  });

  it('creates BlypError instances from built-in presets', () => {
    const error = HTTP_CODES.BAD_REQUEST.create({
      skipLogging: true,
    });

    expect(error).toBeInstanceOf(BlypError);
    expect(error.status).toBe(400);
    expect(error.message).toBe('Bad Request');
  });

  it('supports derived presets with inheritance and per-call overrides', () => {
    const INVALID_PAYMENT_AMOUNT = HTTP_CODES.BAD_REQUEST.extend({
      code: 'INVALID_PAYMENT_AMOUNT',
      message: 'Invalid payment amount',
      why: 'The amount must be a positive number',
      fix: 'Pass a positive integer in cents',
    });

    const nested = INVALID_PAYMENT_AMOUNT.extend({
      code: 'CHECKOUT_INVALID_PAYMENT_AMOUNT',
      link: 'https://docs.example.com/payments/amount',
    });

    const error = nested.create({
      message: 'Checkout amount rejected',
      skipLogging: true,
    });

    expect(INVALID_PAYMENT_AMOUNT.status).toBe(400);
    expect(INVALID_PAYMENT_AMOUNT.code).toBe('INVALID_PAYMENT_AMOUNT');
    expect(error.status).toBe(400);
    expect(error.code).toBe('CHECKOUT_INVALID_PAYMENT_AMOUNT');
    expect(error.message).toBe('Checkout amount rejected');
    expect(error.why).toBe('The amount must be a positive number');
    expect(error.fix).toBe('Pass a positive integer in cents');
    expect(error.link).toBe('https://docs.example.com/payments/amount');
  });
});

describe('framework error normalization', () => {
  it('preserves rich metadata in toErrorLike', () => {
    const original = createError({
      status: 402,
      code: 'PAYMENT_DECLINED',
      message: 'Payment failed',
      why: 'Card declined by issuer',
      fix: 'Try a different card',
      link: 'https://docs.example.com/payments/declined',
      details: { paymentId: 'pay_123' },
      cause: { provider: 'stripe' },
      skipLogging: true,
    });

    expect(toErrorLike(original)).toEqual({
      status: 402,
      statusCode: 402,
      code: 'PAYMENT_DECLINED',
      message: 'Payment failed',
      stack: original.stack,
      why: 'Card declined by issuer',
      fix: 'Try a different card',
      link: 'https://docs.example.com/payments/declined',
      details: { paymentId: 'pay_123' },
      cause: { provider: 'stripe' },
    });
  });

  it('includes rich metadata in emitted HTTP error logs', () => {
    const { logger, calls } = createFakeLogger();

    const errorLog = emitHttpErrorLog(
      logger,
      'debug',
      {
        method: 'POST',
        url: 'https://example.com/payments',
      },
      '/payments',
      402,
      18,
      {
        status: 402,
        statusCode: 402,
        code: 'PAYMENT_DECLINED',
        message: 'Payment failed',
        why: 'Card declined by issuer',
        fix: 'Try a different card',
        link: 'https://docs.example.com/payments/declined',
        details: { paymentId: 'pay_123' },
      }
    );

    expect(errorLog).toMatchObject({
      type: 'http_error',
      statusCode: 402,
      error: 'Payment failed',
      code: 'PAYMENT_DECLINED',
      why: 'Card declined by issuer',
      fix: 'Try a different card',
      link: 'https://docs.example.com/payments/declined',
      details: { paymentId: 'pay_123' },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.level).toBe('error');
    expect(calls[0]?.meta[0]).toMatchObject({
      type: 'http_error',
      code: 'PAYMENT_DECLINED',
      why: 'Card declined by issuer',
      fix: 'Try a different card',
      link: 'https://docs.example.com/payments/declined',
      details: { paymentId: 'pay_123' },
    });
  });
});
