import type { BlypLogger } from '../../core/logger';
import type {
  ClientLogIngestionConfig as SharedClientLogIngestionConfig,
  HttpRequestLog,
  ServerLoggerConfig,
} from './shared';
import type { HeaderRecord } from './http';

export interface NitroNodeRequestLike extends AsyncIterable<Uint8Array | string> {
  method?: string;
  url?: string;
  headers?: HeaderRecord;
}

export interface NitroNodeResponseLike {
  statusCode?: number;
}

export interface NitroNodeLike {
  req?: NitroNodeRequestLike;
  res?: NitroNodeResponseLike;
}

export interface NitroEventContext {
  blypLog?: BlypLogger;
  [key: string | symbol]: unknown;
}

export interface NitroEventLike {
  path?: string;
  method?: string;
  headers?: Headers | HeaderRecord | { get(name: string): string | null };
  url?: string;
  node?: NitroNodeLike;
  context: NitroEventContext;
  request?: Request;
  body?: unknown;
  [key: string]: unknown;
}

export interface NitroResponseLike {
  status?: number;
  statusCode?: number;
  body?: unknown;
  headers?: HeadersInit;
}

export interface NitroHooksLike {
  hook: (name: string, callback: (...args: unknown[]) => unknown) => void | Promise<void>;
}

export interface NitroAppLike {
  hooks: NitroHooksLike;
}

export type NitroLoggerPlugin = (nitroApp: NitroAppLike) => void | Promise<void>;

export type NitroEventHandler = (
  event: NitroEventLike
) => Response | Promise<Response>;

export interface NitroLoggerContext {
  event: NitroEventLike;
  response?: NitroResponseLike | Response;
  error?: unknown;
}

export interface NitroLoggerConfig extends ServerLoggerConfig<NitroLoggerContext> {}

export interface NitroClientLogIngestionConfig
  extends SharedClientLogIngestionConfig<NitroLoggerContext> {}

export interface NitroLoggerFactory {
  logger: BlypLogger;
  plugin: NitroLoggerPlugin;
  clientLogHandler: NitroEventHandler;
  getLogger: (event: NitroEventLike) => BlypLogger;
}

export type { HttpRequestLog };
