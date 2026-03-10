import type { BlypLogger } from '../../core/logger';
import type {
  ClientLogIngestionConfig as SharedClientLogIngestionConfig,
  HttpRequestLog,
  ServerLoggerConfig,
} from './shared';

export interface SvelteKitLocals {
  blypLog?: BlypLogger;
  [key: string]: unknown;
}

export interface SvelteKitRequestEvent {
  request: Request;
  url: URL;
  params?: Record<string, string>;
  route?: { id?: string | null };
  locals: SvelteKitLocals;
  [key: string]: unknown;
}

export type SvelteKitResolve = (
  event: SvelteKitRequestEvent
) => Response | Promise<Response>;

export type SvelteKitHandle = (input: {
  event: SvelteKitRequestEvent;
  resolve: SvelteKitResolve;
}) => Response | Promise<Response>;

export type SvelteKitRequestHandler = (
  event: SvelteKitRequestEvent
) => Response | Promise<Response>;

export interface SvelteKitLoggerContext {
  event: SvelteKitRequestEvent;
  response?: Response;
  error?: unknown;
}

export interface SvelteKitLoggerConfig
  extends ServerLoggerConfig<SvelteKitLoggerContext> {}

export interface SvelteKitClientLogIngestionConfig
  extends SharedClientLogIngestionConfig<SvelteKitLoggerContext> {}

export interface SvelteKitLoggerFactory {
  logger: BlypLogger;
  handle: SvelteKitHandle;
  clientLogHandler: SvelteKitRequestHandler;
}

export type { HttpRequestLog };
