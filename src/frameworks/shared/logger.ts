import { DEFAULT_CLIENT_LOG_ENDPOINT, isClientLogEvent, normalizeEndpointPath } from '../../shared/client-log';
import type { ClientLogEvent } from '../../shared/client-log';
import {
  normalizeBetterAuthContext,
  withBetterAuthContextOverride,
} from '../../better-auth/normalize';
import {
  createSignedOutClerkContext,
} from '../../clerk/normalize';
import { resolveClerkAuthContext } from '../../clerk/integration';
import {
  normalizeWorkOsContext,
  withWorkOsContextOverride,
} from '../../workos/normalize';
import { extractWorkOsSessionCookie } from '../../workos/cookie';
import { resolveConfig } from '../../core/config';
import { getMethodColor, getResponseTimeColor, getStatusColor } from '../../core/colors';
import { resolveStatusCode, shouldIgnorePath } from '../../core/helpers';
import { buildPostHogExceptionProperties } from '../../connectors/posthog/properties';
import {
  createBaseLogger,
  getBetterStackSender,
  getDatabuddySender,
  getHttpRegistry,
  getOtlpRegistry,
  getPostHogSender,
  getRedactionConfig,
  getSentrySender,
  tryGetBetterStackSender,
  tryGetDatabuddySender,
  tryGetPostHogSender,
} from '../../core/logger';
import {
  sanitizeLogMessage,
  sanitizeLogValue,
} from '../../shared/redaction';
import { createWarnOnceLogger } from '../../shared/once';
import {
  buildClientDetails,
  buildInfoLogMessage,
  buildRequestLogData,
  getHeaderValue,
  extractPathname,
  isErrorStatus,
} from './http';
import type { ErrorLike, HttpRequestLog, RequestLike, ResolveLike } from '../../types/frameworks/http';
import type {
  AuthConfig,
  AuthLogContext,
  ClientLogIngestionConfig,
  ResolvedAuthProvider,
  ResolvedServerLogger,
  ServerLoggerConfig,
} from '../../types/frameworks/shared';
import type { HttpErrorCaptureContext } from '../../types/frameworks/request-logger';
import {
  getActiveRequestAuthContext,
  getActiveRequestTraceId,
  hasResolvedRequestAuth,
  markRequestAuthResolved,
  setActiveRequestAuthContext,
  setActiveRequestTraceId,
} from './request-context';
import type {
  BetterAuthIntegrationConfig,
  BetterAuthLogContext,
  BetterAuthResolveArgs,
  BetterAuthSessionEnvelope,
} from '../../types/better-auth';
import type { ClerkIntegrationConfig, ClerkLogContext } from '../../types/clerk';
import type { LegacyServerAuthConfig } from '../../types/auth';
import type {
  WorkOsAuthenticateResponse,
  WorkOsIntegrationConfig,
  WorkOsLogContext,
  WorkOsResolveArgs,
} from '../../types/workos';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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

const authResolutionWarnings = new Set<string>();
const warnAuthResolutionOnce = createWarnOnceLogger(authResolutionWarnings);

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

function isLegacyBetterAuthConfig<Ctx>(
  auth: AuthConfig<Ctx>
): auth is BetterAuthIntegrationConfig<Ctx> {
  const candidate = auth as Record<string, unknown>;
  if ('clerk' in candidate || 'workos' in candidate) {
    return false;
  }
  if (
    candidate.betterAuth &&
    typeof candidate.betterAuth === 'object' &&
    'betterAuth' in (candidate.betterAuth as object)
  ) {
    return false;
  }
  return true;
}

