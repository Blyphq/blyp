import type {
  BlypErrorCode,
  BlypErrorCodeCreateOptions,
  BlypErrorCodeDefinition,
  BlypErrorLike,
  CreateCodeFunction,
  ErrorConstructionInput,
  ErrorLogLevel,
  ErrorLoggerLike,
  HttpCodeRegistry,
  ParseErrorOptions,
  ParseableErrorPayload as BaseParseableErrorPayload,
  ResolvedErrorConfig,
} from '../types/shared/errors';

export type {
  BlypErrorCode,
  BlypErrorCodeDefinition,
  BlypErrorLike,
  ErrorConstructionInput,
  ErrorLogLevel,
  ErrorLoggerLike,
  ParseErrorOptions,
  ResolvedErrorConfig,
} from '../types/shared/errors';

export type ParseableErrorPayload = BaseParseableErrorPayload | BlypError;

export const HTTP_STATUS_DEFINITIONS = {
  CONTINUE: { status: 100, message: 'Continue' },
  SWITCHING_PROTOCOLS: { status: 101, message: 'Switching Protocols' },
  PROCESSING: { status: 102, message: 'Processing' },
  EARLY_HINTS: { status: 103, message: 'Early Hints' },
  OK: { status: 200, message: 'OK' },
  CREATED: { status: 201, message: 'Created' },
  ACCEPTED: { status: 202, message: 'Accepted' },
  NON_AUTHORITATIVE_INFORMATION: { status: 203, message: 'Non-Authoritative Information' },
  NO_CONTENT: { status: 204, message: 'No Content' },
  RESET_CONTENT: { status: 205, message: 'Reset Content' },
  PARTIAL_CONTENT: { status: 206, message: 'Partial Content' },
  MULTI_STATUS: { status: 207, message: 'Multi-Status' },
  ALREADY_REPORTED: { status: 208, message: 'Already Reported' },
  IM_USED: { status: 226, message: 'IM Used' },
  MULTIPLE_CHOICES: { status: 300, message: 'Multiple Choices' },
  MOVED_PERMANENTLY: { status: 301, message: 'Moved Permanently' },
  FOUND: { status: 302, message: 'Found' },
  SEE_OTHER: { status: 303, message: 'See Other' },
  NOT_MODIFIED: { status: 304, message: 'Not Modified' },
  USE_PROXY: { status: 305, message: 'Use Proxy' },
  TEMPORARY_REDIRECT: { status: 307, message: 'Temporary Redirect' },
  PERMANENT_REDIRECT: { status: 308, message: 'Permanent Redirect' },
  BAD_REQUEST: { status: 400, message: 'Bad Request' },
  UNAUTHORIZED: { status: 401, message: 'Unauthorized' },
  PAYMENT_REQUIRED: { status: 402, message: 'Payment Required' },
  FORBIDDEN: { status: 403, message: 'Forbidden' },
  NOT_FOUND: { status: 404, message: 'Not Found' },
  METHOD_NOT_ALLOWED: { status: 405, message: 'Method Not Allowed' },
  NOT_ACCEPTABLE: { status: 406, message: 'Not Acceptable' },
  PROXY_AUTHENTICATION_REQUIRED: { status: 407, message: 'Proxy Authentication Required' },
  REQUEST_TIMEOUT: { status: 408, message: 'Request Timeout' },
  CONFLICT: { status: 409, message: 'Conflict' },
  GONE: { status: 410, message: 'Gone' },
  LENGTH_REQUIRED: { status: 411, message: 'Length Required' },
  PRECONDITION_FAILED: { status: 412, message: 'Precondition Failed' },
  PAYLOAD_TOO_LARGE: { status: 413, message: 'Payload Too Large' },
  URI_TOO_LONG: { status: 414, message: 'URI Too Long' },
  UNSUPPORTED_MEDIA_TYPE: { status: 415, message: 'Unsupported Media Type' },
  RANGE_NOT_SATISFIABLE: { status: 416, message: 'Range Not Satisfiable' },
  EXPECTATION_FAILED: { status: 417, message: 'Expectation Failed' },
  IM_A_TEAPOT: { status: 418, message: "I'm a Teapot" },
  MISDIRECTED_REQUEST: { status: 421, message: 'Misdirected Request' },
  UNPROCESSABLE_ENTITY: { status: 422, message: 'Unprocessable Entity' },
  LOCKED: { status: 423, message: 'Locked' },
  FAILED_DEPENDENCY: { status: 424, message: 'Failed Dependency' },
  TOO_EARLY: { status: 425, message: 'Too Early' },
  UPGRADE_REQUIRED: { status: 426, message: 'Upgrade Required' },
  PRECONDITION_REQUIRED: { status: 428, message: 'Precondition Required' },
  TOO_MANY_REQUESTS: { status: 429, message: 'Too Many Requests' },
  REQUEST_HEADER_FIELDS_TOO_LARGE: { status: 431, message: 'Request Header Fields Too Large' },
  UNAVAILABLE_FOR_LEGAL_REASONS: { status: 451, message: 'Unavailable For Legal Reasons' },
  INTERNAL_SERVER_ERROR: { status: 500, message: 'Internal Server Error' },
  NOT_IMPLEMENTED: { status: 501, message: 'Not Implemented' },
  BAD_GATEWAY: { status: 502, message: 'Bad Gateway' },
  SERVICE_UNAVAILABLE: { status: 503, message: 'Service Unavailable' },
  GATEWAY_TIMEOUT: { status: 504, message: 'Gateway Timeout' },
  HTTP_VERSION_NOT_SUPPORTED: { status: 505, message: 'HTTP Version Not Supported' },
  VARIANT_ALSO_NEGOTIATES: { status: 506, message: 'Variant Also Negotiates' },
  INSUFFICIENT_STORAGE: { status: 507, message: 'Insufficient Storage' },
  LOOP_DETECTED: { status: 508, message: 'Loop Detected' },
  BANDWIDTH_LIMIT_EXCEEDED: { status: 509, message: 'Bandwidth Limit Exceeded' },
  NOT_EXTENDED: { status: 510, message: 'Not Extended' },
  NETWORK_AUTHENTICATION_REQUIRED: { status: 511, message: 'Network Authentication Required' },
} as const;

