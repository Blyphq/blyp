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

export declare function initWorkersLogger(config?: WorkersLoggerConfig): void;
export declare function createWorkersLogger(request: Request): WorkersRequestLogger;
