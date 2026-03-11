import type { ErrorLogLevel, ErrorLoggerLike } from '../shared/errors';

export interface CreateErrorInput {
  status?: number;
  message?: string;
  code?: string | number;
  why?: string;
  fix?: string;
  link?: string;
  details?: Record<string, unknown>;
  cause?: unknown;
  logger?: ErrorLoggerLike;
  logLevel?: ErrorLogLevel;
  skipLogging?: boolean;
}

export interface CreateErrorOverrides extends Omit<CreateErrorInput, 'status'> {}
