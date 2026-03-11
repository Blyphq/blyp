import type { BlypConfig } from '../core/config';
import type { LogRecord } from '../core/file-logger';
import { isPlainObject } from '../shared/validation';

export function isBlypConfig(config: unknown): config is BlypConfig {
  return isPlainObject(config) && (
    'connectors' in config ||
    'pretty' in config ||
    'level' in config
  );
}

export function getPrimaryPayload(record: LogRecord): Record<string, unknown> {
  return isPlainObject(record.data) ? record.data : record;
}

export function getField<T extends string | number>(
  record: LogRecord,
  key: string
): T | undefined {
  if (key in record) {
    const direct = record[key];
    if (typeof direct === 'string' || typeof direct === 'number') {
      return direct as T;
    }
  }

  const payload = getPrimaryPayload(record);
  const nested = payload[key];
  if (typeof nested === 'string' || typeof nested === 'number') {
    return nested as T;
  }

  return undefined;
}

export function getClientPageField(
  record: LogRecord,
  key: 'pathname' | 'url'
): string | undefined {
  const payload = getPrimaryPayload(record);
  const page = isPlainObject(payload.page) ? payload.page : undefined;
  const value = page?.[key];
  return typeof value === 'string' ? value : undefined;
}

export function getClientSessionField(
  record: LogRecord,
  key: 'sessionId' | 'pageId'
): string | undefined {
  const payload = getPrimaryPayload(record);
  const session = isPlainObject(payload.session) ? payload.session : undefined;
  const value = session?.[key];
  return typeof value === 'string' ? value : undefined;
}

export function getRecordType(record: LogRecord): string | undefined {
  return getField<string>(record, 'type');
}
