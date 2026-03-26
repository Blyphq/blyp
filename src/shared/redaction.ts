import {
  normalizeLogValue,
  serializeLogMessage,
} from './log-value';
import type {
  RedactionConfig,
  ResolvedRedactionConfig,
} from '../types/core/config';
import type { LogRecord } from '../types/core/file-logger';
import type { HeaderRecord, RequestLike } from '../types/frameworks/http';

export const REDACTED_VALUE = '[REDACTED]';

export const DEFAULT_REDACTED_KEYS = [
  'password',
  'passwd',
  'pwd',
  'secret',
  'token',
  'api_key',
  'apikey',
  'api_secret',
  'authorization',
  'auth',
  'x-api-key',
  'private_key',
  'privatekey',
  'access_token',
  'refresh_token',
  'client_secret',
  'session',
  'cookie',
  'set-cookie',
  'ssn',
  'credit_card',
  'card_number',
  'cvv',
  'cvc',
  'otp',
  'pin',
] as const;

export const DEFAULT_SENSITIVE_HEADERS = [
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
] as const;

const DEFAULT_REDACTION_PATTERNS = [
  {
    type: 'bearer',
    pattern: /\bBearer\s+(?:sk-[A-Za-z0-9]{20,}|pk_(?:live|test)_[A-Za-z0-9]{16,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|[A-Za-z0-9._~+/-]{20,})\b/g,
  },
  {
    type: 'jwt',
    pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  },
  {
    type: 'api_key',
    pattern: /\b(?:sk-[A-Za-z0-9]{20,}|pk_(?:live|test)_[A-Za-z0-9]{16,})\b/g,
  },
] as const;

const CARD_CANDIDATE_PATTERN = /\b(?:\d[ -]*?){16}\b/g;

interface SanitizerContext {
  readonly path: string[];
  readonly skipPatternScanning?: boolean;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (typeof value !== 'string' || value.length === 0 || seen.has(value)) {
      continue;
    }

    seen.add(value);
    result.push(value);
  }

  return result;
}

function toGlobalPattern(pattern: RegExp): RegExp {
  const flags = pattern.flags.includes('g')
    ? pattern.flags
    : `${pattern.flags}g`;
  return new RegExp(pattern.source, flags);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function getKeySet(config: ResolvedRedactionConfig): Set<string> {
  return new Set(config.keys.map((key) => key.toLowerCase()));
}

function getSensitiveHeaderSet(config: ResolvedRedactionConfig): Set<string> {
  return new Set([
    ...DEFAULT_SENSITIVE_HEADERS,
    ...config.keys.map((key) => key.toLowerCase()),
  ]);
}

function splitPath(path: string): string[] {
  return path.split('.').filter(Boolean);
}

function pathMatches(pattern: string[], path: string[], patternIndex = 0, pathIndex = 0): boolean {
  if (patternIndex === pattern.length) {
    return pathIndex === path.length;
  }

  const segment = pattern[patternIndex];
  if (segment === '**') {
    if (patternIndex === pattern.length - 1) {
      return true;
    }

    for (let nextPathIndex = pathIndex; nextPathIndex <= path.length; nextPathIndex += 1) {
      if (pathMatches(pattern, path, patternIndex + 1, nextPathIndex)) {
        return true;
      }
    }

    return false;
  }

  if (pathIndex >= path.length) {
    return false;
  }

  if (segment !== '*' && segment !== path[pathIndex]) {
    return false;
  }

  return pathMatches(pattern, path, patternIndex + 1, pathIndex + 1);
}

function matchesConfiguredPath(path: string[], config: ResolvedRedactionConfig): boolean {
  if (path.length === 0 || config.paths.length === 0) {
    return false;
  }

  return config.paths.some((candidate) => pathMatches(splitPath(candidate), path));
}

function isCardMatch(match: string): boolean {
  const digits = match.replace(/\D/g, '');
  if (digits.length !== 16) {
    return false;
  }

  let sum = 0;
  let shouldDouble = false;

  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);

    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }

    sum += digit;
    shouldDouble = !shouldDouble;
  }

  return sum % 10 === 0;
}

function sanitizeString(
  value: string,
  config: ResolvedRedactionConfig,
  skipPatternScanning: boolean
): string {
  if (skipPatternScanning || config.disablePatternScanning) {
    return value;
  }

  let sanitized = value;

  for (const { type, pattern } of DEFAULT_REDACTION_PATTERNS) {
    sanitized = sanitized.replace(pattern, `[REDACTED:${type}]`);
  }

  sanitized = sanitized.replace(CARD_CANDIDATE_PATTERN, (match) => {
    return isCardMatch(match) ? '[REDACTED:card]' : match;
  });

  for (const pattern of config.patterns) {
    sanitized = sanitized.replace(toGlobalPattern(pattern), '[REDACTED:pattern]');
  }

  return sanitized;
}

