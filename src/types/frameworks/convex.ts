import type { RedactionConfig, ResolvedRedactionConfig } from '../core/config';
import type { StructuredLog } from '../core/structured-log';

export type ConvexFunctionKind = 'query' | 'mutation' | 'action' | 'unknown';

export type ConvexLogLevel =
  | 'debug'
  | 'info'
  | 'warn'
  | 'warning'
  | 'error'
  | 'success'
  | 'critical'
  | 'table';

export type ConvexConsoleMethod = 'debug' | 'info' | 'warn' | 'error' | 'log';

export interface ConvexOtlpConfig {
  endpoint?: string;
  headers?: Record<string, string>;
  auth?: string;
  serviceName?: string;
}

export interface ConvexOtlpTransportResult {
  ok: boolean;
  status?: number;
  error?: string;
}

export interface ConvexLoggerConfig {
  serviceName?: string;
  function?: string;
  otlp?: ConvexOtlpConfig | false;
  redact?: RedactionConfig;
  transport?: (body: string, endpoint: string) => Promise<ConvexOtlpTransportResult>;
}

export interface ResolvedConvexOtlpConfig {
  enabled: boolean;
  endpoint?: string;
  headers: Record<string, string>;
  serviceName: string;
}

export interface ConvexRuntimeStore {
  ctx: unknown;
  kind: ConvexFunctionKind;
}

export interface ConvexLogger {
  debug: (message: unknown, ...args: unknown[]) => void;
  info: (message: unknown, ...args: unknown[]) => void;
  warn: (message: unknown, ...args: unknown[]) => void;
  warning: (message: unknown, ...args: unknown[]) => void;
  error: (message: unknown, ...args: unknown[]) => void;
  success: (message: unknown, ...args: unknown[]) => void;
  critical: (message: unknown, ...args: unknown[]) => void;
  table: (message: string, data?: unknown) => void;
  child: (bindings: Record<string, unknown>) => ConvexLogger;
  bind: (ctx: unknown) => ConvexLogger;
  wrap: <TCtx, TArgs extends unknown[], TResult>(
    handler: (ctx: TCtx, ...args: TArgs) => TResult | Promise<TResult>
  ) => (ctx: TCtx, ...args: TArgs) => Promise<Awaited<TResult>>;
  flush: () => Promise<void>;
  shutdown: () => Promise<void>;
  createStructuredLog: (
    groupId: string,
    initial?: Record<string, unknown>
  ) => StructuredLog;
}

export interface ConvexLoggerInternals {
  config: ConvexLoggerConfig;
  bindings: Record<string, unknown>;
  boundCtx?: unknown;
  redact: ResolvedRedactionConfig;
  otlp: ResolvedConvexOtlpConfig;
}