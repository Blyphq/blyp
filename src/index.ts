import { logger } from './frameworks/standalone';
import { loadOptionalModule } from './core/optional-module';
import { getActiveRequestLogger } from './frameworks/shared/request-context';
import type { StructuredLog } from './core/structured-log';
import type { ResolvedOTLPConnectorConfig } from './core/config';
import type { LogRecord } from './core/file-logger';
import type {
  BetterStackErrorTracker,
  BetterStackExceptionCaptureOptions,
  BetterStackLogger,
  BetterStackLoggerConfig,
} from './types/connectors/betterstack';
import type {
  DatabuddyErrorTracker,
  DatabuddyExceptionCaptureOptions,
  DatabuddyLogger,
  DatabuddyLoggerConfig,
} from './types/connectors/databuddy';
import type {
  OTLPLogger,
  OTLPLoggerConfig,
  OTLPNormalizedRecord,
  OTLPLogSource,
} from './types/connectors/otlp';
import type {
  PostHogErrorTracker,
  PostHogExceptionCaptureOptions,
  PostHogLogger,
  PostHogLoggerConfig,
} from './types/connectors/posthog';
import type {
  SentryLogger,
  SentryLoggerConfig,
} from './types/connectors/sentry';
import type { StandaloneLogger } from './types/frameworks/standalone';
import type { FastifyLoggerPlugin, FastifyLoggerConfig } from './types/frameworks/fastify';
import type { ElysiaLoggerConfig } from './types/frameworks/elysia';
import type { NestLoggerConfig } from './types/frameworks/nestjs';

interface BetterStackConnectorModule {
  createBetterStackLogger: (config?: BetterStackLoggerConfig) => BetterStackLogger;
  createBetterStackErrorTracker: (config?: BetterStackLoggerConfig) => BetterStackErrorTracker;
  captureBetterStackException: (
    error: unknown,
    options?: BetterStackExceptionCaptureOptions,
    config?: BetterStackLoggerConfig
  ) => void;
  createStructuredBetterStackLogger: <TFields extends Record<string, unknown> = Record<string, unknown>>(
    groupId: string,
    initial?: TFields,
    config?: BetterStackLoggerConfig
  ) => StructuredLog<TFields>;
}

interface DatabuddyConnectorModule {
  createDatabuddyLogger: (config?: DatabuddyLoggerConfig) => DatabuddyLogger;
  createDatabuddyErrorTracker: (config?: DatabuddyLoggerConfig) => DatabuddyErrorTracker;
  captureDatabuddyException: (
    error: unknown,
    options?: DatabuddyExceptionCaptureOptions,
    config?: DatabuddyLoggerConfig
  ) => void;
  createStructuredDatabuddyLogger: <TFields extends Record<string, unknown> = Record<string, unknown>>(
    groupId: string,
    initial?: TFields,
    config?: DatabuddyLoggerConfig
  ) => StructuredLog<TFields>;
}

interface PostHogConnectorModule {
  createPosthogLogger: (config?: PostHogLoggerConfig) => PostHogLogger;
  createPosthogErrorTracker: (config?: PostHogLoggerConfig) => PostHogErrorTracker;
  capturePosthogException: (
    error: unknown,
    options?: PostHogExceptionCaptureOptions,
    config?: PostHogLoggerConfig
  ) => void;
  createStructuredPosthogLogger: <TFields extends Record<string, unknown> = Record<string, unknown>>(
    groupId: string,
    initial?: TFields,
    config?: PostHogLoggerConfig
  ) => StructuredLog<TFields>;
}

interface OTLPConnectorModule {
  createOtlpLogger: (config?: OTLPLoggerConfig) => OTLPLogger;
  createStructuredOtlpLogger: <TFields extends Record<string, unknown> = Record<string, unknown>>(
    groupId: string,
    initial?: TFields,
    config?: OTLPLoggerConfig
  ) => StructuredLog<TFields>;
  normalizeOTLPRecord: (
    record: LogRecord,
    connector: ResolvedOTLPConnectorConfig,
    source?: OTLPLogSource
  ) => OTLPNormalizedRecord;
}

interface SentryConnectorModule {
  createSentryLogger: (config?: SentryLoggerConfig) => SentryLogger;
  createStructuredSentryLogger: <TFields extends Record<string, unknown> = Record<string, unknown>>(
    groupId: string,
    initial?: TFields,
    config?: SentryLoggerConfig
  ) => StructuredLog<TFields>;
}

interface ElysiaFrameworkModule {
  createElysiaLogger: (config?: ElysiaLoggerConfig) => unknown;
  createLogger: (config?: ElysiaLoggerConfig) => unknown;
}

interface FastifyFrameworkModule {
  createFastifyLogger: (config?: FastifyLoggerConfig) => FastifyLoggerPlugin;
}

