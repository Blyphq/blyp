import { DEFAULT_CLIENT_LOG_ENDPOINT, isClientLogEvent, normalizeEndpointPath } from '../../shared/client-log';
import type { ClientLogEvent } from '../../shared/client-log';
import { resolveConfig } from '../../core/config';
import { getMethodColor, getResponseTimeColor, getStatusColor } from '../../core/colors';
import { resolveStatusCode, shouldIgnorePath } from '../../core/helpers';
import { createBaseLogger, getPostHogSender } from '../../core/logger';
import {
  buildClientDetails,
  buildInfoLogMessage,
  buildRequestLogData,
  getHeaderValue,
  extractPathname,
  isErrorStatus,
  type ErrorLike,
  type HttpRequestLog,
  type RequestLike,
  type ResolveLike,
} from './http';
import type {
  ClientLogIngestionConfig,
  ResolvedServerLogger,
  ServerLoggerConfig,
} from '../../types/frameworks/shared';

function buildVerboseLogMessage(
  method: string,
  statusCode: number,
  url: string,
  responseTime: number
): string {
  const methodColor = getMethodColor(method);
  const statusColor = getStatusColor(statusCode);
  const timeColor = getResponseTimeColor(responseTime);
  return `${methodColor} ${url} ${statusColor} ${timeColor}`;
}

export function resolveClientLoggingConfig<Ctx>(
  clientLogging: ServerLoggerConfig<Ctx>['clientLogging'],
  defaultClientLogging: { enabled?: boolean; path?: string } | undefined
): ClientLogIngestionConfig<Ctx> | null {
  const defaultPath = normalizeEndpointPath(
    defaultClientLogging?.path ?? DEFAULT_CLIENT_LOG_ENDPOINT
  );
  const defaultConfig = defaultClientLogging?.enabled === false
    ? null
    : { path: defaultPath };

  if (clientLogging === false) {
    return null;
  }

  if (clientLogging === undefined) {
    return defaultConfig;
  }

  if (clientLogging === true) {
    return {
      path: defaultPath,
    };
  }

  return {
    ...defaultConfig,
    ...clientLogging,
    path: normalizeEndpointPath(clientLogging.path ?? defaultPath),
  };
}

export function resolveServerLogger<Ctx>(
  config: ServerLoggerConfig<Ctx> = {},
  loggerOverride?: ReturnType<typeof createBaseLogger>
): ResolvedServerLogger<Ctx> {
  const resolvedConfig = resolveConfig({
    ...(config.level !== undefined ? { level: config.level } : {}),
    ...(config.pretty !== undefined ? { pretty: config.pretty } : {}),
    ...(config.logDir !== undefined ? { logDir: config.logDir } : {}),
    ...(config.file !== undefined ? { file: config.file } : {}),
    ...(config.connectors !== undefined ? { connectors: config.connectors } : {}),
  });
  const {
    level = resolvedConfig.level,
    pretty = resolvedConfig.pretty,
    logDir = resolvedConfig.logDir,
    file = resolvedConfig.file,
    autoLogging = true,
    customProps,
    logErrors = true,
    ignorePaths,
    clientLogging,
    connectors,
  } = config;
  const logger = loggerOverride ?? createBaseLogger({ level, pretty, logDir, file, connectors });
  const resolvedClientLogging = resolveClientLoggingConfig(
    clientLogging,
    resolvedConfig.clientLogging
  );
  const ingestionPath = resolvedClientLogging?.path ?? DEFAULT_CLIENT_LOG_ENDPOINT;
  const resolvedIgnorePaths = resolvedClientLogging
    ? Array.from(new Set([...(ignorePaths ?? []), ingestionPath]))
    : ignorePaths;

  return {
    logger,
    posthog: getPostHogSender(logger),
    resolvedConfig,
    level,
    pretty,
    logDir,
    file,
    autoLogging,
    customProps,
    logErrors,
    resolvedIgnorePaths,
    resolvedClientLogging,
    ingestionPath,
  };
}

export function shouldSkipAutoLogging<Ctx>(
  config: ResolvedServerLogger<Ctx>,
  ctx: Ctx,
  path: string
): boolean {
  if (config.autoLogging === false) {
    return true;
  }

  if (
    typeof config.autoLogging === 'object' &&
    config.autoLogging.ignore?.(ctx)
  ) {
    return true;
  }

  return shouldIgnorePath(path, config.resolvedIgnorePaths);
}

export function shouldSkipErrorLogging<Ctx>(
  config: ResolvedServerLogger<Ctx>,
  path: string
): boolean {
  if (!config.logErrors) {
    return true;
  }

  return shouldIgnorePath(path, config.resolvedIgnorePaths);
}

export function resolveAdditionalProps<Ctx>(
  config: ResolvedServerLogger<Ctx>,
  ctx: Ctx
): Record<string, unknown> {
  return config.customProps ? config.customProps(ctx) : {};
}

export function emitHttpRequestLog(
  logger: ResolvedServerLogger<unknown>['logger'],
  level: string,
  request: RequestLike,
  path: string,
  statusCode: number,
  responseTime: number,
  additionalProps: Record<string, unknown> = {}
): HttpRequestLog {
  const requestLogData = buildRequestLogData(
    request,
    'http_request',
    path,
    statusCode,
    responseTime,
    additionalProps
  );

  if (level === 'info') {
    logger.info(
      buildInfoLogMessage(request.method, statusCode, path, responseTime),
      requestLogData
    );
  } else {
    logger.info(
      buildVerboseLogMessage(request.method, statusCode, path, responseTime),
      requestLogData
    );
    if (Object.keys(additionalProps).length > 0) {
      logger.debug('Request context', additionalProps);
    }
  }

  return requestLogData;
}

