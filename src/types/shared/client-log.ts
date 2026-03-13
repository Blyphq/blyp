export type ClientLogLevel =
  | 'debug'
  | 'info'
  | 'warning'
  | 'error'
  | 'critical'
  | 'success'
  | 'table';

export interface ClientLogPageContext {
  url?: string;
  pathname?: string;
  search?: string;
  hash?: string;
  title?: string;
  referrer?: string;
}

export interface ClientLogBrowserContext {
  userAgent?: string;
  language?: string;
  platform?: string;
}

export interface ClientLogDeviceContext {
  runtime?: 'expo' | 'browser';
  network?: {
    type?: string;
    isConnected?: boolean;
    isInternetReachable?: boolean;
  };
}

export interface ClientLogSessionContext {
  pageId: string;
  sessionId: string;
}

export type ClientConnectorRequest =
  | 'betterstack'
  | 'posthog'
  | 'sentry'
  | { type: 'otlp'; name: string };

export interface ClientLogEvent {
  type: 'client_log';
  source: 'client';
  id: string;
  level: ClientLogLevel;
  message: string;
  connector?: ClientConnectorRequest;
  data?: unknown;
  bindings?: Record<string, unknown>;
  clientTimestamp: string;
  page: ClientLogPageContext;
  browser: ClientLogBrowserContext;
  device?: ClientLogDeviceContext;
  session: ClientLogSessionContext;
  metadata?: Record<string, unknown>;
}

export type RemoteDeliveryRuntime = 'browser' | 'expo';

export type RemoteDeliveryTransport = 'fetch' | 'beacon';

export type RemoteDeliveryFailureReason =
  | 'offline'
  | 'network_error'
  | 'response_status'
  | 'invalid_endpoint'
  | 'missing_transport'
  | 'queue_overflow';

export interface RemoteDeliverySuccessContext {
  runtime: RemoteDeliveryRuntime;
  event: ClientLogEvent;
  attempt: number;
  status?: number;
  transport: RemoteDeliveryTransport;
}

export interface RemoteDeliveryRetryContext {
  runtime: RemoteDeliveryRuntime;
  event: ClientLogEvent;
  attempt: number;
  retriesRemaining: number;
  nextRetryAt: string;
  reason: 'offline' | 'network_error' | 'response_status';
  status?: number;
  error?: string;
}

export interface RemoteDeliveryFailureContext {
  runtime: RemoteDeliveryRuntime;
  event: ClientLogEvent;
  attempt: number;
  reason: RemoteDeliveryFailureReason;
  status?: number;
  error?: string;
}

export interface RemoteDeliveryDropContext {
  runtime: RemoteDeliveryRuntime;
  droppedEvent: ClientLogEvent;
  replacementEvent: ClientLogEvent;
  maxQueueSize: number;
  reason: 'queue_overflow';
}

export interface RemoteDeliveryConfig {
  maxRetries?: number;
  retryDelayMs?: number;
  maxQueueSize?: number;
  warnOnFailure?: boolean;
  onSuccess?: (ctx: RemoteDeliverySuccessContext) => void;
  onRetry?: (ctx: RemoteDeliveryRetryContext) => void;
  onFailure?: (ctx: RemoteDeliveryFailureContext) => void;
  onDrop?: (ctx: RemoteDeliveryDropContext) => void;
}
