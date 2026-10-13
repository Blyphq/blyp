import type { LogRecord } from '../core/file-logger';
import { isPlainObject } from '../shared/validation';

/** JSON-safe exception contract, including browser-to-server transport. */
export interface SerializedException {
  name?: string;
  message: string;
  stack?: string;
  cause?: SerializedException | string;
}

export interface ExceptionContext {
  error?: Error | SerializedException;
  userId?: string;
  distinctId?: string;
  organizationId?: string;
  requestId?: string;
  traceId?: string;
  $session_id?: string;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  fingerprint?: string[];
  contexts?: Record<string, Record<string, unknown> | null>;
}

/** Per-record fields override child bindings, which override parent bindings. */
export function exceptionFields(record: LogRecord, source: 'server' | 'client' = 'server'): Record<string, unknown> {
  const fields = {
    ...(isPlainObject(record.bindings) ? record.bindings : {}),
    ...record,
    ...(isPlainObject(record.data) ? record.data : {}),
  };
  if (source === 'client') {
    const server = isPlainObject(fields.serverContext) ? fields.serverContext : {};
    const bindings = isPlainObject(record.bindings) ? record.bindings : {};
    for (const key of ['userId', 'distinctId', 'organizationId']) {
      delete fields[key];
      const trusted = server[key] ?? bindings[key];
      if (typeof trusted === 'string') fields[key] = trusted;
    }
  }
  return fields;
}

export function restoreException(value: unknown, seen = new WeakSet<object>()): Error | undefined {
  if (value instanceof Error) return value;
  if (!isPlainObject(value) || typeof value.message !== 'string' || seen.has(value)) return undefined;
  seen.add(value);
  const error = new Error(value.message);
  error.name = typeof value.name === 'string' ? value.name : 'Error';
  // Never attribute a transported exception to this adapter's synthetic stack.
  error.stack = typeof value.stack === 'string' ? value.stack : undefined;
  if (value.cause !== undefined) {
    (error as Error & { cause?: unknown }).cause = restoreException(value.cause, seen) ?? value.cause;
  }
  return error;
}

export function recordException(record: LogRecord): Error | undefined {
  const data = isPlainObject(record.data) ? record.data : {};
  // A bare serialized Error is supported; arbitrary metadata with only a message is not.
  const transported = isPlainObject(data.data) ? data.data : {};
  return restoreException(record.error) ?? restoreException(data.error) ?? restoreException(transported.error) ??
    (typeof transported.name === 'string' ? restoreException(transported) : undefined) ??
    (typeof data.name === 'string' && typeof data.message === 'string' ? restoreException(data) : undefined);
}

export function stripSourceContext(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) { for (const item of value) stripSourceContext(item); return; }
  const fields = value as Record<string, unknown>;
  if ('filename' in fields || 'lineno' in fields || 'function' in fields) {
    delete fields.pre_context;
    delete fields.post_context;
    delete fields.context_line;
  }
  for (const nested of Object.values(fields)) stripSourceContext(nested);
}
