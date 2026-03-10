import type { LogFileConfig, BlypConfig } from '../../core/config';
import type { BlypLogger } from '../../core/logger';
import type { ClientLogEvent } from '../../shared/client-log';
import type { HttpRequestLog } from './http';

export interface ClientLogIngestionConfig<Ctx> {
  path?: string;
  validate?: (
    ctx: Ctx,
    payload: ClientLogEvent
  ) => boolean | Promise<boolean>;
  enrich?: (
    ctx: Ctx,
    payload: ClientLogEvent
  ) => Record<string, unknown> | Promise<Record<string, unknown>>;
}

export interface ServerLoggerConfig<Ctx> {
  level?: string;
  pretty?: boolean;
  logDir?: string;
  file?: LogFileConfig;
  autoLogging?: boolean | { ignore?: (ctx: Ctx) => boolean };
  customProps?: (ctx: Ctx) => Record<string, unknown>;
  logErrors?: boolean;
  ignorePaths?: string[];
  clientLogging?: boolean | ClientLogIngestionConfig<Ctx>;
}

export interface ResolvedServerLogger<Ctx> {
  logger: BlypLogger;
  resolvedConfig: BlypConfig;
  level: string;
  pretty: boolean;
  logDir?: string;
  file?: LogFileConfig;
  autoLogging: ServerLoggerConfig<Ctx>['autoLogging'];
  customProps?: (ctx: Ctx) => Record<string, unknown>;
  logErrors: boolean;
  resolvedIgnorePaths?: string[];
  resolvedClientLogging: ClientLogIngestionConfig<Ctx> | null;
  ingestionPath: string;
}

export type { HttpRequestLog } from './http';