function resolveAuthConfig<Ctx>(
  auth: AuthConfig<Ctx> | undefined
): ResolvedAuthProvider<Ctx> | null {
  if (!auth) {
    return null;
  }

  if (isLegacyBetterAuthConfig(auth)) {
    return { provider: 'better-auth', config: auth };
  }

  const expanded = auth as {
    betterAuth?: BetterAuthIntegrationConfig<Ctx>;
    clerk?: ClerkIntegrationConfig<Ctx>;
    workos?: WorkOsIntegrationConfig<Ctx>;
  };

  if (expanded.betterAuth && expanded.workos && !expanded.clerk) {
    throw new Error(
      '[blyp] Cannot configure both Better Auth and WorkOS auth providers simultaneously. ' +
      'Please provide only one auth provider per logger instance.'
    );
  }

  const selectedProviders = [
    expanded.betterAuth
      ? ({
          provider: 'better-auth',
          config: expanded.betterAuth,
        } as const)
      : null,
    expanded.clerk
      ? ({
          provider: 'clerk',
          config: expanded.clerk,
        } as const)
      : null,
    expanded.workos
      ? ({
          provider: 'workos',
          config: expanded.workos,
        } as const)
      : null,
  ].filter((entry): entry is ResolvedAuthProvider<Ctx> => entry !== null);

  if (selectedProviders.length > 1) {
    throw new Error(
      '[blyp] Cannot configure multiple auth providers simultaneously. ' +
      'Please provide only one auth provider per logger instance.'
    );
  }

  if (expanded.clerk) {
    return { provider: 'clerk', config: expanded.clerk };
  }

  if (expanded.workos) {
    return { provider: 'workos', config: expanded.workos };
  }

  if (expanded.betterAuth) {
    return { provider: 'better-auth', config: expanded.betterAuth };
  }

  return null;
}

export function resolveServerLogger<Ctx>(
  config: ServerLoggerConfig<Ctx> = {},
  loggerOverride?: ReturnType<typeof createBaseLogger>
): ResolvedServerLogger<Ctx> {
  const resolvedConfig = resolveConfig({
    ...(config.level !== undefined ? { level: config.level } : {}),
    ...(config.pretty !== undefined ? { pretty: config.pretty } : {}),
    ...(config.destination !== undefined ? { destination: config.destination } : {}),
    ...(config.logDir !== undefined ? { logDir: config.logDir } : {}),
    ...(config.file !== undefined ? { file: config.file } : {}),
    ...(config.database !== undefined ? { database: config.database } : {}),
    ...(config.redact !== undefined ? { redact: config.redact } : {}),
    ...(config.connectors !== undefined ? { connectors: config.connectors } : {}),
  });
  const {
    level = resolvedConfig.level,
    pretty = resolvedConfig.pretty,
    destination = resolvedConfig.destination,
    logDir = resolvedConfig.logDir,
    file = resolvedConfig.file,
    database = resolvedConfig.database,
    autoLogging = true,
    customProps,
    logErrors = true,
    includePaths,
    ignorePaths,
    clientLogging,
    auth,
    connectors,
  } = config;
  const logger = loggerOverride ?? createBaseLogger({
    level,
    pretty,
    destination,
    logDir,
    file,
    database,
    connectors,
  });
  const resolvedClientLogging = resolveClientLoggingConfig(
    clientLogging,
    resolvedConfig.clientLogging
  );
  const ingestionPath = resolvedClientLogging?.path ?? DEFAULT_CLIENT_LOG_ENDPOINT;
  const resolvedIncludePaths = includePaths;
  const resolvedIgnorePaths = resolvedClientLogging
    ? Array.from(new Set([...(ignorePaths ?? []), ingestionPath]))
    : ignorePaths;

  return {
    logger,
    betterstack: getBetterStackSender(logger),
    databuddy: getDatabuddySender(logger),
    posthog: getPostHogSender(logger),
    sentry: getSentrySender(logger),
    http: getHttpRegistry(logger),
    otlp: getOtlpRegistry(logger),
    resolvedConfig,
    level,
    pretty,
    logDir,
    file,
    autoLogging,
    customProps,
    logErrors,
    resolvedIncludePaths,
    resolvedIgnorePaths,
    resolvedClientLogging,
    ingestionPath,
    resolvedAuth: resolveAuthConfig(auth),
  };
}