interface NestFrameworkModule {
  createNestLogger: (config?: NestLoggerConfig) => StandaloneLogger;
  BlypModule: object;
}

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
  DEFAULT_CONNECTOR_DELIVERY_CONFIG,
  DEFAULT_CONNECTOR_RETRY_CONFIG,
  DEFAULT_DATABASE_DELIVERY_CONFIG,
  DEFAULT_DATABASE_RETRY_CONFIG,
  DEFAULT_FILE_CONFIG,
  DEFAULT_REDACTION_CONFIG,
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
  ConnectorDeliveryConfig,
  ConnectorRetryConfig,
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
  RedactionConfig,
  ResolvedBlypConfig,
  ResolvedBetterStackConnectorConfig,
  ResolvedConnectorDeliveryConfig,
  ResolvedConnectorRetryConfig,
  ResolvedDatabuddyConnectorConfig,
  ResolvedDatabaseDeliveryConfig,
  ResolvedDatabaseLoggerConfig,
  ResolvedDatabaseRetryConfig,
  ResolvedPostHogErrorTrackingConfig,
  ResolvedPostHogConnectorConfig,
  ResolvedRedactionConfig,
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
export type {
  BetterStackErrorTracker,
  BetterStackExceptionCaptureOptions,
  BetterStackLogger,
  BetterStackLoggerConfig,
} from './types/connectors/betterstack';
export type {
  DatabuddyErrorTracker,
  DatabuddyExceptionCaptureOptions,
  DatabuddyLogger,
  DatabuddyLoggerConfig,
} from './types/connectors/databuddy';
export type {
  PostHogErrorTracker,
  PostHogExceptionCaptureOptions,
  PostHogLogger,
  PostHogLoggerConfig,
} from './types/connectors/posthog';
export type { SentryLogger, SentryLoggerConfig } from './types/connectors/sentry';
export { logger, createStandaloneLogger } from './frameworks/standalone';
export type { StandaloneLogger, StandaloneLoggerConfig } from './frameworks/standalone';
export type {
  ElysiaContext,
  ElysiaClientLogIngestionConfig,
  ElysiaLoggerConfig,
  ResolveCtx,
  HttpRequestLog,
} from './types/frameworks/elysia';
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
export type {
  FastifyClientLogIngestionConfig,
  FastifyLoggerConfig,
  FastifyLoggerContext,
  FastifyLoggerPlugin,
} from './types/frameworks/fastify';
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
export type {
  NestAdapterType,
  NestClientLogIngestionConfig,
  NestLoggerConfig,
  NestLoggerContext,
} from './types/frameworks/nestjs';
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
export type {
  OTLPLogger,
  OTLPLoggerConfig,
} from './types/connectors/otlp';
export { wrapOpenAI, createOpenAITracker } from './ai/openai';
export { wrapAnthropic } from './ai/anthropic';
export { blypFetch } from './ai/shared/fetch';
export type {
  AIToolCallRecord,
  BlypAIProvider,
  BlypAISDK,
  BlypCaptureOptions,
  BlypExcludeOptions,
  BlypLimitOptions,
  BlypLLMEventPart,
  BlypLLMTrace,
  BlypProviderOptions,
  BlypSDKContext,
} from './ai/shared/types';

export function createStructuredLog<
  TFields extends Record<string, unknown> = Record<string, unknown>,
>(groupId: string, initial?: TFields): StructuredLog<TFields> {
  const activeLogger = getActiveRequestLogger() ?? logger;
  return activeLogger.createStructuredLog(groupId, initial) as StructuredLog<TFields>;
}

export function createElysiaLogger(config: ElysiaLoggerConfig = {}) {
  return loadElysiaModule().createElysiaLogger(config);
}

export function createLogger(config: ElysiaLoggerConfig = {}) {
  return loadElysiaModule().createLogger(config);
}

export function createFastifyLogger(
  config: FastifyLoggerConfig = {}
): FastifyLoggerPlugin {
  return loadFastifyModule().createFastifyLogger(config);
}

export function createNestLogger(
  config: NestLoggerConfig = {}
): StandaloneLogger {
  return loadNestModule().createNestLogger(config);
}

export const BlypModule = new Proxy(function BlypModuleProxy() {}, {
  get(_target, property, receiver) {
    return Reflect.get(loadNestModule().BlypModule, property, receiver);
  },
  construct(_target, args, newTarget) {
    return Reflect.construct(
      loadNestModule().BlypModule as new (...input: unknown[]) => unknown,
      args,
      newTarget
    );
  },
}) as unknown;

function loadBetterStackModule() {
  return loadOptionalModule<BetterStackConnectorModule>(
    'betterstack',
    ['@logtail/node', '@sentry/node']
  );
}

function loadDatabuddyModule() {
  return loadOptionalModule<DatabuddyConnectorModule>(
    'databuddy',
    ['@databuddy/sdk']
  );
}

function loadPosthogModule() {
  return loadOptionalModule<PostHogConnectorModule>(
    'posthog',
    [
      'posthog-node',
      '@opentelemetry/api-logs',
      '@opentelemetry/exporter-logs-otlp-http',
      '@opentelemetry/resources',
      '@opentelemetry/sdk-logs',
    ]
  );
}

