import type { LogRecord } from '../../core/file-logger';
import { serializeLogRecord } from '../../core/file-logger';
import type { PostHogSource } from '../../types/connectors/posthog';
import {
  getClientPageField,
  getClientSessionField,
  getField,
  getRecordType,
} from '../shared';

export function buildPostHogRecordAttributes(
  record: LogRecord,
  source: PostHogSource
): Record<string, unknown> {
  const recordType = getRecordType(record);
  const caller = typeof record.caller === 'string' ? record.caller : undefined;
  const groupId = getField<string>(record, 'groupId');
  const traceId = getField<string>(record, 'traceId');
  const method = getField<string>(record, 'method');
  const path = getField<string>(record, 'path');
  const status = getField<number>(record, 'status');
  const duration = getField<number>(record, 'duration');
  const pagePath = getClientPageField(record, 'pathname');
  const pageUrl = getClientPageField(record, 'url');
  const sessionId = getClientSessionField(record, 'sessionId');
  const pageId = getClientSessionField(record, 'pageId');

  const attributes: Record<string, unknown> = {
    'blyp.level': record.level,
    'blyp.source': source,
    'blyp.payload': serializeLogRecord(record),
  };

  const ifTruthy: Array<[string, unknown]> = [
    ['blyp.type', recordType],
    ['blyp.caller', caller],
    ['blyp.group_id', groupId],
    ['blyp.trace_id', traceId],
    ['http.method', method],
    ['url.path', path],
    ['client.page_path', pagePath],
    ['client.page_url', pageUrl],
    ['client.session_id', sessionId],
    ['client.page_id', pageId],
  ];
  const ifDefined: Array<[string, unknown]> = [
    ['http.status_code', status],
    ['blyp.duration_ms', duration],
  ];
  for (const [key, value] of ifTruthy) if (value) attributes[key] = value;
  for (const [key, value] of ifDefined) if (value !== undefined) attributes[key] = value;

  return attributes;
}

export function buildPostHogExceptionProperties(
  record: LogRecord,
  source: PostHogSource,
  properties: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ...buildPostHogRecordAttributes(record, source),
    ...properties,
  };
}
