import type { SeverityNumber } from '@opentelemetry/api-logs';
import type {
  BlypConnectorsConfig,
  ResolvedPostHogConnectorConfig,
} from '../../core/config';
import type { LogRecord } from '../../core/file-logger';
import type { BlypLogger } from '../../core/logger';
import type { ConnectorMode } from './mode';

export interface PostHogLoggerConfig {
  connectors?: BlypConnectorsConfig;
}

export interface PostHogLogger extends BlypLogger {}

export interface PostHogExceptionCaptureOptions {
  distinctId?: string;
  properties?: Record<string, unknown>;
}

export interface PostHogErrorTracker {
  capture: (error: unknown, options?: PostHogExceptionCaptureOptions) => void;
  child: (bindings: Record<string, unknown>) => PostHogErrorTracker;
}

export type PostHogSource = 'server' | 'client';

export interface PostHogLogTransport {
  emit: (payload: PostHogNormalizedRecord) => void | Promise<void>;
  flush?: () => Promise<void>;
  shutdown?: () => Promise<void>;
}

export interface PostHogExceptionClient {
  captureException: (
    error: unknown,
    distinctId?: string,
    additionalProperties?: Record<string | number, unknown>
  ) => void | Promise<void>;
  shutdown?: () => Promise<void>;
}

export interface PostHogSendOptions {
  source?: PostHogSource;
  warnIfUnavailable?: boolean;
}

export interface PostHogCaptureExceptionOptions {
  source?: PostHogSource;
  warnIfUnavailable?: boolean;
  distinctId?: string;
  properties?: Record<string, unknown>;
}

export interface PostHogNormalizedRecord {
  body: string;
  severityText: string;
  severityNumber: SeverityNumber;
  attributes: Record<string, unknown>;
  resourceAttributes: {
    'service.name': string;
  };
}

export interface PostHogSender {
  readonly enabled: boolean;
  readonly ready: boolean;
  readonly mode: ConnectorMode;
  readonly serviceName: string;
  readonly host: string;
  readonly status: 'enabled' | 'missing';
  readonly errorTracking: {
    enabled: boolean;
    ready: boolean;
    mode: ConnectorMode;
    status: 'enabled' | 'missing';
    enableExceptionAutocapture: boolean;
  };
  shouldAutoForwardServerLogs: () => boolean;
  shouldAutoCaptureExceptions: () => boolean;
  send: (record: LogRecord, options?: PostHogSendOptions) => void;
  captureException: (
    error: unknown,
    options?: PostHogCaptureExceptionOptions
  ) => void;
  flush: () => Promise<void>;
}

export interface PostHogTestHooks {
  createTransport?: (
    config: ResolvedPostHogConnectorConfig
  ) => PostHogLogTransport;
  createExceptionClient?: (
    config: ResolvedPostHogConnectorConfig
  ) => PostHogExceptionClient;
}

export interface NormalizedPostHogException {
  error: Error;
  properties: Record<string, unknown>;
}
