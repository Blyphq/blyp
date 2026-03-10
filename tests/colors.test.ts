import { describe, expect, it } from 'bun:test';
import {
  getArrowForMethod,
  getColoredLevel,
  getMethodColor,
  getResponseTimeColor,
  getStatusColor,
} from '../src/core/colors';

describe('Color Helpers', () => {
  it('colors log levels', () => {
    const levels = ['error', 'info', 'success', 'critical', 'debug', 'warning'];

    for (const level of levels) {
      const colored = getColoredLevel(level);
      const expected = level === 'warning' ? 'WARNING' : level.toUpperCase();
      expect(colored).toContain(expected);
    }
  });

  it('colors HTTP methods and arrows', () => {
    const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

    for (const method of methods) {
      expect(getMethodColor(method)).toContain(method);
      expect(getArrowForMethod(method)).toEqual(expect.any(String));
    }
  });

  it('colors status codes and response times', () => {
    for (const statusCode of [200, 301, 404, 500]) {
      expect(getStatusColor(statusCode)).toContain(String(statusCode));
    }

    for (const duration of [10, 150, 500, 1500]) {
      expect(getResponseTimeColor(duration)).toContain(`${duration}ms`);
    }
  });
});
