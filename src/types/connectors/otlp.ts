import type { SeverityNumber } from '@opentelemetry/api-logs';
import type {
  BlypConnectorsConfig,
  ResolvedOTLPConnectorConfig,
} from '../../core/config';
import type { LogRecord } from '../../core/file-logger';
import type { BlypLogger } from '../../core/logger';
import type { ConnectorMode } from './mode';

export interface OTLPLoggerConfig {
  name: string;
  connectors?: BlypConnectorsConfig;
}

export interface OTLPLogger extends BlypLogger {}

export type OTLPLogSource = 'server' | 'client';

export interface OTLPTransport {
  emit: (payload: OTLPNormalizedRecord) => void | Promise<void>;
  flush?: () => Promise<void>;
  shutdown?: () => Promise<void>;
}

export interface OTLPSendOptions {
  source?: OTLPLogSource;
  warnIfUnavailable?: boolean;
}

export interface OTLPNormalizedRecord {
  body: string;
  severityText: string;
  severityNumber: SeverityNumber;
  attributes: Record<string, unknown>;
  resourceAttributes: {
    'service.name': string;
  };
}

export interface OTLPSender {
  readonly name: string;
  readonly enabled: boolean;
  readonly ready: boolean;
  readonly mode: ConnectorMode;
  readonly serviceName: string;
  readonly endpoint?: string;
  readonly status: 'enabled' | 'missing';
  send: (record: LogRecord, options?: OTLPSendOptions) => void;
  flush: () => Promise<void>;
}

export interface OTLPRegistry {
  get: (name: string) => OTLPSender;
  getAutoForwardTargets: () => OTLPSender[];
  send: (name: string, record: LogRecord, options?: OTLPSendOptions) => void;
  flush: () => Promise<void>;
}

export interface OTLPTestHooks {
  createTransport?: (
    config: ResolvedOTLPConnectorConfig
  ) => OTLPTransport;
}
