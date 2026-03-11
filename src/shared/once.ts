import type { ConsoleMethod, ConsoleOnceLogger } from '../types/shared/once';

export type { ConsoleOnceLogger } from '../types/shared/once';

function createConsoleOnceLogger(
  method: ConsoleMethod,
  warnedKeys: Set<string> = new Set<string>()
): ConsoleOnceLogger {
  return (key, message, error) => {
    if (warnedKeys.has(key) || typeof console === 'undefined') {
      return;
    }

    const writer = console[method];
    if (typeof writer !== 'function') {
      return;
    }

    warnedKeys.add(key);
    if (error === undefined) {
      writer.call(console, message);
      return;
    }

    writer.call(console, message, error);
  };
}

export function createWarnOnceLogger(warnedKeys?: Set<string>): ConsoleOnceLogger {
  return createConsoleOnceLogger('warn', warnedKeys);
}

export function createErrorOnceLogger(warnedKeys?: Set<string>): ConsoleOnceLogger {
  return createConsoleOnceLogger('error', warnedKeys);
}
