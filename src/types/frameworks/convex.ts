import type {
  BlypUserConfig,
  RedactionConfig,
  ResolvedRedactionConfig,
} from '../core/config';
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

export interface ConvexPostHogConfig {
  enabled?: boolean;
  projectKey?: string;
  host?: string;
  serviceName?: string;
}

export interface ConvexAxiomConfig {
  enabled?: boolean;
  token?: string;
  dataset?: string;
  endpoint?: string;
  serviceName?: string;
}

export interface ConvexBetterStackConfig {
  enabled?: boolean;
  sourceToken?: string;
  ingestingHost?: string;
  serviceName?: string;
}

export interface ConvexSentryConfig {
  enabled?: boolean;
  dsn?: string;
  serviceName?: string;
}

export interface ConvexDatabuddyConfig {
  enabled?: boolean;
  apiKey?: string;
  websiteId?: string;
  apiUrl?: string;
  namespace?: string;
  source?: string;
  serviceName?: string;
}

export interface ConvexHttpConfig {
  name: string;
  enabled?: boolean;
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

export interface ConvexLoggerOptions {
  serviceName?: string;
  function?: string;
  otlp?: ConvexOtlpConfig | false;
  posthog?: ConvexPostHogConfig | false;
  axiom?: ConvexAxiomConfig | false;
  betterstack?: ConvexBetterStackConfig | false;
  sentry?: ConvexSentryConfig | false;
  databuddy?: ConvexDatabuddyConfig | false;
  http?: ConvexHttpConfig[] | false;
  redact?: RedactionConfig;
  transport?: (body: string, endpoint: string) => Promise<ConvexOtlpTransportResult>;
}

export type ConvexLoggerConfig = ConvexLoggerOptions & BlypUserConfig;

export type ConvexRemoteFormat = 'otlp' | 'http' | 'databuddy';

export interface ResolvedConvexOtlpTarget {
  name?: string;
  endpoint: string;
  headers: Record<string, string>;
  serviceName: string;
  format?: ConvexRemoteFormat;
  websiteId?: string;
  namespace?: string;
  source?: string;
}

export interface ResolvedConvexOtlpConfig {
  enabled: boolean;
  endpoint?: string;
  headers: Record<string, string>;
  serviceName: string;
  targets?: ResolvedConvexOtlpTarget[];
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