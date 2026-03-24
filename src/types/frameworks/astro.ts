import type { BlypLogger } from '../../core/logger';
import type {
  ClientLogIngestionConfig as SharedClientLogIngestionConfig,
  HttpRequestLog,
  ServerLoggerConfig,
} from './shared';

export interface AstroLocals {
  blypLog?: BlypLogger;
  [key: string]: unknown;
}

export interface AstroEndpointContext {
  request: Request;
  url: URL;
  params?: Record<string, string>;
  locals: AstroLocals;
  [key: string]: unknown;
}

export type AstroMiddlewareContext = AstroEndpointContext;

export type AstroMiddlewareNext = () => Response | Promise<Response>;

export type AstroMiddlewareHandler = (
  context: AstroMiddlewareContext,
  next: AstroMiddlewareNext
) => Response | Promise<Response>;

export type AstroEndpointHandler = (
  context: AstroEndpointContext
) => Response | Promise<Response>;

export interface AstroLoggerContext {
  context: AstroEndpointContext;
  response?: Response;
  error?: unknown;
}

export interface AstroLoggerConfig extends ServerLoggerConfig<AstroLoggerContext> {}

export interface AstroClientLogIngestionConfig
  extends SharedClientLogIngestionConfig<AstroLoggerContext> {}

export interface AstroLoggerFactory {
  logger: BlypLogger;
  onRequest: AstroMiddlewareHandler;
  clientLogHandler: AstroEndpointHandler;
}

export type { HttpRequestLog };
