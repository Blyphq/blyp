import type { ErrorRequestHandler, Request, RequestHandler, Response } from 'express';
import type { BlypLogger } from '../../core/logger';
import type {
  ClientLogIngestionConfig as SharedClientLogIngestionConfig,
  HttpRequestLog,
  ServerLoggerConfig,
} from './shared';

export interface ExpressLoggerContext {
  req: Request;
  res: Response;
  error?: unknown;
}

export interface ExpressLoggerConfig extends ServerLoggerConfig<ExpressLoggerContext> {}

export interface ExpressClientLogIngestionConfig
  extends SharedClientLogIngestionConfig<ExpressLoggerContext> {}

export type ExpressLoggerMiddleware = RequestHandler;
export type ExpressErrorLoggerMiddleware = ErrorRequestHandler;
export type { HttpRequestLog };

declare module 'express-serve-static-core' {
  interface Request {
    blypLog: BlypLogger;
  }

  interface Locals {
    blypStartTime?: number;
    blypError?: unknown;
  }
}
