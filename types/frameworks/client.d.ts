/// <reference lib="dom" />

import type {
  BlypErrorCode,
  BlypErrorCodeDefinition,
  BlypErrorLike,
  ErrorLogLevel,
  ErrorLoggerLike,
  ParseErrorOptions,
  ParseableErrorPayload,
} from '../../dist/index';

export interface ClientLogPageContext {
  hash?: string;
  pathname?: string;
  search?: string;
  url?: string;
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

export type ClientLogLevel =
  | 'debug'
  | 'info'
  | 'warning'
  | 'error'
  | 'critical'
  | 'success'
  | 'table';

export interface ClientLogEvent {
  type: 'client_log';
  source: 'client';
  id: string;
  level: ClientLogLevel;
  message: string;
  data?: unknown;
  bindings?: Record<string, unknown>;
  clientTimestamp: string;
  page?: ClientLogPageContext;
  browser?: ClientLogBrowserContext;
  device?: ClientLogDeviceContext;
  session?: {
    pageId?: string;
    sessionId?: string;
  };
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

export interface ClientLoggerConfig {
  endpoint?: string;
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
  localConsole?: boolean;
  remoteSync?: boolean;
  metadata?: Record<string, unknown> | (() => Record<string, unknown>);
  delivery?: RemoteDeliveryConfig;
}

export interface ClientLogger {
  success: (message: unknown, ...args: unknown[]) => void;
  critical: (message: unknown, ...args: unknown[]) => void;
  warning: (message: unknown, ...args: unknown[]) => void;
  info: (message: unknown, ...args: unknown[]) => void;
  debug: (message: unknown, ...args: unknown[]) => void;
  error: (message: unknown, ...args: unknown[]) => void;
  warn: (message: unknown, ...args: unknown[]) => void;
  table: (message: string, data?: unknown) => void;
  child: (bindings: Record<string, unknown>) => ClientLogger;
}

export declare function createClientLogger(config?: ClientLoggerConfig): ClientLogger;
export declare const logger: ClientLogger;
export type {
  ClientLogDeviceContext,
};

export type {
  BlypErrorCode,
  BlypErrorCodeDefinition,
  BlypErrorLike,
  ErrorLogLevel,
  ErrorLoggerLike,
  ParseErrorOptions,
  ParseableErrorPayload,
};