import { isPlainObject } from './validation';

const ERROR_KEYS = [
  'status',
  'statusCode',
  'code',
  'message',
  'stack',
  'why',
  'fix',
  'link',
  'details',
  'cause',
  'title',
  'detail',
  'logLevel',
  'error',
  'data',
] as const;

function isErrorLogLevel(value: unknown): value is ErrorLogLevel {
  return (
    value === 'debug' ||
    value === 'info' ||
    value === 'warning' ||
    value === 'error' ||
    value === 'critical'
  );
}

function parseStatus(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return Number.parseInt(value, 10);
  }

  return undefined;
}

function normalizeDetails(value: unknown): Record<string, unknown> | undefined {
  return isPlainObject(value) ? value : undefined;
}

function hasMeaningfulErrorData(candidate: BlypErrorLike): boolean {
  return (
    candidate.status !== undefined ||
    candidate.statusCode !== undefined ||
    candidate.code !== undefined ||
    candidate.message !== undefined ||
    candidate.stack !== undefined ||
    candidate.why !== undefined ||
    candidate.fix !== undefined ||
    candidate.link !== undefined ||
    candidate.details !== undefined ||
    candidate.cause !== undefined ||
    candidate.logLevel !== undefined
  );
}

function normalizeRecordCandidate(record: Record<string, unknown>): BlypErrorLike {
  const title = typeof record.title === 'string' ? record.title : undefined;
  const detail = typeof record.detail === 'string' ? record.detail : undefined;

  return {
    status: parseStatus(record.status),
    statusCode: parseStatus(record.statusCode),
    code:
      typeof record.code === 'string' || typeof record.code === 'number'
        ? record.code
        : undefined,
    message:
      typeof record.message === 'string'
        ? record.message
        : title ?? detail,
    stack: typeof record.stack === 'string' ? record.stack : undefined,
    why: typeof record.why === 'string' ? record.why : undefined,
    fix: typeof record.fix === 'string' ? record.fix : undefined,
    link: typeof record.link === 'string' ? record.link : undefined,
    details: normalizeDetails(record.details),
    cause: record.cause,
    logLevel: isErrorLogLevel(record.logLevel) ? record.logLevel : undefined,
  };
}

