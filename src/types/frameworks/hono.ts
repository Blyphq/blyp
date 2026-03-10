import type { Context, MiddlewareHandler } from 'hono';
import type { BlypLogger } from '../../core/logger';
import type {
  ClientLogIngestionConfig as SharedClientLogIngestionConfig,
  HttpRequestLog,
  ServerLoggerConfig,
} from './shared';

export interface HonoLoggerVariables {
  blypLog: BlypLogger;
  blypStartTime?: number;
}

export interface HonoLoggerConfig extends ServerLoggerConfig<Context> {}

export interface HonoClientLogIngestionConfig
  extends SharedClientLogIngestionConfig<Context> {}

export type HonoLoggerMiddleware = MiddlewareHandler;
export type { HttpRequestLog };
