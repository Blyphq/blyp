import { logger } from './frameworks/standalone';
import { getActiveRequestLogger } from './frameworks/shared/request-context';
import type { StructuredLog } from './core/structured-log';

export { createBaseLogger, CUSTOM_LEVELS } from './core/logger';
export type { BlypLogger } from './core/logger';
export type {
  StructuredLog,
  StructuredLogEmitOptions,
  StructuredLogError,
  StructuredLogEvent,
  StructuredLogLevel,
  StructuredLogPayload,
} from './core/structured-log';
export {
  BlypError,
  parseError,
} from './shared/errors';
export type {
  BlypErrorLike,
  BlypErrorCode,
  BlypErrorCodeDefinition,
  ErrorLogLevel,
  ErrorLoggerLike,
  ParseErrorOptions,
  ParseableErrorPayload,
} from './shared/errors';
export {
  HTTP_CODES,
  createError,
  getHttpCode,
} from './core/errors';
export type {
  CreateErrorInput,
  CreateErrorOverrides,
} from './core/errors';
export { runtime, createRuntimeAdapter, createLogDir } from './core/runtime';
export {
  DEFAULT_CONFIG,
  DEFAULT_CLIENT_LOGGING_CONFIG,
  DEFAULT_DATABASE_DELIVERY_CONFIG,
  DEFAULT_DATABASE_RETRY_CONFIG,
  DEFAULT_FILE_CONFIG,
  DEFAULT_ROTATION_CONFIG,
  getConfig,
  loadConfig,
  mergeBlypConfig,
  resolveConfig,
  resetConfigCache,
} from './core/config';
export type {
  BlypConnectorsConfig,
  ClientLoggingConfig,
  BlypConfig,
  BetterStackConnectorConfig,
  BetterStackErrorTrackingConfig,
  BlypDestination,
  ConnectorMode,
  DatabuddyConnectorConfig,
  DatabaseAdapterConfig,
  DatabaseAdapterKind,
  DatabaseDeliveryConfig,
  DatabaseDialect,
  DatabaseLoggerConfig,
  DatabaseRetryConfig,
  DrizzleDatabaseAdapterConfig,
  LogFileConfig,
  LogRotationConfig,
  OTLPConnectorConfig,
  PostHogErrorTrackingConfig,
  PostHogConnectorConfig,
  PrismaDatabaseAdapterConfig,
  ResolvedBlypConfig,
  ResolvedBetterStackConnectorConfig,
  ResolvedDatabuddyConnectorConfig,
  ResolvedDatabaseDeliveryConfig,
  ResolvedDatabaseLoggerConfig,
  ResolvedDatabaseRetryConfig,
  ResolvedPostHogErrorTrackingConfig,
  ResolvedPostHogConnectorConfig,
  ResolvedSentryConnectorConfig,
  ResolvedOTLPConnectorConfig,
  SentryConnectorConfig,
} from './core/config';
export { readLogFile, formatLogRecord } from './core/log-reader';
export type { ReadLogFileOptions } from './core/log-reader';
export type { LogRecord } from './core/file-logger';
export {
  createDrizzleDatabaseAdapter,
  createPrismaDatabaseAdapter,
} from './database';
export * from './core/helpers';
export * from './core/colors';
export { normalizeOTLPRecord } from './connectors/otlp/sender';
export {
  captureBetterStackException,
  createBetterStackErrorTracker,
  createBetterStackLogger,
  createStructuredBetterStackLogger,
} from './connectors/betterstack';
export type {
  BetterStackErrorTracker,
  BetterStackExceptionCaptureOptions,
  BetterStackLogger,
  BetterStackLoggerConfig,
} from './connectors/betterstack';
export {
  captureDatabuddyException,
  createDatabuddyErrorTracker,
  createDatabuddyLogger,
  createStructuredDatabuddyLogger,
} from './connectors/databuddy';
export type {
  DatabuddyErrorTracker,
  DatabuddyExceptionCaptureOptions,
  DatabuddyLogger,
  DatabuddyLoggerConfig,
} from './connectors/databuddy';
export {
  capturePosthogException,
  createPosthogErrorTracker,
  createPosthogLogger,
  createStructuredPosthogLogger,
} from './connectors/posthog';
export type {
  PostHogErrorTracker,
  PostHogExceptionCaptureOptions,
  PostHogLogger,
  PostHogLoggerConfig,
} from './connectors/posthog';
export { createSentryLogger, createStructuredSentryLogger } from './connectors/sentry';
export type { SentryLogger, SentryLoggerConfig } from './connectors/sentry';
export { logger, createStandaloneLogger } from './frameworks/standalone';
export type { StandaloneLogger, StandaloneLoggerConfig } from './frameworks/standalone';
export { createElysiaLogger, createLogger } from './frameworks/elysia';
export type {
  ElysiaContext,
  ElysiaClientLogIngestionConfig,
  ElysiaLoggerConfig,
  ResolveCtx,
  HttpRequestLog,
} from './frameworks/elysia';
export { createHonoLogger } from './frameworks/hono';
export type {
  HonoClientLogIngestionConfig,
  HonoLoggerConfig,
  HonoLoggerMiddleware,
  HonoLoggerVariables,
} from './frameworks/hono';
export {
  createExpressErrorLogger,
  createExpressLogger,
} from './frameworks/express';
export type {
  ExpressClientLogIngestionConfig,
  ExpressErrorLoggerMiddleware,
  ExpressLoggerConfig,
  ExpressLoggerContext,
  ExpressLoggerMiddleware,
} from './frameworks/express';
export { createFastifyLogger } from './frameworks/fastify';
export type {
  FastifyClientLogIngestionConfig,
  FastifyLoggerConfig,
  FastifyLoggerContext,
  FastifyLoggerPlugin,
} from './frameworks/fastify';
export { createNextJsLogger } from './frameworks/nextjs';
export type {
  NextJsClientLogIngestionConfig,
  NextJsHandlerWithLogger,
  NextJsLoggerConfig,
  NextJsLoggerContext,
  NextJsLoggerFactory,
  NextJsLoggerHelpers,
  NextJsRouteContext,
  NextJsWrappedHandler,
} from './frameworks/nextjs';
export { createReactRouterLogger } from './frameworks/react-router';
export type {
  ReactRouterClientLogIngestionConfig,
  ReactRouterContextStore,
  ReactRouterLoggerConfig,
  ReactRouterLoggerContext,
  ReactRouterLoggerFactory,
  ReactRouterLoggerMiddleware,
  ReactRouterMiddlewareArgs,
  ReactRouterMiddlewareNext,
} from './frameworks/react-router';
export { createTanStackStartLogger } from './frameworks/tanstack-start';
export type {
  TanStackStartClientLogHandlers,
  TanStackStartClientLogIngestionConfig,
  TanStackStartLoggerConfig,
  TanStackStartLoggerContext,
  TanStackStartLoggerFactory,
  TanStackStartMiddlewareContext,
} from './frameworks/tanstack-start';
export { createSvelteKitLogger } from './frameworks/sveltekit';
export type {
  SvelteKitClientLogIngestionConfig,
  SvelteKitHandle,
  SvelteKitLoggerConfig,
  SvelteKitLoggerContext,
  SvelteKitLoggerFactory,
  SvelteKitLocals,
  SvelteKitRequestEvent,
  SvelteKitRequestHandler,
  SvelteKitResolve,
} from './frameworks/sveltekit';
export { createAstroLogger } from './frameworks/astro';
export type {
  AstroClientLogIngestionConfig,
  AstroEndpointContext,
  AstroEndpointHandler,
  AstroLocals,
  AstroLoggerConfig,
  AstroLoggerContext,
  AstroLoggerFactory,
  AstroMiddlewareContext,
  AstroMiddlewareHandler,
  AstroMiddlewareNext,
} from './frameworks/astro';
export { createNitroLogger } from './frameworks/nitro';
export type {
  NitroAppLike,
  NitroClientLogIngestionConfig,
  NitroEventContext,
  NitroEventHandler,
  NitroEventLike,
  NitroHooksLike,
  NitroLoggerConfig,
  NitroLoggerContext,
  NitroLoggerFactory,
  NitroLoggerPlugin,
  NitroNodeLike,
  NitroNodeRequestLike,
  NitroNodeResponseLike,
  NitroResponseLike,
} from './frameworks/nitro';
export { createNuxtLogger } from './frameworks/nuxt';
export type {
  NuxtClientLogIngestionConfig,
  NuxtEventHandler,
  NuxtEventLike,
  NuxtLoggerConfig,
  NuxtLoggerContext,
  NuxtLoggerFactory,
  NuxtLoggerPlugin,
} from './frameworks/nuxt';
export { createNestLogger, BlypModule } from './frameworks/nestjs';
export type {
  NestAdapterType,
  NestClientLogIngestionConfig,
  NestLoggerConfig,
  NestLoggerContext,
} from './frameworks/nestjs';
export type {
  ClientLoggerConfig,
  ClientConnectorRequest,
  ClientLogBrowserContext,
  ClientLogDeviceContext,
  ClientLogEvent,
  ClientLogLevel,
  ClientLogPageContext,
  RemoteDeliveryConfig,
  RemoteDeliveryDropContext,
  RemoteDeliveryFailureContext,
  RemoteDeliveryFailureReason,
  RemoteDeliveryRetryContext,
  RemoteDeliverySuccessContext,
} from './frameworks/client';
export type {
  ExpoLogger,
  ExpoLoggerConfig,
} from './types/frameworks/expo';
export {
  createOtlpLogger,
  createStructuredOtlpLogger,
} from './connectors/otlp';
export type {
  OTLPLogger,
  OTLPLoggerConfig,
} from './connectors/otlp';

export function createStructuredLog<
  TFields extends Record<string, unknown> = Record<string, unknown>,
>(groupId: string, initial?: TFields): StructuredLog<TFields> {
  const activeLogger = getActiveRequestLogger() ?? logger;
  return activeLogger.createStructuredLog(groupId, initial) as StructuredLog<TFields>;
}
