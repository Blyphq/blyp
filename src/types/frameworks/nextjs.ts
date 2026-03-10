import type { BlypLogger } from '../../core/logger';
import type {
  ClientLogIngestionConfig as SharedClientLogIngestionConfig,
  HttpRequestLog,
  ServerLoggerConfig,
} from './shared';

export interface NextJsRouteContext {
  params?: Record<string, string> | Promise<Record<string, string>>;
  [key: string]: unknown;
}

export interface NextJsLoggerHelpers {
  log: BlypLogger;
}

export interface NextJsLoggerContext {
  request: Request;
  context?: NextJsRouteContext;
  response?: Response;
  error?: unknown;
}

export interface NextJsLoggerConfig extends ServerLoggerConfig<NextJsLoggerContext> {}

export interface NextJsClientLogIngestionConfig
  extends SharedClientLogIngestionConfig<NextJsLoggerContext> {}

export type NextJsWrappedHandler<Ctx extends NextJsRouteContext = NextJsRouteContext> = (
  request: Request,
  context: Ctx
) => Response | Promise<Response>;

export type NextJsHandlerWithLogger<Ctx extends NextJsRouteContext = NextJsRouteContext> = (
  request: Request,
  context: Ctx,
  helpers: NextJsLoggerHelpers
) => Response | Promise<Response>;

export interface NextJsLoggerFactory {
  logger: BlypLogger;
  withLogger: <Ctx extends NextJsRouteContext = NextJsRouteContext>(
    handler: NextJsHandlerWithLogger<Ctx>
  ) => NextJsWrappedHandler<Ctx>;
  clientLogHandler: (request: Request) => Promise<Response>;
}

export type { HttpRequestLog };
