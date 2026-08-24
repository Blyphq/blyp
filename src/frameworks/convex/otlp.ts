import { createWarnOnceLogger } from '../../shared/once';
import type {
  ConvexLogLevel,
  ConvexOtlpTransportResult,
  ResolvedConvexOtlpConfig,
} from '../../types/frameworks/convex';

const warnedKeys = new Set<string>();
const warnOnce = createWarnOnceLogger(warnedKeys);

const MAX_ATTRIBUTE_CHARS = 8_192;

export interface ConvexOtlpRecord {
  timestamp: string;
  level: ConvexLogLevel;
  message: string;
  serviceName: string;
  attributes: Record<string, unknown>;
}

function severityForLevel(level: ConvexLogLevel): { text: string; number: number } {
  switch (level) {
    case 'debug':
      return { text: 'DEBUG', number: 5 };
    case 'warning':
    case 'warn':
      return { text: 'WARN', number: 13 };
    case 'error':
      return { text: 'ERROR', number: 17 };
    case 'critical':
      return { text: 'FATAL', number: 21 };
    case 'success':
    case 'table':
    case 'info':
    default:
      return { text: 'INFO', number: 9 };
  }
}

function timestampToUnixNano(timestamp: string): string {
  const millis = Date.parse(timestamp);
  const resolved = Number.isFinite(millis) ? millis : Date.now();
  return `${BigInt(resolved) * 1_000_000n}`;
}

function asStringAttribute(value: unknown): string {
  if (typeof value === 'string') {
    return value.length > MAX_ATTRIBUTE_CHARS
      ? `${value.slice(0, MAX_ATTRIBUTE_CHARS)}…`
      : value;
  }

  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized === 'string') {
      return serialized.length > MAX_ATTRIBUTE_CHARS
        ? `${serialized.slice(0, MAX_ATTRIBUTE_CHARS)}…`
        : serialized;
    }
  } catch {}

  return String(value);
}

function otlpAttributes(attributes: Record<string, unknown>): Array<{
  key: string;
  value: { stringValue: string };
}> {
  return Object.entries(attributes).flatMap(([key, value]) => {
    if (value === undefined) {
      return [];
    }

    return [{
      key,
      value: { stringValue: asStringAttribute(value) },
    }];
  });
}

export function buildOtlpLogsBody(
  record: ConvexOtlpRecord,
  config: ResolvedConvexOtlpConfig
): string {
  const severity = severityForLevel(record.level);

  return JSON.stringify({
    resourceLogs: [
      {
        resource: {
          attributes: [
            {
              key: 'service.name',
              value: { stringValue: config.serviceName },
            },
          ],
        },
        scopeLogs: [
          {
            scope: {
              name: 'blyp.convex',
            },
            logRecords: [
              {
                timeUnixNano: timestampToUnixNano(record.timestamp),
                severityNumber: severity.number,
                severityText: severity.text,
                body: {
                  stringValue: record.message,
                },
                attributes: otlpAttributes({
                  'blyp.level': record.level,
                  'blyp.source': 'convex',
                  ...record.attributes,
                }),
              },
            ],
          },
        ],
      },
    ],
  });
}

export async function sendOtlpLog(
  record: ConvexOtlpRecord,
  config: ResolvedConvexOtlpConfig,
  transport?: (body: string, endpoint: string) => Promise<ConvexOtlpTransportResult>
): Promise<void> {
  if (!config.enabled || !config.endpoint) {
    return;
  }

  const body = buildOtlpLogsBody(record, config);

  try {
    const result = transport
      ? await transport(body, config.endpoint)
      : await postOtlp(config, body);

    if (!result.ok) {
      warnOnce(
        `otlp:${config.endpoint}`,
        `[Blyp] Convex OTLP export failed${result.status ? ` (${result.status})` : ''}.`,
        result.error
      );
    }
  } catch (error) {
    warnOnce(
      `otlp:${config.endpoint}`,
      '[Blyp] Convex OTLP export failed.',
      error
    );
  }
}

async function postOtlp(
  config: ResolvedConvexOtlpConfig,
  body: string
): Promise<ConvexOtlpTransportResult> {
  if (typeof fetch !== 'function' || !config.endpoint) {
    return {
      ok: false,
      error: 'fetch is not available',
    };
  }

  const response = await fetch(config.endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...config.headers,
    },
    body,
  });

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: `HTTP ${response.status}`,
    };
  }

  return {
    ok: true,
    status: response.status,
  };
}

export function resetConvexOtlpWarningsForTests(): void {
  warnedKeys.clear();
}