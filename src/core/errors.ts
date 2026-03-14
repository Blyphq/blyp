import {
  BlypError,
  buildHttpCodeRegistry,
  emitErrorLog,
  getHttpCode as getSharedHttpCode,
  resolveErrorConfig,
  type BlypErrorCode
} from '../shared/errors';
import type { CreateErrorInput } from '../types/core/errors';
import {
  logger as defaultLogger,
  tryGetBetterStackSender,
  tryGetPostHogSender,
} from './logger';

export type {
  BlypErrorCode,
  BlypErrorCodeDefinition,
  BlypErrorLike,
  ErrorLogLevel
} from '../shared/errors';
export type { CreateErrorInput, CreateErrorOverrides } from '../types/core/errors';

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

    const betterstack = tryGetBetterStackSender(input.logger ?? defaultLogger);
    if (betterstack?.shouldAutoCaptureExceptions()) {
      betterstack.captureException(error, {
        source: 'server',
        warnIfUnavailable: true,
        context: {
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
