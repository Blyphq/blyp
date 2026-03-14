import type {
  BlypConnectorsConfig,
  ResolvedBetterStackConnectorConfig,
} from '../core/config';
import type { LogRecord } from '../core/file-logger';
import type { BlypLogger } from '../core/logger';
import type { ConnectorMode } from './mode';
import type { SentryModuleLike } from './sentry';

export interface BetterStackLoggerConfig {
  connectors?: BlypConnectorsConfig;
}

export interface BetterStackLogger extends BlypLogger {}

export interface BetterStackExceptionCaptureOptions {
  source?: BetterStackLogSource;
  warnIfUnavailable?: boolean;
  context?: Record<string, unknown>;
}

export interface BetterStackErrorTracker {
  capture: (error: unknown, options?: BetterStackExceptionCaptureOptions) => void;
  child: (bindings: Record<string, unknown>) => BetterStackErrorTracker;
}

export type BetterStackLogSource = 'server' | 'client';

export interface BetterStackSendOptions {
  source?: BetterStackLogSource;
  warnIfUnavailable?: boolean;
}

export interface BetterStackClientLike {
  log: (
    message: string,
    level: string,
    context?: Record<string, unknown>
  ) => Promise<unknown>;
  flush: () => Promise<unknown>;
}

export interface BetterStackTestHooks {
  createClient?: (
    config: ResolvedBetterStackConnectorConfig
  ) => BetterStackClientLike;
  module?: SentryModuleLike;
}

export interface BetterStackSender {
  readonly enabled: boolean;
  readonly ready: boolean;
  readonly mode: ConnectorMode;
  readonly serviceName: string;
  readonly ingestingHost?: string;
  readonly status: 'enabled' | 'missing';
  readonly errorTracking: {
    enabled: boolean;
    ready: boolean;
    status: 'enabled' | 'missing';
    dsn?: string;
    tracesSampleRate: number;
    environment?: string;
    release?: string;
  };
  shouldAutoForwardServerLogs: () => boolean;
  shouldAutoCaptureExceptions: () => boolean;
  send: (record: LogRecord, options?: BetterStackSendOptions) => void;
  captureException: (
    error: unknown,
    options?: BetterStackExceptionCaptureOptions
  ) => void;
  flush: () => Promise<void>;
}
