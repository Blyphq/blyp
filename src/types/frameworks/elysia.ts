import type { BlypErrorLike } from '../shared/errors';
import type { ResolveCtx } from '../core/helpers';
import type {
  ClientLogIngestionConfig as SharedClientLogIngestionConfig,
  HttpRequestLog,
  ServerLoggerConfig,
} from './shared';

export interface ElysiaContext {
  startTime?: number;
  request: Request;
  path: string;
  blypTraceId?: string;
  params?: Record<string, string>;
  query?: Record<string, string>;
  headers: Record<string, string | undefined>;
  set: {
    status?: number | string;
    headers?: Record<string, string>;
    redirect?: string;
    cookie?: Record<string, unknown>;
  };
  error?: BlypErrorLike;
  code?: string;
  body?: unknown;
  cookie?: Record<string, unknown>;
  [key: string]: unknown;
}

export type { ResolveCtx, HttpRequestLog };

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ArrowMapping {
  [key: string]: string;
}

export interface ElysiaLoggerConfig extends ServerLoggerConfig<ElysiaContext> {}

export interface ElysiaClientLogIngestionConfig
  extends SharedClientLogIngestionConfig<ElysiaContext> {}

// Keep the public plugin return type opaque so local path-linked installs do not
// leak Blyp's own Elysia type instance into consumer apps.
export type ElysiaLoggerPlugin = any;

export type LoggerConfig = ElysiaLoggerConfig;
export type ClientLogIngestionConfig = ElysiaClientLogIngestionConfig;
