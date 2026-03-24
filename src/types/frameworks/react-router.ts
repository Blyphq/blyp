import type { BlypLogger } from '../../core/logger';
import type {
  ClientLogIngestionConfig as SharedClientLogIngestionConfig,
  HttpRequestLog,
  ServerLoggerConfig,
} from './shared';

export interface ReactRouterContextStore {
  get?: (key: unknown) => unknown;
  set?: (key: unknown, value: unknown) => void;
  [key: string | symbol]: unknown;
}

export interface ReactRouterMiddlewareArgs {
  request: Request;
  params?: Record<string, string | undefined>;
  context: ReactRouterContextStore;
}

export type ReactRouterMiddlewareNext = () => Response | Promise<Response>;

export type ReactRouterLoggerMiddleware = (
  args: ReactRouterMiddlewareArgs,
  next: ReactRouterMiddlewareNext
) => Response | Promise<Response>;

export interface ReactRouterLoggerContext {
  request: Request;
  params?: Record<string, string | undefined>;
  context: ReactRouterContextStore;
  response?: Response;
  error?: unknown;
}

export interface ReactRouterLoggerConfig
  extends ServerLoggerConfig<ReactRouterLoggerContext> {}

export interface ReactRouterClientLogIngestionConfig
  extends SharedClientLogIngestionConfig<ReactRouterLoggerContext> {}

export interface ReactRouterLoggerFactory {
  logger: BlypLogger;
  middleware: ReactRouterLoggerMiddleware;
  clientLogHandler: (request: Request) => Promise<Response>;
  getLogger: (context: ReactRouterContextStore) => BlypLogger;
  setLogger: (context: ReactRouterContextStore, logger: BlypLogger) => void;
}

export type { HttpRequestLog };
