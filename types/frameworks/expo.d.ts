import type {
  ClientLogBrowserContext,
  ClientLogDeviceContext,
  ClientLogEvent,
  ClientLogLevel,
  ClientLogPageContext,
} from './client';

export interface ExpoLoggerConfig {
  endpoint: string;
  headers?: Record<string, string>;
  localConsole?: boolean;
  remoteSync?: boolean;
  metadata?: Record<string, unknown> | (() => Record<string, unknown>);
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

export declare function createExpoLogger(config: ExpoLoggerConfig): ExpoLogger;

export type {
  ClientLogBrowserContext,
  ClientLogDeviceContext,
  ClientLogEvent,
  ClientLogLevel,
  ClientLogPageContext,
};