function hasHeaders(
  request: RequestLike | { headers?: Headers | Record<string, unknown> }
): request is RequestLike & { headers: Headers | Record<string, unknown> } {
  return request.headers !== undefined;
}

async function getBetterAuthSessionFromRequest<Ctx>(
  config: BetterAuthIntegrationConfig<Ctx>,
  request: RequestLike | { headers?: Headers | Record<string, unknown> }
): Promise<BetterAuthSessionEnvelope | null> {
  const getter = config.betterAuth?.api?.getSession;
  if (typeof getter !== 'function' || !hasHeaders(request)) {
    return null;
  }

  try {
    const session = await getter({
      headers: request.headers,
    });

    return session as BetterAuthSessionEnvelope | null;
  } catch {
    return null;
  }
}

async function resolveBetterAuthProvider<Ctx>(
  authConfig: BetterAuthIntegrationConfig<Ctx>,
  options: {
    ctx: Ctx;
    request: RequestLike | { headers?: Headers | Record<string, unknown> };
    source: 'request' | 'client_ingestion';
  }
): Promise<BetterAuthLogContext | null> {
  const session = await getBetterAuthSessionFromRequest(authConfig, options.request);
  let auth = normalizeBetterAuthContext(session, {
    includeClaims: authConfig.includeClaims,
    includeRawSession: authConfig.includeRawSession,
  });

  if (authConfig.enrich) {
    try {
      const extra = await authConfig.enrich({
        ctx: options.ctx,
        request: options.request,
        session,
        auth: authConfig.betterAuth,
        source: options.source,
      } as BetterAuthResolveArgs<Ctx>);
      auth = withBetterAuthContextOverride(auth, extra);
    } catch (error) {
      warnAuthResolutionOnce(
        'better-auth-enrich-failure',
        '[blyp] Better Auth enrich hook failed. Continuing with the normalized auth context.',
        error
      );
    }
  }

  return auth;
}

async function resolveClerkProvider<Ctx>(
  authConfig: ClerkIntegrationConfig<Ctx>,
  options: {
    ctx: Ctx;
    request: RequestLike | { headers?: Headers | Record<string, unknown> };
    source: 'request' | 'client_ingestion';
  }
): Promise<ClerkLogContext> {
  try {
    return await resolveClerkAuthContext(authConfig, {
      ctx: options.ctx,
      request: toWebRequest(options.request),
      source: options.source,
    });
  } catch (error) {
    warnAuthResolutionOnce(
      'clerk-auth-failure',
      '[blyp] Clerk auth resolution failed. Continuing with a signed-out Clerk auth context.',
      error
    );
    return createSignedOutClerkContext();
  }
}

function toWebRequest(
  request: RequestLike | { headers?: Headers | Record<string, unknown> }
): Request {
  if (request instanceof Request) {
    return request;
  }

  const headers = new Headers();
  const sourceHeaders = request.headers;
  if (sourceHeaders instanceof Headers) {
    sourceHeaders.forEach((value, key) => {
      headers.set(key, value);
    });
  } else if (sourceHeaders && typeof (sourceHeaders as { get?: unknown }).get === 'function') {
    const getter = sourceHeaders as { get(name: string): string | null };
    for (const name of ['authorization', 'cookie', 'host', 'origin', 'user-agent', 'x-forwarded-proto']) {
      const value = getter.get(name);
      if (value) {
        headers.set(name, value);
      }
    }
  } else if (isRecord(sourceHeaders)) {
    for (const [key, value] of Object.entries(sourceHeaders)) {
      if (Array.isArray(value)) {
        headers.set(key, value.join(', '));
      } else if (typeof value === 'string') {
        headers.set(key, value);
      }
    }
  }

  const requestLike = request as Partial<RequestLike>;
  return new Request(
    buildAbsoluteUrl(requestLike.url ?? '/', sourceHeaders as RequestLike['headers']),
    {
      method: requestLike.method ?? 'GET',
      headers,
    }
  );
}

