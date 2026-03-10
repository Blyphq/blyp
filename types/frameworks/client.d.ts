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

export interface ClientLoggerConfig {
  endpoint?: string;
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
  localConsole?: boolean;
  remoteSync?: boolean;
  metadata?: Record<string, unknown> | (() => Record<string, unknown>);
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
