import type { Scope } from '@sentry/node';
import type {
  BlypConfig,
  BlypConnectorsConfig,
  ResolvedSentryConnectorConfig,
  SentryConnectorConfig,
} from '../core/config';
import type { LogRecord } from '../core/file-logger';
import type { BlypLogger } from '../core/logger';
import type { ConnectorMode } from './mode';

export interface SentryLoggerConfig {
  connectors?: BlypConnectorsConfig;
}

export interface SentryLogger extends BlypLogger {}

export type SentryLogSource = 'server' | 'client';

export interface SentrySendOptions {
  source?: SentryLogSource;
  warnIfUnavailable?: boolean;
}

export interface SentryClientLike {
  getOptions?: () => {
    dsn?: unknown;
    environment?: unknown;
    release?: unknown;
  };
}

export interface SentryModuleLike {
  init: (options: Record<string, unknown>) => unknown;
  getClient: () => SentryClientLike | undefined;
  captureException: (error: unknown) => unknown;
  flush: (timeout?: number) => PromiseLike<boolean>;
  withScope: (callback: (scope: Scope) => void) => void;
  logger: {
    debug: (message: string, attributes?: Record<string, unknown>) => void;
    info: (message: string, attributes?: Record<string, unknown>) => void;
    warn: (message: string, attributes?: Record<string, unknown>) => void;
    error: (message: string, attributes?: Record<string, unknown>) => void;
    fatal: (message: string, attributes?: Record<string, unknown>) => void;
  };
}

export interface SentryTestHooks {
  module?: SentryModuleLike;
}

export interface SentrySender {
  readonly enabled: boolean;
  readonly ready: boolean;
  readonly mode: ConnectorMode;
  readonly status: 'enabled' | 'missing';
  shouldAutoForwardServerLogs: () => boolean;
  send: (record: LogRecord, options?: SentrySendOptions) => void;
  flush: () => Promise<void>;
}