function mergeCandidates(
  container: Record<string, unknown>,
  nested: BlypErrorLike | string | undefined
): BlypErrorLike | string | undefined {
  const own = normalizeRecordCandidate(container);

  if (nested === undefined) {
    return hasMeaningfulErrorData(own) ? own : undefined;
  }

  if (typeof nested === 'string') {
    if (hasMeaningfulErrorData(own)) {
      return {
        ...own,
        message: own.message ?? nested,
      };
    }

    return nested;
  }

  return {
    status: own.status ?? nested.status,
    statusCode: own.statusCode ?? nested.statusCode,
    code: own.code ?? nested.code,
    message: own.message ?? nested.message,
    stack: own.stack ?? nested.stack,
    why: own.why ?? nested.why,
    fix: own.fix ?? nested.fix,
    link: own.link ?? nested.link,
    details: own.details ?? nested.details,
    cause: own.cause ?? nested.cause,
    logLevel: own.logLevel ?? nested.logLevel,
  };
}

function hasErrorShape(record: Record<string, unknown>): boolean {
  return ERROR_KEYS.some((key) => record[key] !== undefined);
}

function isResponseLike(input: unknown): input is Response {
  if (typeof Response !== 'undefined' && input instanceof Response) {
    return true;
  }

  return isPlainObject(input) &&
    typeof input.status === 'number' &&
    typeof input.statusText === 'string' &&
    typeof input.clone === 'function' &&
    typeof input.text === 'function';
}

export class BlypError extends Error implements BlypErrorLike {
  override readonly name = 'BlypError';
  readonly status: number;
  readonly statusCode: number;
  readonly code?: string | number;
  readonly why?: string;
  readonly fix?: string;
  readonly link?: string;
  readonly details?: Record<string, unknown>;
  override readonly cause?: unknown;
  readonly logLevel: ErrorLogLevel;

  constructor(config: ResolvedErrorConfig) {
    super(config.message);
    Object.setPrototypeOf(this, new.target.prototype);

    this.status = config.status;
    this.statusCode = config.statusCode;
    this.code = config.code;
    this.why = config.why;
    this.fix = config.fix;
    this.link = config.link;
    this.details = config.details;
    this.cause = config.cause;
    this.logLevel = config.logLevel;

    if (config.stack) {
      this.stack = config.stack;
    } else if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, BlypError);
    }
  }

  toJSON(): {
    name: 'BlypError';
    message: string;
    status: number;
    statusCode: number;
    code?: string | number;
    why?: string;
    fix?: string;
    link?: string;
    details?: Record<string, unknown>;
  } {
    return {
      name: 'BlypError',
      message: this.message,
      status: this.status,
      statusCode: this.statusCode,
      ...(this.code !== undefined ? { code: this.code } : {}),
      ...(this.why !== undefined ? { why: this.why } : {}),
      ...(this.fix !== undefined ? { fix: this.fix } : {}),
      ...(this.link !== undefined ? { link: this.link } : {}),
      ...(this.details !== undefined ? { details: this.details } : {}),
    };
  }
}

export function resolveErrorLogLevel(
  status: number,
  explicit?: ErrorLogLevel
): ErrorLogLevel {
  if (explicit) {
    return explicit;
  }

  if (status >= 500) {
    return 'critical';
  }

  if (status >= 400) {
    return 'error';
  }

  return 'warning';
}

export function normalizeCauseForLog(cause: unknown): unknown {
  if (cause instanceof Error) {
    return {
      name: cause.name,
      message: cause.message,
      ...(cause.stack ? { stack: cause.stack } : {}),
    };
  }

  return cause;
}

export function emitErrorLog(
  logger: ErrorLoggerLike,
  error: BlypError,
  levelOverride?: ErrorLogLevel
): void {
  const level = resolveErrorLogLevel(error.status, levelOverride ?? error.logLevel);
  const logMethod = (() => {
    switch (level) {
      case 'debug':
        return logger.debug;
      case 'info':
        return logger.info;
      case 'warning':
        return logger.warning;
      case 'critical':
        return logger.critical;
      case 'error':
      default:
        return logger.error;
    }
  })();

  logMethod(error.message, {
    type: 'application_error',
    status: error.status,
    statusCode: error.statusCode,
    code: error.code,
    why: error.why,
    fix: error.fix,
    link: error.link,
    details: error.details,
    cause: normalizeCauseForLog(error.cause),
  });
}