async function resolveWorkOsProvider<Ctx>(
  authConfig: WorkOsIntegrationConfig<Ctx>,
  options: {
    ctx: Ctx;
    request: RequestLike | { headers?: Headers | Record<string, unknown> };
    source: 'request' | 'client_ingestion';
  }
): Promise<WorkOsLogContext | null> {
  const headers = hasHeaders(options.request) ? options.request.headers : undefined;
  const cookieName = authConfig.cookieName ?? 'wos-session';
  const sessionCookie = extractWorkOsSessionCookie(
    headers as Headers | Record<string, unknown> | undefined,
    cookieName
  );

  let authResponse: WorkOsAuthenticateResponse | null = null;

  if (sessionCookie) {
    const loader = authConfig.workos?.userManagement?.loadSealedSession;
    if (typeof loader === 'function') {
      try {
        const sealedSession = loader({
          sessionData: sessionCookie,
          cookiePassword: authConfig.cookiePassword,
        });
        authResponse = await sealedSession.authenticate();
      } catch (error) {
        warnAuthResolutionOnce(
          'workos-session-failure',
          '[blyp] WorkOS sealed session authentication failed. Continuing without auth context.',
          error
        );
      }
    }
  }

  let auth = normalizeWorkOsContext(authResponse, {
    includeClaims: authConfig.includeClaims,
    includeRawSession: authConfig.includeRawSession,
  });

  if (authConfig.enrich) {
    try {
      const extra = await authConfig.enrich({
        ctx: options.ctx,
        request: options.request,
        sessionCookie,
        authResponse,
        workos: authConfig.workos,
        source: options.source,
      } as WorkOsResolveArgs<Ctx>);
      auth = withWorkOsContextOverride(auth, extra);
    } catch (error) {
      warnAuthResolutionOnce(
        'workos-enrich-failure',
        '[blyp] WorkOS enrich hook failed. Continuing with the normalized auth context.',
        error
      );
    }
  }

  return auth;
}

export async function resolveRequestAuthContext<Ctx>(options: {
  config: ResolvedServerLogger<Ctx>;
  ctx: Ctx;
  request: RequestLike | { headers?: Headers | Record<string, unknown> };
  source: 'request' | 'client_ingestion';
}): Promise<AuthLogContext | null> {
  try {
    const existing = getActiveRequestAuthContext();
    if (existing !== undefined || hasResolvedRequestAuth()) {
      return existing ?? null;
    }

    const resolved = options.config.resolvedAuth;
    if (!resolved) {
      markRequestAuthResolved();
      return null;
    }

    let auth: AuthLogContext | null = null;

    switch (resolved.provider) {
      case 'better-auth':
        auth = await resolveBetterAuthProvider(resolved.config, {
          ctx: options.ctx,
          request: options.request,
          source: options.source,
        });
        break;
      case 'clerk':
        auth = await resolveClerkProvider(resolved.config, {
          ctx: options.ctx,
          request: options.request,
          source: options.source,
        });
        break;
      case 'workos':
        auth = await resolveWorkOsProvider(resolved.config, {
          ctx: options.ctx,
          request: options.request,
          source: options.source,
        });
        break;
    }

    setActiveRequestAuthContext(auth);
    return auth;
  } catch (error) {
    warnAuthResolutionOnce(
      'auth-resolution-failure',
      '[blyp] Auth context resolution failed. Continuing without auth context.',
      error
    );
    setActiveRequestAuthContext(null);
    return null;
  }
}

export function getCurrentRequestAuthContext(): AuthLogContext | null {
  return getActiveRequestAuthContext() ?? null;
}

export function isIncludedPath(
  path: string,
  includePaths?: string[]
): boolean {
  if (!includePaths || includePaths.length === 0) {
    return true;
  }

  return shouldIgnorePath(path, includePaths);
}

