import type { BetterStackSender } from '../connectors/betterstack';
import type { PostHogSender } from '../connectors/posthog';
import type { SentrySender } from '../connectors/sentry';
import type { OTLPRegistry } from '../connectors/otlp';
import type { StructuredLog, StructuredLogPayload } from './structured-log';

export interface BlypLogger {
  success: (message: unknown, ...args: unknown[]) => void;
  critical: (message: unknown, ...args: unknown[]) => void;
  warning: (message: unknown, ...args: unknown[]) => void;
  info: (message: unknown, ...args: unknown[]) => void;
  debug: (message: unknown, ...args: unknown[]) => void;
  error: (message: unknown, ...args: unknown[]) => void;
  warn: (message: unknown, ...args: unknown[]) => void;
  table: (message: string, data?: unknown) => void;
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
}

export interface LoggerFactoryHandle {
  bindings: Record<string, unknown>;
  betterstack: BetterStackSender;
  posthog: PostHogSender;
  sentry: SentrySender;
  otlp: OTLPRegistry;
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
