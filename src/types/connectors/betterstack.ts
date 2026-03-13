import type {
  BlypConnectorsConfig,
  ResolvedBetterStackConnectorConfig,
} from '../core/config';
import type { LogRecord } from '../core/file-logger';
import type { BlypLogger } from '../core/logger';
import type { ConnectorMode } from './mode';

export interface BetterStackLoggerConfig {
  connectors?: BlypConnectorsConfig;
}

export interface BetterStackLogger extends BlypLogger {}

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
}

export interface BetterStackSender {
  readonly enabled: boolean;
  readonly ready: boolean;
  readonly mode: ConnectorMode;
  readonly serviceName: string;
  readonly ingestingHost?: string;
  readonly status: 'enabled' | 'missing';
  shouldAutoForwardServerLogs: () => boolean;
  send: (record: LogRecord, options?: BetterStackSendOptions) => void;
  flush: () => Promise<void>;
}
