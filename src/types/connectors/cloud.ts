import type { CloudDestinationConfig } from '../core/config';
import type { LogRecord } from '../core/file-logger';
import type { ConnectorMode } from './mode';

export interface CloudGitMeta {
  provider: 'github' | 'gitlab';
  repositoryFullName: string;
  branch: string;
  commitSha?: string;
}

export interface CloudIngestEvent {
  level: 'debug' | 'info' | 'warn' | 'error' | 'critical';
  message: string;
  timestamp: string;
  traceId?: string;
  fields: Record<string, unknown>;
  stack?: string;
  source?: {
    file: string;
    line: number;
    function?: string;
  };
}

export interface CloudIngestBatch {
  events: CloudIngestEvent[];
  meta: {
    sdk: string;
    sdkVersion: string;
    runtime: string;
    framework?: string;
    git: CloudGitMeta;
  };
}

export interface CloudDispatchResult {
  ok: boolean;
  retryable?: boolean;
  status?: number;
  error?: string;
}

export interface CloudTransport {
  sendBatch: (
    endpoint: string,
    batch: CloudIngestBatch,
    headers: Record<string, string>
  ) => Promise<CloudDispatchResult>;
}

export interface CloudSender {
  readonly enabled: boolean;
  readonly ready: boolean;
  readonly mode: ConnectorMode;
  readonly status: 'enabled' | 'missing';
  readonly config: CloudDestinationConfig;
  send: (record: LogRecord, options?: { warnIfUnavailable?: boolean }) => void;
  flush: () => Promise<void>;
}

export interface CloudTestHooks {
  createTransport?: () => CloudTransport;
  sdkVersion?: string;
}
