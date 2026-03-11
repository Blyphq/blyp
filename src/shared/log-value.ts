export function normalizeError(error: Error): Record<string, unknown> {
  const normalized: Record<string, unknown> = {
    name: error.name,
    message: error.message,
  };

  if (error.stack) {
    normalized.stack = error.stack;
  }

  const errorWithCause = error as Error & { cause?: unknown };
  if (errorWithCause.cause !== undefined) {
    normalized.cause = normalizeLogValue(errorWithCause.cause);
  }

  return normalized;
}

export function normalizeLogValue(
  value: unknown,
  seen: WeakSet<object> = new WeakSet()
): unknown {
  if (value instanceof Error) {
    return normalizeError(value);
  }

  if (typeof value === 'function') {
    return `[Function: ${value.name || 'anonymous'}]`;
  }

  if (typeof value === 'symbol') {
    return value.toString();
  }

  if (value === undefined || value === null) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeLogValue(entry, seen));
  }

  if (typeof value === 'object') {
    if (seen.has(value)) {
      return '[Circular]';
    }

    seen.add(value);
    const normalized: Record<string, unknown> = {};

    for (const [key, entry] of Object.entries(value)) {
      normalized[key] = normalizeLogValue(entry, seen);
    }

    seen.delete(value);
    return normalized;
  }

  return value;
}

export function serializeLogMessage(message: unknown): string {
  if (typeof message === 'string') {
    return message;
  }

  if (message instanceof Error) {
    return message.message || message.name;
  }

  const normalized = normalizeLogValue(message);
  if (typeof normalized === 'string') {
    return normalized;
  }

  try {
    const serialized = JSON.stringify(normalized, null, 2);
    return serialized ?? String(normalized);
  } catch {
    return String(normalized);
  }
}