function sanitizeNormalizedValue(
  value: unknown,
  config: ResolvedRedactionConfig,
  keySet: Set<string>,
  context: SanitizerContext
): unknown {
  if (typeof value === 'string') {
    return sanitizeString(value, config, Boolean(context.skipPatternScanning));
  }

  if (
    value === null ||
    value === undefined ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry, index) => {
      return sanitizeNormalizedValue(entry, config, keySet, {
        path: [...context.path, String(index)],
        skipPatternScanning: context.skipPatternScanning,
      });
    });
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const sanitized: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(value)) {
    const nextPath = [...context.path, key];
    if (keySet.has(key.toLowerCase()) || matchesConfiguredPath(nextPath, config)) {
      if (
        entry === null ||
        entry === undefined ||
        typeof entry === 'string' ||
        typeof entry === 'number' ||
        typeof entry === 'boolean'
      ) {
        sanitized[key] = REDACTED_VALUE;
        continue;
      }

      sanitized[key] = sanitizeNormalizedValue(entry, config, keySet, {
        path: nextPath,
        skipPatternScanning: context.skipPatternScanning,
      });
      continue;
    }

    sanitized[key] = sanitizeNormalizedValue(entry, config, keySet, {
      path: nextPath,
      skipPatternScanning: context.skipPatternScanning,
    });
  }

  return sanitized;
}

export function resolveRedactionConfig(
  base?: RedactionConfig | ResolvedRedactionConfig,
  override?: RedactionConfig
): ResolvedRedactionConfig {
  return {
    keys: uniqueStrings([
      ...DEFAULT_REDACTED_KEYS,
      ...(base?.keys ?? []),
      ...(override?.keys ?? []),
    ]),
    paths: uniqueStrings([
      ...(base?.paths ?? []),
      ...(override?.paths ?? []),
    ]),
    patterns: [
      ...(base?.patterns ?? []),
      ...(override?.patterns ?? []),
    ].filter((pattern): pattern is RegExp => pattern instanceof RegExp),
    disablePatternScanning:
      override?.disablePatternScanning ??
      base?.disablePatternScanning ??
      false,
  };
}

export function sanitizeLogValue(
  value: unknown,
  config: ResolvedRedactionConfig,
  context: SanitizerContext = { path: [] }
): unknown {
  const normalized = normalizeLogValue(value);
  return sanitizeNormalizedValue(normalized, config, getKeySet(config), context);
}

export function sanitizeLogMessage(message: unknown, config: ResolvedRedactionConfig): string {
  if (typeof message === 'string') {
    return sanitizeString(message, config, false);
  }

  return serializeLogMessage(sanitizeLogValue(message, config));
}

export function sanitizeLogRecord(
  record: LogRecord,
  config: ResolvedRedactionConfig
): LogRecord {
  return sanitizeLogValue(record, config) as LogRecord;
}

export function toHeaderRecord(headers: RequestLike['headers']): HeaderRecord {
  if (!headers) {
    return {};
  }

  if (headers instanceof Headers) {
    const record: HeaderRecord = {};
    headers.forEach((value, key) => {
      record[key] = value;
    });
    return record;
  }

  if (typeof (headers as { entries?: unknown }).entries === 'function') {
    const record: HeaderRecord = {};
    for (const [key, value] of (headers as Headers).entries()) {
      record[key] = value;
    }
    return record;
  }

  if (typeof (headers as { get?: unknown }).get === 'function') {
    return {};
  }

  return { ...(headers as HeaderRecord) };
}

export function sanitizeHeaders(
  headers: RequestLike['headers'] | HeaderRecord | undefined,
  config: ResolvedRedactionConfig
): HeaderRecord {
  const record = toHeaderRecord(headers as RequestLike['headers']);
  const sensitiveHeaders = getSensitiveHeaderSet(config);
  const sanitized: HeaderRecord = {};

  for (const [key, value] of Object.entries(record)) {
    if (sensitiveHeaders.has(key.toLowerCase())) {
      sanitized[key] = REDACTED_VALUE;
      continue;
    }

    if (Array.isArray(value)) {
      sanitized[key] = value.map((entry) => sanitizeString(entry, config, false));
      continue;
    }

    sanitized[key] =
      typeof value === 'string'
        ? sanitizeString(value, config, false)
        : value;
  }

  return sanitized;
}
