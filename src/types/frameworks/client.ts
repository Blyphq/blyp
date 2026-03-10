/// <reference lib="dom" />

import type {
  ClientLogBrowserContext,
  ClientLogEvent,
  ClientLogLevel,
  ClientLogPageContext,
} from '../../shared/client-log';
import type {
  ErrorLogLevel,
  ErrorLoggerLike,
  ParseErrorOptions,
  ParseableErrorPayload,
  BlypErrorCode,
  BlypErrorCodeDefinition,
  BlypErrorLike,
} from '../../shared/errors';

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

export type {
  ClientLogBrowserContext,
  ClientLogEvent,
  ClientLogLevel,
  ClientLogPageContext,
  ErrorLogLevel,
  ErrorLoggerLike,
  ParseErrorOptions,
  ParseableErrorPayload,
  BlypErrorCode,
  BlypErrorCodeDefinition,
  BlypErrorLike,
};
