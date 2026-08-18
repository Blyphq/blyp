import type {
  FarmEventType,
  FarmPluginRouteRuntimePayload,
  FarmPluginRuntimeKind,
} from '@farm.js/core';
import type { BlypLogger } from '../../core/logger';
import type { ClientConnectorRequest } from '../shared/client-log';
import type { ServerLoggerConfig } from './shared';

export type FarmJsTelemetryEvents =
  | 'curated'
  | 'all'
  | readonly FarmEventType[]
  | false;

export interface FarmJsBrowserTelemetryConfig {
  /** Sample rate for non-error browser events in production. @default 0.1 */
  sampleRate?: number;
  /** Emit completed hydration timing. @default true */
  hydration?: boolean;
  /** Emit completed client-navigation timing. @default true */
  navigation?: boolean;
  /** Emit browser, hydration, and navigation errors. Errors are never sampled. @default true */
  errors?: boolean;
  /** Emit allowlisted Web Vital-style performance entries. @default true */
  performance?: boolean;
  /** Mirror generated telemetry to the browser console. @default false */
  localConsole?: boolean;
  /** Ask the Blyp ingestion endpoint to forward browser telemetry to this connector. */
  connector?: ClientConnectorRequest;
  /** Fetch credential behavior used by the browser logger. @default "same-origin" */
  credentials?: RequestCredentials;
}

export interface FarmJsTelemetryConfig {
  /** Farm server lifecycle events forwarded through Blyp. @default "curated" */
  events?: FarmJsTelemetryEvents;
  /** Browser lifecycle telemetry. @default enabled */
  browser?: boolean | FarmJsBrowserTelemetryConfig;
}

export interface FarmJsLoggerContext {
  request: Request;
  kind: FarmPluginRuntimeKind;
  route?: FarmPluginRouteRuntimePayload;
  response?: Response;
  error?: unknown;
  traceId: string;
  log: BlypLogger;
}

export interface FarmJsLoggerConfig
  extends ServerLoggerConfig<FarmJsLoggerContext> {
  telemetry?: false | FarmJsTelemetryConfig;
  /** Response and propagation header for Blyp request traces. @default "x-blyp-trace-id" */
  traceHeader?: string;
}

