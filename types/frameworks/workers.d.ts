export interface HttpRequestLog {
  type: 'http_request' | 'http_error';
  method: string;
  url: string;
  path: string;
  statusCode: number;
  responseTime: number;
  timestamp: string;
  ip?: string;
  userAgent?: string;
  referrer?: string;
  requestId?: string;
  error?: string;
  stack?: string;
  code?: string;
  why?: string;
  fix?: string;
  link?: string;
  details?: unknown;
  [key: string]: unknown;
}

export interface WorkersLoggerConfig {
  env?: Record<string, unknown>;
  customProps?: (request: Request) => Record<string, unknown>;
}

export interface WorkersEmitOptions {
  response?: Response | { status: number };
  status?: number;
  error?: unknown;
}

export type StructuredLogLevel =
  | 'debug'
  | 'info'
  | 'warn'
  | 'warning'
  | 'error'
  | 'success'
  | 'critical'
  | 'table';

export interface StructuredLogError {
  message: string;
  code?: string | number;
  type?: string;
  stack?: string;
  why?: string;
  fix?: string;
  link?: string;
  details?: Record<string, unknown>;
  cause?: unknown;
}

export interface StructuredLogEvent {
  level: StructuredLogLevel;
  message: string;
  timestamp: string;
  data?: unknown;
}

export interface StructuredLogPayload {
  groupId: string;
  timestamp: string;
  level: StructuredLogLevel;
  method?: string;
  path?: string;
  status?: number;
  duration?: number;
  events?: StructuredLogEvent[];
  error?: StructuredLogError;
  [key: string]: unknown;
}

export interface StructuredLogEmitOptions {
  response?: Response | { status: number };
  status?: number;
  error?: unknown;
  level?: StructuredLogLevel;
  message?: string;
}

export interface StructuredLog {
  set(fields: Record<string, unknown>): StructuredLog;
  debug(message: unknown, ...args: unknown[]): StructuredLog;
  info(message: unknown, ...args: unknown[]): StructuredLog;
  warn(message: unknown, ...args: unknown[]): StructuredLog;
  warning(message: unknown, ...args: unknown[]): StructuredLog;
  error(message: unknown, ...args: unknown[]): StructuredLog;
  success(message: unknown, ...args: unknown[]): StructuredLog;
  critical(message: unknown, ...args: unknown[]): StructuredLog;
  table(message: string, data?: unknown): StructuredLog;
  emit(options?: StructuredLogEmitOptions): StructuredLogPayload;
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

export declare function initWorkersLogger(config?: WorkersLoggerConfig): void;
export declare function createWorkersLogger(request: Request): WorkersRequestLogger;
