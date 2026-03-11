import type { LogRecord } from './file-logger';
import type { StructuredLogPayload } from './structured-log';
import {
  normalizeError,
  normalizeLogValue,
  serializeLogMessage,
} from '../shared/log-value';

export type LogMethodName =
  | 'success'
  | 'critical'
  | 'warning'
  | 'info'
  | 'debug'
  | 'error'
  | 'warn'
  | 'table';

const RECORD_LEVELS: Record<LogMethodName, string> = {
  success: 'success',
  critical: 'critical',
  warning: 'warning',
  info: 'info',
  debug: 'debug',
  error: 'error',
  warn: 'warning',
  table: 'table',
};

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function isInternalLoggerFrame(filePath: string): boolean {
  const normalizedPath = normalizePath(filePath);

  return (
    normalizedPath.startsWith('node:') ||
    normalizedPath.includes('/node_modules/pino') ||
    normalizedPath.includes('/node_modules/pino-pretty') ||
    normalizedPath.includes('/node_modules/blyp-js/') ||
    normalizedPath.includes('/blyp/src/core/') ||
    normalizedPath.includes('/blyp/src/frameworks/') ||
    normalizedPath.includes('/blyp/src/posthog/') ||
    normalizedPath.includes('/blyp/dist/')
  );
}

function formatCallerPath(filePath: string): string {
  const normalizedPath = normalizePath(filePath);
  const normalizedCwd = normalizePath(process.cwd());
  return normalizedPath.startsWith(`${normalizedCwd}/`)
    ? normalizedPath.slice(normalizedCwd.length + 1)
    : normalizedPath;
}

export function getCallerLocation(): { file: string | null; line: number | null } {
  try {
    const stack = new Error().stack;
    if (!stack) {
      return { file: null, line: null };
    }

    const lines = stack.split('\n');
    let fallback: { file: string; line: number | null } | null = null;

    for (let index = 2; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line) {
        continue;
      }

      const match = line.match(/\((.*):(\d+):\d+\)/) || line.match(/at\s+(.*):(\d+):(\d+)/);
      if (!match) {
        continue;
      }

      const fileName = match[1] || '';
      const lineNumber = parseInt(match[2] || '0', 10) || null;

      if (fileName && !fileName.includes('node_modules') && !isInternalLoggerFrame(fileName)) {
        const formattedPath = formatCallerPath(fileName);
        const normalizedFormattedPath = normalizePath(formattedPath);

        if (!normalizedFormattedPath.startsWith('dist/')) {
          return { file: formattedPath, line: lineNumber };
        }

        fallback ??= { file: formattedPath, line: lineNumber };
      }
    }

    if (fallback) {
      return fallback;
    }
  } catch {
    return { file: null, line: null };
  }

  return { file: null, line: null };
}

export const serializeMessage = serializeLogMessage;

export function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, '');
}

export function buildRecord(
  level: LogMethodName,
  message: unknown,
  args: unknown[],
  bindings: Record<string, unknown>
): LogRecord {
  const { file, line } = getCallerLocation();
  const serializedMessage = serializeMessage(message);
  const record: LogRecord = {
    timestamp: new Date().toISOString(),
    level: RECORD_LEVELS[level],
    message: stripAnsi(serializedMessage),
  };

  if (message instanceof Error) {
    record.error = normalizeError(message);
  }

  if (file) {
    record.caller = line !== null ? `${file}:${line}` : file;
  }

  if (args.length === 1) {
    record.data = normalizeLogValue(args[0]);
  } else if (args.length > 1) {
    record.data = normalizeLogValue(args);
  }

  if (Object.keys(bindings).length > 0) {
    record.bindings = normalizeLogValue(bindings) as Record<string, unknown>;
  }

  return record;
}

export function buildStructuredRecord(
  level: LogMethodName,
  message: string,
  payload: StructuredLogPayload,
  bindings: Record<string, unknown>
): LogRecord {
  const { file, line } = getCallerLocation();
  const normalizedPayload = normalizeLogValue(payload) as StructuredLogPayload;
  const record: LogRecord = {
    message: stripAnsi(message),
    ...normalizedPayload,
  };

  if (file) {
    record.caller = line !== null ? `${file}:${line}` : file;
  }

  if (Object.keys(bindings).length > 0) {
    record.bindings = normalizeLogValue(bindings) as Record<string, unknown>;
  }

  record.level =
    typeof normalizedPayload.level === 'string' && normalizedPayload.level.length > 0
      ? normalizedPayload.level
      : RECORD_LEVELS[level];
  record.timestamp =
    typeof normalizedPayload.timestamp === 'string' && normalizedPayload.timestamp.length > 0
      ? normalizedPayload.timestamp
      : new Date().toISOString();

  return record;
}

export function resolveStructuredWriteLevel(level: StructuredLogPayload['level']): LogMethodName {
  switch (level) {
    case 'debug':
      return 'debug';
    case 'warning':
      return 'warning';
    case 'warn':
      return 'warn';
    case 'error':
      return 'error';
    case 'success':
      return 'success';
    case 'critical':
      return 'critical';
    case 'table':
      return 'table';
    case 'info':
    default:
      return 'info';
  }
}
