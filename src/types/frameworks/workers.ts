import type { HttpRequestLog } from './http';
import type { StructuredLog } from '../core/structured-log';

export interface WorkersLoggerConfig {
  env?: Record<string, unknown>;
  customProps?: (request: Request) => Record<string, unknown>;
}

export interface WorkersLoggerState {
  env?: Record<string, unknown>;
  customProps?: (request: Request) => Record<string, unknown>;
}

export type WorkersConsoleMethod = 'debug' | 'info' | 'warn' | 'error' | 'log';

export type WorkersLogLevel =
  | 'debug'
  | 'info'
  | 'warn'
  | 'warning'
  | 'error'
  | 'success'
  | 'critical';

export interface WorkersEmitOptions {
  response?: Response | { status: number };
  status?: number;
  error?: unknown;
}

export interface WorkersRequestLogger {
  set(fields: Record<string, unknown>): WorkersRequestLogger;
  emit(options?: WorkersEmitOptions): HttpRequestLog;
  debug(message: unknown, ...args: unknown[]): void;
  info(message: unknown, ...args: unknown[]): void;
  warn(message: unknown, ...args: unknown[]): void;
  warning(message: unknown, ...args: unknown[]): void;
  error(message: unknown, ...args: unknown[]): void;
  success(message: unknown, ...args: unknown[]): void;
  critical(message: unknown, ...args: unknown[]): void;
  table(message: string, data?: unknown): void;
  createStructuredLog(
    groupId: string,
    initial?: Record<string, unknown>
  ): StructuredLog;
}

export type { HttpRequestLog, StructuredLog };