export function emitHttpErrorLog(
  logger: ResolvedServerLogger<unknown>['logger'],
  level: string,
  request: RequestLike,
  path: string,
  statusCode: number,
  responseTime: number,
  error: ErrorLike | undefined,
  additionalProps: Record<string, unknown> = {}
): HttpRequestLog {
  const errorLogData = buildRequestLogData(
    request,
    'http_error',
    path,
    statusCode,
    responseTime,
    {
      error: error?.message ?? `HTTP ${statusCode}`,
      stack: error?.stack,
      code: error?.code,
      why: error?.why,
      fix: error?.fix,
      link: error?.link,
      details: error?.details,
      ...additionalProps,
    }
  );

  const message = level === 'info'
    ? buildInfoLogMessage(request.method, statusCode, path, responseTime)
    : buildVerboseLogMessage(request.method, statusCode, path, responseTime);
  logger.error(message, errorLogData);

  return errorLogData;
}

export async function parseClientLogPayload(
  request: RequestLike & { json?: () => Promise<unknown> },
  body?: unknown
): Promise<unknown> {
  if (body !== undefined) {
    if (typeof body === 'string') {
      return JSON.parse(body);
    }

    return body;
  }

  if (typeof request.json === 'function') {
    return await request.json();
  }

  throw new Error('Unable to parse client log payload');
}

function getClientLogMethod(
  logger: ResolvedServerLogger<unknown>['logger'],
  level: Exclude<ClientLogEvent['level'], 'table'>
): (message: unknown, ...args: unknown[]) => void {
  switch (level) {
    case 'debug':
      return logger.debug;
    case 'info':
      return logger.info;
    case 'warning':
      return logger.warning;
    case 'error':
      return logger.error;
    case 'critical':
      return logger.critical;
    case 'success':
      return logger.success;
  }
}

export async function handleClientLogIngestion<Ctx>(options: {
  config: ResolvedServerLogger<Ctx>;
  ctx: Ctx;
  request: RequestLike & { json?: () => Promise<unknown> };
  body?: unknown;
  deliveryPath?: string;
}): Promise<{ status: number; headers?: Record<string, string> }> {
  const { config, ctx, request, body, deliveryPath } = options;

  if (!config.resolvedClientLogging) {
    return { status: 404 };
  }

  let payload: unknown;
  try {
    payload = await parseClientLogPayload(request, body);
  } catch {
    return { status: 400 };
  }

  if (!isClientLogEvent(payload)) {
    return { status: 400 };
  }

  const isAllowed = config.resolvedClientLogging.validate
    ? await config.resolvedClientLogging.validate(ctx, payload)
    : true;
  if (!isAllowed) {
    return { status: 403 };
  }

  const serverContext = config.resolvedClientLogging.enrich
    ? await config.resolvedClientLogging.enrich(ctx, payload)
    : undefined;
  const structuredPayload: Record<string, unknown> = {
    ...payload,
    receivedAt: new Date().toISOString(),
    delivery: buildClientDetails(request, deliveryPath ?? extractPathname(request.url)),
  };

  if (serverContext !== undefined) {
    structuredPayload.serverContext = serverContext;
  }

  if (payload.level === 'table') {
    config.logger.table(`[client] ${payload.message}`, structuredPayload);
  } else {
    const logMethod = getClientLogMethod(config.logger, payload.level);
    logMethod(`[client] ${payload.message}`, structuredPayload);
  }

  const headers: Record<string, string> = {};
  if (payload.connector === 'posthog') {
    headers['x-blyp-posthog-status'] = config.posthog.ready ? 'enabled' : 'missing';

    if (config.posthog.ready) {
      config.posthog.send({
        timestamp: structuredPayload.receivedAt as string,
        level: payload.level,
        message: `[client] ${payload.message}`,
        data: structuredPayload,
      }, {
        source: 'client',
      });
    }
  }

  return Object.keys(headers).length > 0
    ? { status: 204, headers }
    : { status: 204 };
}

export async function readNodeRequestBody(
  stream: AsyncIterable<Uint8Array | string>
): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString('utf8');
}

export function buildAbsoluteUrl(
  path: string,
  headers?: RequestLike['headers']
): string {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }

  const protocol = getHeaderValue(headers, 'x-forwarded-proto') ?? 'http';
  const host = getHeaderValue(headers, 'host') ?? 'localhost';
  return `${protocol}://${host}${path.startsWith('/') ? path : `/${path}`}`;
}

export function resolveRequestStatus(
  ctx: ResolveLike,
  successCode: number = 200,
  errorCode: number = 500,
  isError: boolean = false
): number {
  return resolveStatusCode(
    {
      set: ctx.set,
      error: ctx.error
        ? {
            status: ctx.error.status,
            statusCode: ctx.error.statusCode,
            code: ctx.error.code === undefined ? undefined : String(ctx.error.code),
          }
        : undefined,
      code: ctx.code === undefined ? undefined : String(ctx.code),
    },
    successCode,
    errorCode,
    isError
  );
}

export {
  buildInfoLogMessage,
  buildRequestLogData,
  createRequestLike,
  extractPathname,
  isErrorStatus,
  toErrorLike,
} from './http';
