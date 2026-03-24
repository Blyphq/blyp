import type {
  BlypConnectorsConfig,
  ResolvedDatabuddyConnectorConfig,
} from '../core/config';
import type { LogRecord } from '../core/file-logger';
import type { BlypLogger } from '../core/logger';
import type { ConnectorMode } from './mode';

export interface DatabuddyLoggerConfig {
  connectors?: BlypConnectorsConfig;
}

export interface DatabuddyLogger extends BlypLogger {}

export interface DatabuddyExceptionCaptureOptions {
  properties?: Record<string, unknown>;
}

export interface DatabuddyErrorTracker {
  capture: (error: unknown, options?: DatabuddyExceptionCaptureOptions) => void;
  child: (bindings: Record<string, unknown>) => DatabuddyErrorTracker;
}

export type DatabuddySource = 'server' | 'client';

export interface DatabuddyTrackEvent {
  name: string;
  properties?: Record<string, unknown>;
  anonymousId?: string;
  sessionId?: string;
}

export interface DatabuddyClientLike {
  track: (event: DatabuddyTrackEvent) => unknown | Promise<unknown>;
  flush: () => Promise<unknown>;
}

export interface DatabuddySendOptions {
  source?: DatabuddySource;
  warnIfUnavailable?: boolean;
}

export interface DatabuddyCaptureExceptionOptions {
  source?: DatabuddySource;
  warnIfUnavailable?: boolean;
  properties?: Record<string, unknown>;
  anonymousId?: string;
  sessionId?: string;
}

export interface DatabuddySender {
  readonly enabled: boolean;
  readonly ready: boolean;
  readonly mode: ConnectorMode;
  readonly status: 'enabled' | 'missing';
  shouldAutoForwardServerLogs: () => boolean;
  shouldAutoCaptureExceptions: () => boolean;
  send: (record: LogRecord, options?: DatabuddySendOptions) => void;
  captureException: (
    error: unknown,
    options?: DatabuddyCaptureExceptionOptions
  ) => void;
  flush: () => Promise<void>;
}

export interface DatabuddyTestHooks {
  createClient?: (
    config: ResolvedDatabuddyConnectorConfig
  ) => DatabuddyClientLike;
}
