import type { BlypLogger } from '../../core/logger';
import type { HeaderRecord } from './http';
import type {
  ClientLogIngestionConfig as SharedClientLogIngestionConfig,
  HttpRequestLog,
  ServerLoggerConfig,
} from './shared';

export interface SolidStartResponseStub {
  status?: number;
  statusText?: string;
  headers: Headers;
}

export interface SolidStartLocals {
  blypLog?: BlypLogger;
  blypTraceId?: string;
  blypStartTime?: number;
  blypStructuredLogEmitted?: boolean;
  [key: string]: unknown;
}

export interface SolidStartNativeEvent {
  method?: string;
  path?: string;
  url?: string;
  headers?: Headers | HeaderRecord | { get(name: string): string | null };
  [key: string]: unknown;
}

export interface SolidStartFetchEvent {
  request: Request;
  response: SolidStartResponseStub;
  clientAddress?: string;
  locals: SolidStartLocals;
  nativeEvent: SolidStartNativeEvent;
}

export interface SolidStartAPIEvent extends SolidStartFetchEvent {
  params: Record<string, string>;
  fetch?: typeof fetch;
}

export type SolidStartRequestMiddleware = (
  event: SolidStartFetchEvent
) => Response | Promise<Response> | void | Promise<void>;

export type SolidStartResponseMiddleware = (
  event: SolidStartFetchEvent,
  response?: { body?: unknown }
) => Response | Promise<Response> | void | Promise<void>;

export type SolidStartApiHandler = (
  event: SolidStartAPIEvent
) => Response | Promise<Response>;

export interface SolidStartLoggerContext {
  event: SolidStartFetchEvent | SolidStartAPIEvent;
  response?: SolidStartResponseStub | Response;
  error?: unknown;
}

export interface SolidStartLoggerConfig
  extends ServerLoggerConfig<SolidStartLoggerContext> {}

export interface SolidStartClientLogIngestionConfig
  extends SharedClientLogIngestionConfig<SolidStartLoggerContext> {}

export interface SolidStartMiddlewareDefinition {
  onRequest: SolidStartRequestMiddleware;
  onBeforeResponse: SolidStartResponseMiddleware;
}

export interface SolidStartLoggerFactory {
  logger: BlypLogger;
  middleware: SolidStartMiddlewareDefinition;
  clientLogHandler: SolidStartApiHandler;
}

export type { HttpRequestLog };

declare global {
  namespace App {
    interface RequestEventLocals {
      blypLog?: BlypLogger;
      blypTraceId?: string;
      blypStartTime?: number;
      blypStructuredLogEmitted?: boolean;
    }
  }
}

export {};
