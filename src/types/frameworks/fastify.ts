import type { FastifyPluginAsync } from 'fastify';
import type { BlypLogger } from '../../core/logger';
import type {
  ClientLogIngestionConfig as SharedClientLogIngestionConfig,
  HttpRequestLog,
  ServerLoggerConfig,
} from './shared';

export interface FastifyLoggerContext {
  request: import('fastify').FastifyRequest;
  reply: import('fastify').FastifyReply;
  error?: unknown;
}

export interface FastifyLoggerConfig extends ServerLoggerConfig<FastifyLoggerContext> {}

export interface FastifyClientLogIngestionConfig
  extends SharedClientLogIngestionConfig<FastifyLoggerContext> {}

export type FastifyLoggerPlugin = FastifyPluginAsync;
export type { HttpRequestLog };

declare module 'fastify' {
  interface FastifyRequest {
    blypLog: BlypLogger;
    blypStartTime?: number;
    blypError?: unknown;
  }
}
