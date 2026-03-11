import {
  type ErrorLoggerLike,
  BlypError,
  buildHttpCodeRegistry,
  emitErrorLog,
  getHttpCode as getSharedHttpCode,
  resolveErrorConfig,
  type ErrorLogLevel,
  type BlypErrorCode,
  type BlypErrorCodeDefinition,
  type BlypErrorLike,
} from '../shared/errors';
import { logger as defaultLogger } from './logger';
import { tryGetPostHogSender } from './logger';

export type {
  ErrorLogLevel,
  BlypErrorCode,
  BlypErrorCodeDefinition,
  BlypErrorLike,
} from '../shared/errors';

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

export function createError(input: CreateErrorInput): BlypError {
  const error = new BlypError(resolveErrorConfig(input));

  if (input.skipLogging !== true) {
    emitErrorLog(input.logger ?? defaultLogger, error, input.logLevel);

    const posthog = tryGetPostHogSender(input.logger ?? defaultLogger);
    if (posthog?.shouldAutoCaptureExceptions()) {
      posthog.captureException(error, {
        source: 'server',
        warnIfUnavailable: true,
        properties: {
          'blyp.type': 'application_error',
          status: error.status,
          statusCode: error.statusCode,
          ...(error.code !== undefined ? { code: error.code } : {}),
          ...(error.why !== undefined ? { why: error.why } : {}),
          ...(error.fix !== undefined ? { fix: error.fix } : {}),
          ...(error.link !== undefined ? { link: error.link } : {}),
          ...(error.details !== undefined ? { details: error.details } : {}),
        },
      });
    }
  }

  return error;
}

export const HTTP_CODES = buildHttpCodeRegistry((definition, overrides = {}) => {
  return createError({
    status: definition.status,
    message: definition.message,
    code: definition.code,
    why: definition.why,
    fix: definition.fix,
    link: definition.link,
    details: definition.details,
    ...overrides,
  });
});

const httpCodeByStatus = new Map<number, BlypErrorCode>(
  Object.values(HTTP_CODES).map((value) => [value.status, value])
);

export function getHttpCode(status: number): BlypErrorCode | undefined {
  return httpCodeByStatus.get(status) ?? getSharedHttpCode(status);
}

export { BlypError };
