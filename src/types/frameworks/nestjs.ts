import type { ExecutionContext } from '@nestjs/common';
import type { BlypLogger } from '../core/logger';
import type { StandaloneLogger } from './standalone';
import type {
  ClientLogIngestionConfig as SharedClientLogIngestionConfig,
  HttpRequestLog,
  ResolvedServerLogger,
  ServerLoggerConfig,
} from './shared';

export type NestAdapterType = 'express' | 'fastify';

export type NestHeaderRecord = Record<string, string | string[] | undefined>;

export interface NestLoggerState
  extends Omit<ResolvedServerLogger<NestLoggerContext>, 'logger'> {
  logger: StandaloneLogger;
}

export interface NestLoggerContext {
  request: unknown;
  response: unknown;
  adapterType: NestAdapterType;
  executionContext?: ExecutionContext;
  error?: unknown;
  controllerName?: string;
  handlerName?: string;
}

export interface NestLoggerConfig extends ServerLoggerConfig<NestLoggerContext> {}

export interface NestClientLogIngestionConfig
  extends SharedClientLogIngestionConfig<NestLoggerContext> {}

export type { HttpRequestLog };

declare module 'express-serve-static-core' {
  interface Request {
    blypLog: BlypLogger;
    blypStartTime?: number;
    blypStructuredLogEmitted?: boolean;
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    blypLog: BlypLogger;
    blypStartTime?: number;
    blypStructuredLogEmitted?: boolean;
  }
}
