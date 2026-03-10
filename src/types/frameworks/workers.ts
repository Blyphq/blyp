import type { HttpRequestLog } from './http';

export interface WorkersLoggerConfig {
  env?: Record<string, unknown>;
  customProps?: (request: Request) => Record<string, unknown>;
}

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
}

export type { HttpRequestLog };