function loadOtlpModule() {
  return loadOptionalModule<OTLPConnectorModule>(
    'otlp',
    [
      '@opentelemetry/api-logs',
      '@opentelemetry/exporter-logs-otlp-http',
      '@opentelemetry/resources',
      '@opentelemetry/sdk-logs',
    ]
  );
}

function loadSentryModule() {
  return loadOptionalModule<SentryConnectorModule>(
    'sentry',
    ['@sentry/node']
  );
}

function loadElysiaModule() {
  return loadOptionalModule<ElysiaFrameworkModule>(
    'elysia',
    ['elysia']
  );
}

function loadFastifyModule() {
  return loadOptionalModule<FastifyFrameworkModule>(
    'fastify',
    ['fastify', 'fastify-plugin']
  );
}

function loadNestModule() {
  return loadOptionalModule<NestFrameworkModule>(
    'nestjs',
    [
      '@nestjs/common',
      '@nestjs/core',
      '@nestjs/platform-express',
      '@nestjs/platform-fastify',
      'rxjs',
    ]
  );
}

export function normalizeOTLPRecord(
  record: LogRecord,
  connector: ResolvedOTLPConnectorConfig,
  source?: OTLPLogSource
): OTLPNormalizedRecord {
  return loadOtlpModule().normalizeOTLPRecord(record, connector, source);
}

export function createBetterStackLogger(
  config: BetterStackLoggerConfig = {}
): BetterStackLogger {
  return loadBetterStackModule().createBetterStackLogger(config);
}

export function createBetterStackErrorTracker(
  config: BetterStackLoggerConfig = {}
): BetterStackErrorTracker {
  return loadBetterStackModule().createBetterStackErrorTracker(config);
}

export function captureBetterStackException(
  error: unknown,
  options: BetterStackExceptionCaptureOptions = {},
  config: BetterStackLoggerConfig = {}
): void {
  return loadBetterStackModule().captureBetterStackException(error, options, config);
}

export function createStructuredBetterStackLogger<
  TFields extends Record<string, unknown> = Record<string, unknown>,
>(
  groupId: string,
  initial?: TFields,
  config: BetterStackLoggerConfig = {}
): StructuredLog<TFields> {
  return loadBetterStackModule().createStructuredBetterStackLogger(groupId, initial, config);
}

export function createDatabuddyLogger(
  config: DatabuddyLoggerConfig = {}
): DatabuddyLogger {
  return loadDatabuddyModule().createDatabuddyLogger(config);
}

export function createDatabuddyErrorTracker(
  config: DatabuddyLoggerConfig = {}
): DatabuddyErrorTracker {
  return loadDatabuddyModule().createDatabuddyErrorTracker(config);
}

export function captureDatabuddyException(
  error: unknown,
  options: DatabuddyExceptionCaptureOptions = {},
  config: DatabuddyLoggerConfig = {}
): void {
  return loadDatabuddyModule().captureDatabuddyException(error, options, config);
}

export function createStructuredDatabuddyLogger<
  TFields extends Record<string, unknown> = Record<string, unknown>,
>(
  groupId: string,
  initial?: TFields,
  config: DatabuddyLoggerConfig = {}
): StructuredLog<TFields> {
  return loadDatabuddyModule().createStructuredDatabuddyLogger(groupId, initial, config);
}

export function createPosthogLogger(
  config: PostHogLoggerConfig = {}
): PostHogLogger {
  return loadPosthogModule().createPosthogLogger(config);
}

export function createPosthogErrorTracker(
  config: PostHogLoggerConfig = {}
): PostHogErrorTracker {
  return loadPosthogModule().createPosthogErrorTracker(config);
}

export function capturePosthogException(
  error: unknown,
  options: PostHogExceptionCaptureOptions = {},
  config: PostHogLoggerConfig = {}
): void {
  return loadPosthogModule().capturePosthogException(error, options, config);
}

export function createStructuredPosthogLogger<
  TFields extends Record<string, unknown> = Record<string, unknown>,
>(
  groupId: string,
  initial?: TFields,
  config: PostHogLoggerConfig = {}
): StructuredLog<TFields> {
  return loadPosthogModule().createStructuredPosthogLogger(groupId, initial, config);
}

export function createSentryLogger(
  config: SentryLoggerConfig = {}
): SentryLogger {
  return loadSentryModule().createSentryLogger(config);
}

export function createStructuredSentryLogger<
  TFields extends Record<string, unknown> = Record<string, unknown>,
>(
  groupId: string,
  initial?: TFields,
  config: SentryLoggerConfig = {}
): StructuredLog<TFields> {
  return loadSentryModule().createStructuredSentryLogger(groupId, initial, config);
}

export function createOtlpLogger(config: OTLPLoggerConfig = { name: '' }): OTLPLogger {
  return loadOtlpModule().createOtlpLogger(config);
}

export function createStructuredOtlpLogger<
  TFields extends Record<string, unknown> = Record<string, unknown>,
>(
  groupId: string,
  initial?: TFields,
  config?: OTLPLoggerConfig
): StructuredLog<TFields> {
  return loadOtlpModule().createStructuredOtlpLogger(groupId, initial, config);
}