export function resolveErrorConfig(
  input: BlypErrorLike & { status?: number; logLevel?: ErrorLogLevel },
  defaults: Partial<ResolvedErrorConfig> = {}
): ResolvedErrorConfig {
  const candidateStatus = input.status ?? input.statusCode;
  const status = candidateStatus ?? defaults.status ?? defaults.statusCode ?? 500;
  const preset = getHttpCode(status);
  const message =
    input.message ??
    defaults.message ??
    preset?.message ??
    `HTTP ${status}`;

  return {
    status,
    statusCode: status,
    message,
    code: input.code ?? defaults.code ?? preset?.code,
    why: input.why ?? defaults.why ?? preset?.why,
    fix: input.fix ?? defaults.fix ?? preset?.fix,
    link: input.link ?? defaults.link ?? preset?.link,
    details: input.details ?? defaults.details ?? preset?.details,
    cause: input.cause ?? defaults.cause,
    stack: input.stack ?? defaults.stack,
    logLevel: resolveErrorLogLevel(
      status,
      input.logLevel ?? defaults.logLevel ?? preset?.logLevel
    ),
  };
}

export function createBlypError(
  input: ErrorConstructionInput,
  defaults: Partial<ResolvedErrorConfig> = {}
): BlypError {
  const error = new BlypError(resolveErrorConfig(input, defaults));

  if (input.skipLogging !== true && input.logger) {
    emitErrorLog(input.logger, error, input.logLevel);
  }

  return error;
}

function createErrorCode(
  definition: BlypErrorCodeDefinition,
  createErrorFromCode?: CreateCodeFunction
): BlypErrorCode {
  const errorCode = {
    ...definition,
    statusCode: definition.status,
    create(overrides: BlypErrorCodeCreateOptions = {}): BlypError {
      if (createErrorFromCode) {
        return createErrorFromCode(definition, overrides) as BlypError;
      }

      return createBlypError({
        status: definition.status,
        message: definition.message,
        code: overrides.code ?? definition.code,
        why: overrides.why ?? definition.why,
        fix: overrides.fix ?? definition.fix,
        link: overrides.link ?? definition.link,
        details: overrides.details ?? definition.details,
        cause: overrides.cause,
        stack: overrides.stack,
        logLevel: overrides.logLevel ?? definition.logLevel,
        logger: overrides.logger,
        skipLogging: overrides.skipLogging,
      });
    },
    extend(extension: {
      code: string;
      message?: string;
      why?: string;
      fix?: string;
      link?: string;
      details?: Record<string, unknown>;
      logLevel?: ErrorLogLevel;
    }): BlypErrorCode {
      return createErrorCode(
        {
          key: extension.code,
          status: definition.status,
          message: extension.message ?? definition.message,
          code: extension.code,
          why: extension.why ?? definition.why,
          fix: extension.fix ?? definition.fix,
          link: extension.link ?? definition.link,
          details: extension.details ?? definition.details,
          logLevel: extension.logLevel ?? definition.logLevel,
        },
        createErrorFromCode
      );
    },
  } satisfies BlypErrorCode;

  return Object.freeze(errorCode);
}

export function buildHttpCodeRegistry(
  createErrorFromCode?: CreateCodeFunction
): HttpCodeRegistry<keyof typeof HTTP_STATUS_DEFINITIONS> {
  const entries = Object.entries(HTTP_STATUS_DEFINITIONS).map(([key, value]) => {
    return [key, createErrorCode({ key, ...value }, createErrorFromCode)] as const;
  });

  return Object.freeze(
    Object.fromEntries(entries) as HttpCodeRegistry<keyof typeof HTTP_STATUS_DEFINITIONS>
  );
}

export const HTTP_CODES = buildHttpCodeRegistry();

const httpCodeByStatus = new Map<number, BlypErrorCode>(
  Object.values(HTTP_CODES).map((value) => [value.status, value])
);

