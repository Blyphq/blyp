/// <reference lib="dom" />

import type {
  ClientConnectorRequest,
  ClientLogBrowserContext,
  ClientLogDeviceContext,
  ClientLogEvent,
  ClientLogLevel,
  ClientLogPageContext,
  RemoteDeliveryConfig,
  RemoteDeliveryDropContext,
  RemoteDeliveryFailureContext,
  RemoteDeliveryFailureReason,
  RemoteDeliveryRetryContext,
  RemoteDeliverySuccessContext,
} from '../shared/client-log';
import type {
  ErrorLogLevel,
  ErrorLoggerLike,
  ParseErrorOptions,
  ParseableErrorPayload,
  BlypErrorCode,
  BlypErrorCodeDefinition,
  BlypErrorLike,
} from '../shared/errors';
import type { DeliveryAttemptResult } from '../../shared/remote-delivery';

export interface ClientLoggerState {
  readonly pageId: string;
  readonly sessionId: string;
  readonly bindings: Record<string, unknown>;
  readonly traceId?: string;
  readonly delivery?: {
    enqueue: (event: ClientLogEvent) => void;
  };
}

export interface ClientLoggerConfig {
  endpoint?: string;
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
  transport?: (payload: ClientLogEvent) => Promise<DeliveryAttemptResult>;
  localConsole?: boolean;
  remoteSync?: boolean;
  connector?: ClientConnectorRequest;
  metadata?: Record<string, unknown> | (() => Record<string, unknown>);
  delivery?: RemoteDeliveryConfig;
  traceId?: string;
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
  ClientConnectorRequest,
  ClientLogDeviceContext,
  ClientLogEvent,
  ClientLogLevel,
  ClientLogPageContext,
  RemoteDeliveryConfig,
  RemoteDeliveryDropContext,
  RemoteDeliveryFailureContext,
  RemoteDeliveryFailureReason,
  RemoteDeliveryRetryContext,
  RemoteDeliverySuccessContext,
  ErrorLogLevel,
  ErrorLoggerLike,
  ParseErrorOptions,
  ParseableErrorPayload,
  BlypErrorCode,
  BlypErrorCodeDefinition,
  BlypErrorLike,
};
