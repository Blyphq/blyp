import type { BlypConfig, BlypConnectorsConfig, LogFileConfig } from '../../core/config';
import type { BlypLogger } from '../../core/logger';
import type { ClientLogEvent } from '../../shared/client-log';
import type { HttpRequestLog } from './http';

export interface ClientLogIngestionConfig<Ctx> {
  path?: string;
  validate?: (
    ctx: Ctx,
    payload: ClientLogEvent
  ) => boolean | Promise<boolean>;
  enrich?: (
    ctx: Ctx,
    payload: ClientLogEvent
  ) => Record<string, unknown> | Promise<Record<string, unknown>>;
}

export interface ServerLoggerConfig<Ctx> {
  level?: string;
  pretty?: boolean;
  logDir?: string;
  file?: LogFileConfig;
  autoLogging?: boolean | { ignore?: (ctx: Ctx) => boolean };
  customProps?: (ctx: Ctx) => Record<string, unknown>;
  logErrors?: boolean;
  ignorePaths?: string[];
  clientLogging?: boolean | ClientLogIngestionConfig<Ctx>;
  connectors?: BlypConnectorsConfig;
}

export interface ResolvedPostHogConnector {
  enabled: boolean;
  ready: boolean;
  mode: 'auto' | 'manual';
  serviceName: string;
  host: string;
  status: 'enabled' | 'missing';
  errorTracking: {
    enabled: boolean;
    ready: boolean;
    mode: 'auto' | 'manual';
    status: 'enabled' | 'missing';
    enableExceptionAutocapture: boolean;
  };
  shouldAutoCaptureExceptions: () => boolean;
  send: (
    record: {
      timestamp: string;
      level: string;
      message: string;
      [key: string]: unknown;
    },
    options?: {
      source?: 'server' | 'client';
      warnIfUnavailable?: boolean;
    }
  ) => void;
  captureException: (
    error: unknown,
    options?: {
      source?: 'server' | 'client';
      warnIfUnavailable?: boolean;
      distinctId?: string;
      properties?: Record<string, unknown>;
    }
  ) => void;
}

export interface ResolvedSentryConnector {
  enabled: boolean;
  ready: boolean;
  mode: 'auto' | 'manual';
  status: 'enabled' | 'missing';
  send: (
    record: {
      timestamp: string;
      level: string;
      message: string;
      [key: string]: unknown;
    },
    options?: {
      source?: 'server' | 'client';
      warnIfUnavailable?: boolean;
    }
  ) => void;
}

export interface ResolvedOTLPConnector {
  name: string;
  enabled: boolean;
  ready: boolean;
  mode: 'auto' | 'manual';
  serviceName: string;
  endpoint?: string;
  status: 'enabled' | 'missing';
  send: (
    record: {
      timestamp: string;
      level: string;
      message: string;
      [key: string]: unknown;
    },
    options?: {
      source?: 'server' | 'client';
      warnIfUnavailable?: boolean;
    }
  ) => void;
}

export interface ResolvedOTLPRegistry {
  get: (name: string) => ResolvedOTLPConnector;
  getAutoForwardTargets: () => ResolvedOTLPConnector[];
  send: (
    name: string,
    record: {
      timestamp: string;
      level: string;
      message: string;
      [key: string]: unknown;
    },
    options?: {
      source?: 'server' | 'client';
      warnIfUnavailable?: boolean;
    }
  ) => void;
  flush: () => Promise<void>;
}

export interface ResolvedServerLogger<Ctx> {
  logger: BlypLogger;
  posthog: ResolvedPostHogConnector;
  sentry: ResolvedSentryConnector;
  otlp: ResolvedOTLPRegistry;
  resolvedConfig: BlypConfig;
  level: string;
  pretty: boolean;
  logDir?: string;
  file?: LogFileConfig;
  autoLogging: ServerLoggerConfig<Ctx>['autoLogging'];
  customProps?: (ctx: Ctx) => Record<string, unknown>;
  logErrors: boolean;
  resolvedIgnorePaths?: string[];
  resolvedClientLogging: ClientLogIngestionConfig<Ctx> | null;
  ingestionPath: string;
}

export type { HttpRequestLog } from './http';
