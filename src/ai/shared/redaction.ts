const encoder = new TextEncoder();

function byteLength(value: string): number {
  return encoder.encode(value).length;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function toLoggableValue(
  value: unknown,
  seen = new WeakSet<object>()
): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'symbol') {
    return value.toString();
  }

  if (typeof value === 'function') {
    return `[Function: ${value.name || 'anonymous'}]`;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => toLoggableValue(item, seen));
  }

  if (typeof value === 'object') {
    if (seen.has(value as object)) {
      return '[Circular]';
    }

    seen.add(value as object);

    if (!isPlainObject(value)) {
      const tag = (value as { constructor?: { name?: string } }).constructor?.name;
      return tag ? `[${tag}]` : '[Object]';
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [
        key,
        toLoggableValue(entryValue, seen),
      ])
    );
  }

  return String(value);
}

export function omitPaths(
  value: Record<string, unknown>,
  paths: string[]
): Record<string, unknown> {
  if (paths.length === 0) {
    return value;
  }

  const clone = toLoggableValue(value) as Record<string, unknown>;

  for (const path of paths) {
    const segments = path.split('.').filter(Boolean);
    if (segments.length === 0) {
      continue;
    }

    let cursor: unknown = clone;
    for (let index = 0; index < segments.length - 1; index += 1) {
      if (!cursor || typeof cursor !== 'object') {
        cursor = undefined;
        break;
      }

      cursor = (cursor as Record<string, unknown>)[segments[index] as string];
    }

    if (cursor && typeof cursor === 'object') {
      delete (cursor as Record<string, unknown>)[segments[segments.length - 1] as string];
    }
  }

  return clone;
}

export function truncateValue(
  value: unknown,
  maxBytes: number
): { value: unknown; truncated: boolean } {
  const loggable = toLoggableValue(value);

  if (maxBytes <= 0) {
    return { value: '[Truncated]', truncated: true };
  }

  if (typeof loggable === 'string') {
    if (byteLength(loggable) <= maxBytes) {
      return { value: loggable, truncated: false };
    }

    let truncated = loggable;
    while (truncated.length > 0 && byteLength(`${truncated}…[truncated]`) > maxBytes) {
      truncated = truncated.slice(0, Math.max(1, Math.floor(truncated.length * 0.8)));
    }

    return {
      value: `${truncated}…[truncated]`,
      truncated: true,
    };
  }

  const serialized = JSON.stringify(loggable);
  if (serialized === undefined || byteLength(serialized) <= maxBytes) {
    return { value: loggable, truncated: false };
  }

  let preview = serialized;
  while (preview.length > 0 && byteLength(`${preview}…[truncated]`) > maxBytes) {
    preview = preview.slice(0, Math.max(1, Math.floor(preview.length * 0.8)));
  }

  return {
    value: {
      truncated: true,
      preview: `${preview}…[truncated]`,
    },
    truncated: true,
  };
}
