import type {
  BlypConnectorsConfig,
  ResolvedHTTPConnectorConfig,
} from '../core/config';
import type { LogRecord } from '../core/file-logger';
import type { BlypLogger } from '../core/logger';
import type { ConnectorMode } from './mode';

export interface HTTPLoggerConfig {
  name: string;
  connectors?: BlypConnectorsConfig;
}

export interface HTTPLogger extends BlypLogger {}

export type HTTPLogSource = 'server' | 'client';

export interface HTTPMetadata {
  type?: string;
  caller?: string;
  groupId?: string;
  traceId?: string;
  http?: {
    method?: string;
    path?: string;
    statusCode?: number;
    durationMs?: number;
  };
  client?: {
    pagePath?: string;
    pageUrl?: string;
    sessionId?: string;
    pageId?: string;
  };
}

export interface HTTPNormalizedRecord {
  timestamp: string;
  level: string;
  message: string;
  source: HTTPLogSource;
  serviceName: string;
  target: string;
  metadata?: HTTPMetadata;
  payload: LogRecord;
}

export interface HTTPTransportResult {
  ok: boolean;
  retryable?: boolean;
  status?: number;
  error?: string;
}

export interface HTTPTransport {
  emit: (
    payload: HTTPNormalizedRecord
  ) => HTTPTransportResult | Promise<HTTPTransportResult>;
  flush?: () => Promise<void>;
  shutdown?: () => Promise<void>;
}

export interface HTTPSendOptions {
  source?: HTTPLogSource;
  warnIfUnavailable?: boolean;
}

export interface HTTPSender {
  readonly name: string;
  readonly enabled: boolean;
  readonly ready: boolean;
  readonly mode: ConnectorMode;
  readonly serviceName: string;
  readonly endpoint?: string;
  readonly status: 'enabled' | 'missing';
  send: (record: LogRecord, options?: HTTPSendOptions) => void;
  flush: () => Promise<void>;
}

export interface HTTPRegistry {
  get: (name: string) => HTTPSender;
  getAutoForwardTargets: () => HTTPSender[];
  send: (name: string, record: LogRecord, options?: HTTPSendOptions) => void;
  flush: () => Promise<void>;
}

export interface HTTPTestHooks {
  createTransport?: (
    config: ResolvedHTTPConnectorConfig
  ) => HTTPTransport;
}