export function getHttpCode(status: number): BlypErrorCode | undefined {
  return httpCodeByStatus.get(status);
}

export function extractErrorCandidate(payload: unknown): BlypErrorLike | string | undefined {
  if (typeof payload === 'string') {
    return payload;
  }

  if (!isPlainObject(payload)) {
    return undefined;
  }

  if (payload.error !== undefined) {
    const nested = payload.error;
    if (typeof nested === 'string') {
      return mergeCandidates(payload, nested);
    }

    if (isPlainObject(nested)) {
      return mergeCandidates(payload, extractErrorCandidate(nested));
    }
  }

  if (isPlainObject(payload.data)) {
    const nested = payload.data;
    if (nested.error !== undefined || hasErrorShape(nested)) {
      return mergeCandidates(payload, extractErrorCandidate(nested));
    }
  }

  if (hasErrorShape(payload)) {
    return normalizeRecordCandidate(payload);
  }

  return undefined;
}

function coercePayloadToError(
  payload: ParseableErrorPayload,
  options: ParseErrorOptions = {},
  responseContext: { status?: number; statusText?: string } = {}
): BlypError {
  if (payload instanceof BlypError) {
    return payload;
  }

  const candidate = (() => {
    if (payload instanceof Error) {
      const errorWithMetadata = payload as Error & BlypErrorLike;
      return {
        status: errorWithMetadata.status,
        statusCode: errorWithMetadata.statusCode,
        code: errorWithMetadata.code,
        message: payload.message,
        stack: payload.stack,
        why: errorWithMetadata.why,
        fix: errorWithMetadata.fix,
        link: errorWithMetadata.link,
        details: errorWithMetadata.details,
        cause: errorWithMetadata.cause,
        logLevel: errorWithMetadata.logLevel,
      } satisfies BlypErrorLike;
    }

    return extractErrorCandidate(payload);
  })();

  const responseStatus = responseContext.status && responseContext.status > 0
    ? responseContext.status
    : undefined;
  const candidateStatus = typeof candidate === 'string'
    ? undefined
    : candidate?.status ?? candidate?.statusCode;
  const status = responseStatus ?? candidateStatus ?? options.fallbackStatus ?? 500;
  const textBody = typeof candidate === 'string'
    ? candidate.trim() || undefined
    : undefined;
  const statusText = responseContext.statusText?.trim() || undefined;

  return createBlypError(
    typeof candidate === 'string'
      ? { message: textBody, ...(responseStatus !== undefined ? { status: responseStatus } : {}) }
      : {
          ...(candidate ?? {}),
          ...(responseStatus !== undefined
            ? {
                status: responseStatus,
                statusCode: responseStatus,
              }
            : {}),
        },
    {
      status,
      message:
        (typeof candidate === 'string' ? textBody : candidate?.message) ??
        statusText ??
        getHttpCode(status)?.message ??
        `HTTP ${status}`,
    }
  );
}

export async function readResponseErrorPayload(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type')?.toLowerCase();
  const isJsonResponse = contentType?.includes('application/json') || contentType?.includes('+json');

  if (isJsonResponse) {
    try {
      return await response.clone().json();
    } catch {
      try {
        return await response.clone().text();
      } catch {
        return undefined;
      }
    }
  }

  try {
    return await response.clone().text();
  } catch {
    return undefined;
  }
}

export function parseError(
  input: Response,
  options?: ParseErrorOptions
): Promise<BlypError>;
export function parseError(
  input: ParseableErrorPayload,
  options?: ParseErrorOptions
): BlypError;
export function parseError(
  input: ParseableErrorPayload | Response,
  options: ParseErrorOptions = {}
): BlypError | Promise<BlypError> {
  if (isResponseLike(input)) {
    return (async () => {
      const payload = await readResponseErrorPayload(input).catch(() => undefined);
      const error = coercePayloadToError(payload as ParseableErrorPayload, options, {
        status: input.status,
        statusText: input.statusText,
      });

      if (options.logger) {
        emitErrorLog(options.logger, error, options.logLevel);
      }

      return error;
    })();
  }

  const error = coercePayloadToError(input, options);

  if (options.logger) {
    emitErrorLog(options.logger, error, options.logLevel);
  }

  return error;
}
