import type { BlypErrorLike } from '../shared/errors';

type LeveledLogMethod = (message: unknown, ...meta: unknown[]) => void;

interface MinimalLogger {
  child: (bindings: Record<string, unknown>) => MinimalLogger;
}

export type FrameworkName =
  | 'standalone'
  | 'elysia'
  | 'fastify'
  | 'hono'
  | 'express'
  | 'nextjs'
  | 'tanstack-start'
  | 'sveltekit';

export interface BaseLogger extends MinimalLogger {
  success: (message: unknown, meta?: unknown) => void;
  critical: (message: unknown, meta?: unknown) => void;
  table: (message: string, data?: unknown) => void;
  warn: LeveledLogMethod;
  warning: LeveledLogMethod;
}

export interface FrameworkContext {
  request?: {
    method: string;
    url: string;
    headers: Record<string, string | undefined>;
  };
  response?: {
    status?: number;
  };
  path?: string;
  params?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
  error?: BlypErrorLike;
  set?: {
    status?: number | string;
    headers?: Record<string, string>;
  };
  [key: string]: unknown;
}

export interface FrameworkOptions {
  level?: string;
  autoLogging?: boolean | { ignore?: (ctx: FrameworkContext) => boolean };
  customProps?: (ctx: FrameworkContext) => Record<string, unknown>;
  logErrors?: boolean;
  ignorePaths?: string[];
}

export interface FrameworkAdapter {
  name: FrameworkName;
  createLogger: (options?: FrameworkOptions) => BaseLogger;
  createMiddleware: (logger: BaseLogger, options?: FrameworkOptions) => unknown;
}

export interface HttpRequestLog {
  type: 'http_request' | 'http_error';
  method: string;
  url: string;
  statusCode: number;
  responseTime: number;
  ip?: string;
  userAgent?: string;
  error?: string;
  stack?: string;
  [key: string]: unknown;
}

export interface LogFlow {
  id: string;
  startTime: number;
  endTime?: number;
  requests: HttpRequestLog[];
  metadata?: Record<string, unknown>;
}

export interface IpAddressInfo {
  ip: string;
  type: 'ipv4' | 'ipv6';
  isProxy: boolean;
  proxyIp?: string;
}

export interface RequestGroup {
  endpoint: string;
  method: string;
  totalRequests: number;
  successCount: number;
  errorCount: number;
  averageResponseTime: number;
  ips: string[];
  timeRange: {
    start: Date;
    end: Date;
  };
}