export function shouldSkipPath(
  path: string,
  includePaths?: string[],
  ignorePaths?: string[]
): boolean {
  if (!isIncludedPath(path, includePaths)) {
    return true;
  }

  return shouldIgnorePath(path, ignorePaths);
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

  return shouldSkipPath(path, config.resolvedIncludePaths, config.resolvedIgnorePaths);
}

export function shouldSkipErrorLogging<Ctx>(
  config: ResolvedServerLogger<Ctx>,
  path: string
): boolean {
  if (!config.logErrors) {
    return true;
  }

  return shouldSkipPath(path, config.resolvedIncludePaths, config.resolvedIgnorePaths);
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
    additionalProps,
    getRedactionConfig(logger)
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
  additionalProps: Record<string, unknown> = {},
  captureContext: HttpErrorCaptureContext = {}
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
    },
    getRedactionConfig(logger)
  );

  const message = level === 'info'
    ? buildInfoLogMessage(request.method, statusCode, path, responseTime)
    : buildVerboseLogMessage(request.method, statusCode, path, responseTime);
  logger.error(message, errorLogData);

  const posthog = tryGetPostHogSender(logger);
  if (posthog?.shouldAutoCaptureExceptions()) {
    posthog.captureException(captureContext.error ?? error ?? message, {
      source: 'server',
      warnIfUnavailable: true,
      distinctId:
        captureContext.distinctId ??
        getHeaderValue(request.headers, 'x-posthog-distinct-id'),
      properties: buildPostHogExceptionProperties(
        {
          timestamp: new Date().toISOString(),
          level: 'error',
          message,
          data: errorLogData,
        },
        'server',
        {
          $request_method: request.method,
          $request_path: path,
          $current_url: request.url,
          $response_status_code: statusCode,
          ...(getHeaderValue(request.headers, 'user-agent')
            ? { $user_agent: getHeaderValue(request.headers, 'user-agent') }
            : {}),
          ...(errorLogData.ip ? { $ip: errorLogData.ip } : {}),
        }
      ),
    });
  }

  const betterstack = tryGetBetterStackSender(logger);
  if (betterstack?.shouldAutoCaptureExceptions()) {
    betterstack.captureException(captureContext.error ?? error ?? message, {
      source: 'server',
      warnIfUnavailable: true,
      context: {
        timestamp: new Date().toISOString(),
        level: 'error',
        message,
        status: statusCode,
        path,
        data: errorLogData,
      },
    });
  }

  const databuddy = tryGetDatabuddySender(logger);
  if (databuddy?.shouldAutoCaptureExceptions()) {
    databuddy.captureException(captureContext.error ?? error ?? message, {
      source: 'server',
      warnIfUnavailable: true,
      properties: {
        method: request.method,
        path,
        status_code: statusCode,
        ...(request.url ? { current_url: request.url } : {}),
        ...(getHeaderValue(request.headers, 'user-agent')
          ? { user_agent: getHeaderValue(request.headers, 'user-agent') }
          : {}),
        ...(errorLogData.ip ? { ip: errorLogData.ip } : {}),
        payload: errorLogData,
      },
    });
  }

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

  await resolveRequestAuthContext({
    config,
    ctx,
    request,
    source: 'client_ingestion',
  });

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
  const redaction = getRedactionConfig(config.logger);
  const sanitizedPayload = sanitizeLogValue(payload, redaction) as ClientLogEvent;
  const structuredPayload = sanitizeLogValue({
    ...sanitizedPayload,
    receivedAt: new Date().toISOString(),
    delivery: buildClientDetails(request, deliveryPath ?? extractPathname(request.url), redaction),
  }, redaction) as Record<string, unknown>;

  if (serverContext !== undefined) {
    structuredPayload.serverContext = sanitizeLogValue(serverContext, redaction);
  }

  const requestAuth = getCurrentRequestAuthContext();
  if (requestAuth) {
    structuredPayload.serverContext = sanitizeLogValue({
      ...(structuredPayload.serverContext && typeof structuredPayload.serverContext === 'object'
        ? structuredPayload.serverContext as Record<string, unknown>
        : {}),
      auth: requestAuth,
    }, redaction);
  }

  const clientMessage = sanitizeLogMessage(`[client] ${sanitizedPayload.message}`, redaction);
  const serverTraceId = getActiveRequestTraceId();
  const recordTraceId =
    typeof sanitizedPayload.traceId === 'string' && sanitizedPayload.traceId.length > 0
      ? sanitizedPayload.traceId
      : serverTraceId;

  try {
    if (recordTraceId) {
      setActiveRequestTraceId(recordTraceId);
    }

    if (sanitizedPayload.level === 'table') {
      config.logger.table(clientMessage, structuredPayload);
    } else {
      const logMethod = getClientLogMethod(config.logger, sanitizedPayload.level);
      logMethod(clientMessage, structuredPayload);
    }
  } finally {
    setActiveRequestTraceId(serverTraceId);
  }

  const headers: Record<string, string> = {};
  if (sanitizedPayload.connector === 'betterstack') {
    headers['x-blyp-betterstack-status'] = config.betterstack.ready ? 'enabled' : 'missing';

    if (config.betterstack.ready) {
      const forwardedRecord = {
        timestamp: structuredPayload.receivedAt as string,
        level: sanitizedPayload.level,
        message: clientMessage,
        data: structuredPayload,
      };

      config.betterstack.send(forwardedRecord, {
        source: 'client',
      });

      if (
        (sanitizedPayload.level === 'error' || sanitizedPayload.level === 'critical') &&
        config.betterstack.shouldAutoCaptureExceptions()
      ) {
        const clientErrorCandidate =
          sanitizedPayload.data &&
          typeof sanitizedPayload.data === 'object' &&
          !Array.isArray(sanitizedPayload.data) &&
          typeof (sanitizedPayload.data as Record<string, unknown>).message === 'string'
            ? sanitizedPayload.data
            : sanitizedPayload.message;

        config.betterstack.captureException(clientErrorCandidate, {
          source: 'client',
          warnIfUnavailable: true,
          context: {
            sessionId: sanitizedPayload.session.sessionId,
            pageUrl: sanitizedPayload.page.url,
            pagePath: sanitizedPayload.page.pathname,
            metadata: sanitizedPayload.metadata,
            payload: structuredPayload,
          },
        });
      }
    }
  } else if (sanitizedPayload.connector === 'databuddy') {
    headers['x-blyp-databuddy-status'] = config.databuddy.ready ? 'enabled' : 'missing';

    if (config.databuddy.ready) {
      const forwardedRecord = {
        timestamp: structuredPayload.receivedAt as string,
        level: sanitizedPayload.level,
        message: clientMessage,
        data: structuredPayload,
      };

      config.databuddy.send(forwardedRecord, {
        source: 'client',
      });

      if (
        (sanitizedPayload.level === 'error' || sanitizedPayload.level === 'critical') &&
        config.databuddy.shouldAutoCaptureExceptions()
      ) {
        const clientErrorCandidate =
          sanitizedPayload.data &&
          typeof sanitizedPayload.data === 'object' &&
          !Array.isArray(sanitizedPayload.data) &&
          typeof (sanitizedPayload.data as Record<string, unknown>).message === 'string'
            ? sanitizedPayload.data
            : sanitizedPayload.message;

        config.databuddy.captureException(clientErrorCandidate, {
          source: 'client',
          warnIfUnavailable: true,
          sessionId: sanitizedPayload.session.sessionId,
          properties: {
            page_url: sanitizedPayload.page.url,
            page_path: sanitizedPayload.page.pathname,
            client_runtime: sanitizedPayload.device?.runtime,
            metadata: sanitizedPayload.metadata,
            payload: structuredPayload,
          },
        });
      }
    }
  } else if (sanitizedPayload.connector === 'posthog') {
    headers['x-blyp-posthog-status'] = config.posthog.ready ? 'enabled' : 'missing';

    if (config.posthog.ready) {
      const forwardedRecord = {
        timestamp: structuredPayload.receivedAt as string,
        level: sanitizedPayload.level,
        message: clientMessage,
        data: structuredPayload,
      };

      config.posthog.send(forwardedRecord, {
        source: 'client',
      });

      if (
        (sanitizedPayload.level === 'error' || sanitizedPayload.level === 'critical') &&
        config.posthog.shouldAutoCaptureExceptions()
      ) {
        const metadata = structuredPayload.metadata;
        const posthogDistinctId =
          metadata &&
          typeof metadata === 'object' &&
          !Array.isArray(metadata) &&
          typeof (metadata as Record<string, unknown>).posthogDistinctId === 'string' &&
          (metadata as Record<string, unknown>).posthogDistinctId
            ? String((metadata as Record<string, unknown>).posthogDistinctId)
            : undefined;

        const clientErrorCandidate =
          sanitizedPayload.data &&
          typeof sanitizedPayload.data === 'object' &&
          !Array.isArray(sanitizedPayload.data) &&
          typeof (sanitizedPayload.data as Record<string, unknown>).message === 'string'
            ? sanitizedPayload.data
            : sanitizedPayload.message;

        config.posthog.captureException(clientErrorCandidate, {
          source: 'client',
          warnIfUnavailable: true,
          distinctId: posthogDistinctId,
          properties: buildPostHogExceptionProperties(forwardedRecord, 'client', {
            $session_id: sanitizedPayload.session.sessionId,
            $current_url: sanitizedPayload.page.url,
            $request_path: sanitizedPayload.page.pathname,
            'client.runtime': sanitizedPayload.device?.runtime,
            'client.metadata': sanitizedPayload.metadata,
          }),
        });
      }
    }
  } else if (sanitizedPayload.connector === 'sentry') {
    headers['x-blyp-sentry-status'] = config.sentry.ready ? 'enabled' : 'missing';

    if (config.sentry.ready) {
      config.sentry.send({
        timestamp: structuredPayload.receivedAt as string,
        level: sanitizedPayload.level,
        message: clientMessage,
        data: structuredPayload,
      }, {
        source: 'client',
      });
    }
  } else if (sanitizedPayload.connector?.type === 'otlp') {
    const sender = config.otlp.get(sanitizedPayload.connector.name);

    headers['x-blyp-otlp-status'] = sender.ready ? 'enabled' : 'missing';

    if (sender.ready) {
      sender.send({
        timestamp: structuredPayload.receivedAt as string,
        level: sanitizedPayload.level,
        message: clientMessage,
        data: structuredPayload,
      }, {
        source: 'client',
      });
    }
  } else if (sanitizedPayload.connector?.type === 'http') {
    const sender = config.http.get(sanitizedPayload.connector.name);

    headers['x-blyp-http-status'] = sender.ready ? 'enabled' : 'missing';

    if (sender.ready) {
      sender.send({
        timestamp: structuredPayload.receivedAt as string,
        level: sanitizedPayload.level,
        message: clientMessage,
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

export function shouldAutoFlushServerLogger<Ctx>(
  config: ResolvedServerLogger<Ctx>
): boolean {
  return config.resolvedConfig.destination === 'database';
}

export async function flushServerLoggerSafely<Ctx>(
  config: ResolvedServerLogger<Ctx>
): Promise<void> {
  if (!shouldAutoFlushServerLogger(config)) {
    return;
  }

  try {
    await config.logger.flush();
  } catch (error) {
    console.warn('[Blyp] Warning: Failed to flush database logs.', error);
  }
}

export {
  buildInfoLogMessage,
  buildRequestLogData,
  createRequestLike,
  extractPathname,
  isErrorStatus,
  toErrorLike,
} from './http';
