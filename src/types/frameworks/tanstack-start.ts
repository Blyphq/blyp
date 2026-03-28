import type { BlypLogger } from '../../core/logger';
import type {
  ClientLogIngestionConfig as SharedClientLogIngestionConfig,
  HttpRequestLog,
  ServerLoggerConfig,
} from './shared';

export interface TanStackStartMiddlewareContext {
  request: Request;
  context: Record<string, unknown> & { blypTraceId?: string };
  next: (options?: { context?: Record<string, unknown> & { blypTraceId?: string } }) => Promise<Response>;
}

export interface TanStackStartLoggerContext {
  request: Request;
  context: Record<string, unknown> & { blypTraceId?: string };
  response?: Response;
  error?: unknown;
}

export interface TanStackStartLoggerConfig
  extends ServerLoggerConfig<TanStackStartLoggerContext> {}

export interface TanStackStartClientLogIngestionConfig
  extends SharedClientLogIngestionConfig<TanStackStartLoggerContext> {}

export interface TanStackStartClientLogHandlers {
  POST: (request: Request) => Promise<Response>;
}

export interface TanStackStartLoggerFactory {
  logger: BlypLogger;
  requestMiddleware: (input: TanStackStartMiddlewareContext) => Promise<Response>;
  clientLogHandlers: TanStackStartClientLogHandlers;
}

export type { HttpRequestLog };
