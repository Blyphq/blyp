import type { ExecutionContext } from '@nestjs/common';
import type { BlypLogger } from '../../core/logger';
import type {
  ClientLogIngestionConfig as SharedClientLogIngestionConfig,
  HttpRequestLog,
  ServerLoggerConfig,
} from './shared';

export type NestAdapterType = 'express' | 'fastify';

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
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    blypLog: BlypLogger;
    blypStartTime?: number;
  }
}
