export type ErrorLogLevel = 'debug' | 'info' | 'warning' | 'error' | 'critical';

export interface ErrorLoggerLike {
  debug: (message: unknown, ...args: unknown[]) => void;
  info: (message: unknown, ...args: unknown[]) => void;
  warning: (message: unknown, ...args: unknown[]) => void;
  error: (message: unknown, ...args: unknown[]) => void;
  critical: (message: unknown, ...args: unknown[]) => void;
}

export interface BlypErrorLike {
  status?: number;
  statusCode?: number;
  code?: string | number;
  message?: string;
  stack?: string;
  why?: string;
  fix?: string;
  link?: string;
  details?: Record<string, unknown>;
  cause?: unknown;
  logLevel?: ErrorLogLevel;
}

export interface BlypErrorCodeDefinition {
  key: string;
  status: number;
  message: string;
  code?: string;
  why?: string;
  fix?: string;
  link?: string;
  details?: Record<string, unknown>;
  logLevel?: ErrorLogLevel;
}

export interface BlypErrorCodeCreateOptions extends Omit<BlypErrorLike, 'statusCode'> {
  logger?: ErrorLoggerLike;
  skipLogging?: boolean;
}

export interface BlypErrorCode extends Readonly<BlypErrorCodeDefinition> {
  readonly statusCode: number;
  create(overrides?: BlypErrorCodeCreateOptions): BlypErrorLike;
  extend(definition: {
    code: string;
    message?: string;
    why?: string;
    fix?: string;
    link?: string;
    details?: Record<string, unknown>;
    logLevel?: ErrorLogLevel;
  }): BlypErrorCode;
}

export type ParseableErrorPayload =
  | BlypErrorLike
  | Error
  | string
  | Record<string, unknown>
  | null
  | undefined;

export interface ParseErrorOptions {
  logger?: ErrorLoggerLike;
  logLevel?: ErrorLogLevel;
  fallbackStatus?: number;
}

export interface ResolvedErrorConfig {
  status: number;
  statusCode: number;
  message: string;
  code?: string | number;
  why?: string;
  fix?: string;
  link?: string;
  details?: Record<string, unknown>;
  cause?: unknown;
  stack?: string;
  logLevel: ErrorLogLevel;
}

export interface ErrorConstructionInput extends BlypErrorLike {
  status?: number;
  logger?: ErrorLoggerLike;
  skipLogging?: boolean;
}

export type HttpCodeRegistry<TKeys extends string = string> = Readonly<Record<TKeys, BlypErrorCode>>;

export type CreateCodeFunction = (
  definition: BlypErrorCodeDefinition,
  overrides?: BlypErrorCodeCreateOptions
) => BlypErrorLike;
