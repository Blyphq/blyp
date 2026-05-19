import type { BetterStackSender } from '../connectors/betterstack';
import type { DatabuddySender } from '../connectors/databuddy';
import type { PostHogSender } from '../connectors/posthog';
import type { SentrySender } from '../connectors/sentry';
import type { HTTPRegistry } from '../connectors/http';
import type { OTLPRegistry } from '../connectors/otlp';
import type { CloudSender } from '../connectors/cloud';
import type { BlypPrimarySink } from '../../core/primary-sink';
import type { StructuredLog, StructuredLogPayload } from './structured-log';
import type { ResolvedRedactionConfig } from './config';

export interface BlypLogger {
  success: (message: unknown, ...args: unknown[]) => void;
  critical: (message: unknown, ...args: unknown[]) => void;
  warning: (message: unknown, ...args: unknown[]) => void;
  info: (message: unknown, ...args: unknown[]) => void;
  debug: (message: unknown, ...args: unknown[]) => void;
  error: (message: unknown, ...args: unknown[]) => void;
  warn: (message: unknown, ...args: unknown[]) => void;
  table: (message: string, data?: unknown) => void;
  flush: () => Promise<void>;
  shutdown: () => Promise<void>;
  createStructuredLog: (
    groupId: string,
    initial?: Record<string, unknown>
  ) => StructuredLog;
  child: (bindings: Record<string, unknown>) => BlypLogger;
}

export type InternalLoggerSource = 'root' | 'request-scoped' | 'structured-flush';

export interface StructuredLogFactoryOptions {
  initialFields?: Record<string, unknown>;
  resolveDefaultFields?: () => Record<string, unknown>;
  onCreate?: () => void;
  onEmit?: (payload: StructuredLogPayload) => void;
  redact?: ResolvedRedactionConfig;
}

export interface LoggerFactoryHandle {
  bindings: Record<string, unknown>;
  betterstack: BetterStackSender;
  databuddy: DatabuddySender;
  posthog: PostHogSender;
  sentry: SentrySender;
  http: HTTPRegistry;
  otlp: OTLPRegistry;
  cloud: CloudSender;
  redact: ResolvedRedactionConfig;
  sink: BlypPrimarySink;
  create: (source: InternalLoggerSource, bindings?: Record<string, unknown>) => BlypLogger;
  writeStructured: (
    payload: StructuredLogPayload,
    message: string,
    source?: InternalLoggerSource
  ) => void;
}

export type InternalBlypLogger = BlypLogger & {
  [k: symbol]: LoggerFactoryHandle;
};
