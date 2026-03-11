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

export interface ExpoLoggerState {
  readonly pageId: string;
  readonly sessionId: string;
  readonly bindings: Record<string, unknown>;
  readonly delivery?: {
    enqueue: (event: ClientLogEvent) => void;
  };
}

export type ExpoLogLevel =
  | 'warn'
  | 'debug'
  | 'info'
  | 'warning'
  | 'error'
  | 'critical'
  | 'success'
  | 'table';

export interface ExpoNetworkSubscription {
  remove: () => void;
}

export interface ExpoNetworkState {
  type?: unknown;
  isConnected?: unknown;
  isInternetReachable?: unknown;
}

export interface ExpoNetworkModule {
  getNetworkStateAsync: () => Promise<ExpoNetworkState>;
  addNetworkStateListener?: (
    listener: (event: ExpoNetworkState) => void
  ) => ExpoNetworkSubscription;
}

export type ExpoNetworkLoader = () => Promise<ExpoNetworkModule | null>;

export interface ExpoLoggerConfig {
  endpoint: string;
  headers?: Record<string, string>;
  localConsole?: boolean;
  remoteSync?: boolean;
  connector?: ClientConnectorRequest;
  metadata?: Record<string, unknown> | (() => Record<string, unknown>);
  delivery?: RemoteDeliveryConfig;
}

export interface ExpoLogger {
  success: (message: unknown, ...args: unknown[]) => void;
  critical: (message: unknown, ...args: unknown[]) => void;
  warning: (message: unknown, ...args: unknown[]) => void;
  info: (message: unknown, ...args: unknown[]) => void;
  debug: (message: unknown, ...args: unknown[]) => void;
  error: (message: unknown, ...args: unknown[]) => void;
  warn: (message: unknown, ...args: unknown[]) => void;
  table: (message: string, data?: unknown) => void;
  child: (bindings: Record<string, unknown>) => ExpoLogger;
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
};
