import pino from 'pino';
import { loadOptionalModule } from './optional-module';
import { shouldDropRootLogWrite } from '../frameworks/shared/request-context';
import { sanitizeLogValue } from '../shared/redaction';
import { type BlypConfig, resolveConfig } from './config';
import {
  buildRecord,
  buildStructuredRecord,
  resolveStructuredWriteLevel,
} from './log-record';
import type { LogRecord } from './file-logger';
import type { LogMethodName } from '../types/core/log-record';
import { createPrimarySink } from './primary-sink';
import type { BlypPrimarySink } from './primary-sink';
import { getRecordType } from '../connectors/shared';
import { ConnectorDeliveryManager } from '../connectors/delivery/manager';
import type { ConnectorBatchDispatchTarget } from '../connectors/delivery/types';
import type { BetterStackSender } from '../types/connectors/betterstack';
import type { DatabuddySender } from '../types/connectors/databuddy';
import type { PostHogSender } from '../types/connectors/posthog';
import type { SentrySender } from '../types/connectors/sentry';
import type { OTLPRegistry } from '../types/connectors/otlp';
import type { ResolvedRedactionConfig } from '../types/core/config';
import { runtime } from './runtime';
import {
  createStructuredLog as createStructuredLogCollector,
} from './structured-log';
import type { StructuredLog, StructuredLogPayload } from '../types/core/structured-log';
import type {
  BlypLogger,
  InternalBlypLogger,
  InternalLoggerSource,
  LoggerFactoryHandle,
  StructuredLogFactoryOptions,
} from '../types/core/logger';

export type { BlypLogger } from '../types/core/logger';

const LOGGER_FACTORY = Symbol('blyp.logger.factory');

export const CUSTOM_LEVELS: Record<string, number> = {
  success: 25,
  info: 30,
  debug: 35,
  table: 37,
  warning: 40,
  error: 50,
  critical: 60,
};

const CONSOLE_LEVELS: Record<LogMethodName, string> = {
  success: 'success',
  critical: 'critical',
  warning: 'warning',
  info: 'info',
  debug: 'debug',
  error: 'error',
  warn: 'warn',
  table: 'debug',
};

const MAGENTA = '\x1b[35m';
const RESET = '\x1b[0m';

interface BetterStackSenderModule {
  createBetterStackSender: (config: BlypConfig) => BetterStackSender;
}

interface DatabuddySenderModule {
  createDatabuddySender: (config: BlypConfig) => DatabuddySender;
}

interface PostHogSenderModule {
  createPostHogSender: (config: BlypConfig) => PostHogSender;
}

interface SentrySenderModule {
  createSentrySender: (config: BlypConfig) => SentrySender;
}

interface OTLPSenderModule {
  createOTLPRegistry: (config: BlypConfig) => OTLPRegistry;
}

function isClientLogRecord(record: LogRecord): boolean {
  return getRecordType(record) === 'client_log';
}

function createBetterStackSenderStub(): BetterStackSender {
  return {
    enabled: false,
    ready: false,
    mode: 'auto',
    serviceName: 'blyp-app',
    ingestingHost: undefined,
    status: 'missing',
    errorTracking: {
      enabled: false,
      ready: false,
      status: 'missing',
      dsn: undefined,
      tracesSampleRate: 1,
      environment: undefined,
      release: undefined,
    },
    shouldAutoForwardServerLogs: () => false,
    shouldAutoCaptureExceptions: () => false,
    send: () => {},
    captureException: () => {},
    flush: async () => {},
  };
}

function createDatabuddySenderStub(): DatabuddySender {
  return {
    enabled: false,
    ready: false,
    mode: 'auto',
    status: 'missing',
    shouldAutoForwardServerLogs: () => false,
    shouldAutoCaptureExceptions: () => false,
    send: () => {},
    captureException: () => {},
    flush: async () => {},
  };
}

function createPostHogSenderStub(): PostHogSender {
  return {
    enabled: false,
    ready: false,
    mode: 'auto',
    serviceName: 'blyp-app',
    host: 'https://us.i.posthog.com',
    status: 'missing',
    errorTracking: {
      enabled: false,
      ready: false,
      mode: 'auto',
      status: 'missing',
      enableExceptionAutocapture: false,
    },
    shouldAutoForwardServerLogs: () => false,
    shouldAutoCaptureExceptions: () => false,
    send: () => {},
    captureException: () => {},
    flush: async () => {},
  };
}

function createSentrySenderStub(): SentrySender {
  return {
    enabled: false,
    ready: false,
    mode: 'auto',
    status: 'missing',
    shouldAutoForwardServerLogs: () => false,
    send: () => {},
    flush: async () => {},
  };
}

function createOtlpSenderStub(name: string): import('../types/connectors/otlp').OTLPSender {
  return {
    name,
    enabled: false,
    ready: false,
    mode: 'auto',
    serviceName: 'blyp-app',
    endpoint: undefined,
    status: 'missing',
    send: () => {},
    flush: async () => {},
  };
}

function createOTLPRegistryStub(): OTLPRegistry {
  return {
    get: (name: string) => createOtlpSenderStub(name),
    getAutoForwardTargets: () => [],
    send: () => {},
    flush: async () => {},
  };
}

function createBetterStackSenderForConfig(config: BlypConfig): BetterStackSender {
  if (!config.connectors?.betterstack?.enabled) {
    return createBetterStackSenderStub();
  }

  return loadOptionalModule<BetterStackSenderModule>(
    'betterstack',
    ['@logtail/node', '@sentry/node'],
    '../connectors/betterstack/sender'
  ).createBetterStackSender(config);
}

function createDatabuddySenderForConfig(config: BlypConfig): DatabuddySender {
  if (!config.connectors?.databuddy?.enabled) {
    return createDatabuddySenderStub();
  }

  return loadOptionalModule<DatabuddySenderModule>(
    'databuddy',
    ['@databuddy/sdk'],
    '../connectors/databuddy/sender'
  ).createDatabuddySender(config);
}

function createPostHogSenderForConfig(config: BlypConfig): PostHogSender {
  if (!config.connectors?.posthog?.enabled) {
    return createPostHogSenderStub();
  }

  return loadOptionalModule<PostHogSenderModule>(
    'posthog',
    [
      'posthog-node',
      '@opentelemetry/api-logs',
      '@opentelemetry/exporter-logs-otlp-http',
      '@opentelemetry/resources',
      '@opentelemetry/sdk-logs',
    ],
    '../connectors/posthog/sender'
  ).createPostHogSender(config);
}

function createSentrySenderForConfig(config: BlypConfig): SentrySender {
  if (!config.connectors?.sentry?.enabled) {
    return createSentrySenderStub();
  }

  return loadOptionalModule<SentrySenderModule>(
    'sentry',
    ['@sentry/node'],
    '../connectors/sentry/sender'
  ).createSentrySender(config);
}

function createOTLPRegistryForConfig(config: BlypConfig): OTLPRegistry {
  if (!config.connectors?.otlp?.some((connector) => connector.enabled)) {
    return createOTLPRegistryStub();
  }

  return loadOptionalModule<OTLPSenderModule>(
    'otlp',
    [
      '@opentelemetry/api-logs',
      '@opentelemetry/exporter-logs-otlp-http',
      '@opentelemetry/resources',
      '@opentelemetry/sdk-logs',
    ],
    '../connectors/otlp/sender'
  ).createOTLPRegistry(config);
}

function summarizeClientConsoleData(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return null;
  }

  const record = data as {
    data?: unknown;
    metadata?: unknown;
    page?: { pathname?: unknown; url?: unknown };
  };
  const summary: Record<string, unknown> = {};

  if (record.data !== undefined) {
    summary.data = record.data;
  }

  const pathname = typeof record.page?.pathname === 'string'
    ? record.page.pathname
    : undefined;
  const url = typeof record.page?.url === 'string'
    ? record.page.url
    : undefined;

  if (pathname || url) {
    summary.page = pathname ?? url;
  }

  if (record.metadata !== undefined) {
    summary.metadata = record.metadata;
  }

  return Object.keys(summary).length > 0 ? summary : null;
}

function getConsoleDataPayload(data: unknown): { hidden: boolean; value?: unknown } {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { hidden: false, value: data };
  }

  const record = data as { type?: unknown };
  if (record.type === 'http_request' || record.type === 'http_error') {
    return { hidden: true };
  }

  if (record.type === 'client_log') {
    const summary = summarizeClientConsoleData(data);
    if (!summary) {
      return { hidden: true };
    }

    return {
      hidden: false,
      value: summary,
    };
  }

  return { hidden: false, value: data };
}

function createPinoLogger(config: BlypConfig) {
  if (config.pretty) {
    const pinoPretty = require('pino-pretty');
    const pretty = pinoPretty.default({
      colorize: true,
      translateTime: 'SYS:HH:MM:ss',
      ignore: 'pid,hostname,caller',
      customColors: {
        success: 'green',
        critical: 'red bold',
        info: 'blue',
        warning: 'yellow',
        error: 'red',
        debug: 'cyan',
        table: 'cyan',
      },
      messageFormat: (log: Record<string, unknown>, messageKey: string) => {
        const message = String(log[messageKey] ?? '');
        const caller = typeof log.caller === 'string' ? log.caller.trim() : '';

        if (!caller) {
          return message;
        }

        return `${message} ${MAGENTA}${caller}${RESET}`;
      },
    });
    return pino(
      {
        level: config.level,
        customLevels: CUSTOM_LEVELS,
      },
      pretty
    );
  }

  return pino({
    level: config.level,
    customLevels: CUSTOM_LEVELS,
  });
}

function getLoggerFactory(logger: BlypLogger): LoggerFactoryHandle {
  const factory = (logger as InternalBlypLogger)[LOGGER_FACTORY];
  if (!factory) {
    throw new Error('Unsupported Blyp logger instance');
  }

  return factory;
}

export function getPostHogSender(logger: BlypLogger): PostHogSender {
  return getLoggerFactory(logger).posthog;
}

export function getBetterStackSender(logger: BlypLogger): BetterStackSender {
  return getLoggerFactory(logger).betterstack;
}

export function getDatabuddySender(logger: BlypLogger): DatabuddySender {
  return getLoggerFactory(logger).databuddy;
}

export function tryGetPostHogSender(logger: unknown): PostHogSender | null {
  try {
    return getPostHogSender(logger as BlypLogger);
  } catch {
    return null;
  }
}

export function tryGetBetterStackSender(logger: unknown): BetterStackSender | null {
  try {
    return getBetterStackSender(logger as BlypLogger);
  } catch {
    return null;
  }
}

export function tryGetDatabuddySender(logger: unknown): DatabuddySender | null {
  try {
    return getDatabuddySender(logger as BlypLogger);
  } catch {
    return null;
  }
}

export function getSentrySender(logger: BlypLogger): SentrySender {
  return getLoggerFactory(logger).sentry;
}

export function getOtlpRegistry(logger: BlypLogger): OTLPRegistry {
  return getLoggerFactory(logger).otlp;
}

export function getRedactionConfig(logger: BlypLogger): ResolvedRedactionConfig {
  try {
    return getLoggerFactory(logger).redact;
  } catch {
    return resolveConfig().redact;
  }
}

export function attachLoggerInternals<T extends BlypLogger>(target: T, source: BlypLogger): T {
  const factory = getLoggerFactory(source);
  Object.defineProperty(target, LOGGER_FACTORY, {
    value: factory,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return target;
}

export function createLoggerWithSource(
  logger: BlypLogger,
  source: InternalLoggerSource
): BlypLogger {
  const factory = getLoggerFactory(logger);
  return factory.create(source, factory.bindings);
}

export function createStructuredLogForLogger(
  logger: BlypLogger,
  groupId: string,
  options: StructuredLogFactoryOptions = {}
): StructuredLog {
  const factory = getLoggerFactory(logger);

  return createStructuredLogCollector(groupId, {
    initialFields: options.initialFields,
    resolveDefaultFields: () => ({
      ...factory.bindings,
      ...(options.resolveDefaultFields?.() ?? {}),
    }),
    write: (payload, message) => {
      factory.writeStructured(payload, message, 'structured-flush');
    },
    onCreate: options.onCreate,
    onEmit: options.onEmit,
    redact: options.redact ?? factory.redact,
  });
}

function maybeSendToPostHog(
  posthog: PostHogSender,
  record: ReturnType<typeof buildRecord> | ReturnType<typeof buildStructuredRecord>
): void {
  if (isClientLogRecord(record)) {
    return;
  }

  if (!posthog.shouldAutoForwardServerLogs()) {
    if (posthog.enabled && !posthog.ready) {
      posthog.send(record, { source: 'server', warnIfUnavailable: true });
    }
    return;
  }

  posthog.send(record, { source: 'server', warnIfUnavailable: true });
}

function maybeSendToBetterStack(
  betterstack: BetterStackSender,
  record: ReturnType<typeof buildRecord> | ReturnType<typeof buildStructuredRecord>
): void {
  if (isClientLogRecord(record)) {
    return;
  }

  if (!betterstack.shouldAutoForwardServerLogs()) {
    if (betterstack.enabled && !betterstack.ready) {
      betterstack.send(record, { source: 'server', warnIfUnavailable: true });
    }
    return;
  }

  betterstack.send(record, { source: 'server', warnIfUnavailable: true });
}

function maybeSendToDatabuddy(
  databuddy: DatabuddySender,
  record: ReturnType<typeof buildRecord> | ReturnType<typeof buildStructuredRecord>
): void {
  if (isClientLogRecord(record)) {
    return;
  }

  if (!databuddy.shouldAutoForwardServerLogs()) {
    if (databuddy.enabled && !databuddy.ready) {
      databuddy.send(record, { source: 'server', warnIfUnavailable: true });
    }
    return;
  }

  databuddy.send(record, { source: 'server', warnIfUnavailable: true });
}

function maybeSendToSentry(
  sentry: SentrySender,
  record: ReturnType<typeof buildRecord> | ReturnType<typeof buildStructuredRecord>
): void {
  if (isClientLogRecord(record)) {
    return;
  }

  if (!sentry.shouldAutoForwardServerLogs()) {
    if (sentry.enabled && !sentry.ready) {
      sentry.send(record, { source: 'server', warnIfUnavailable: true });
    }
    return;
  }

  sentry.send(record, { source: 'server', warnIfUnavailable: true });
}

function maybeSendToOTLP(
  otlp: OTLPRegistry,
  record: ReturnType<typeof buildRecord> | ReturnType<typeof buildStructuredRecord>
): void {
  if (isClientLogRecord(record)) {
    return;
  }

  for (const sender of otlp.getAutoForwardTargets()) {
    sender.send(record, { source: 'server', warnIfUnavailable: true });
  }
}

function createLoggerInstance(
  rootRawLogger: any,
  sink: BlypPrimarySink,
  connectorDelivery: ConnectorDeliveryManager | null,
  betterstack: BetterStackSender,
  databuddy: DatabuddySender,
  posthog: PostHogSender,
  sentry: SentrySender,
  otlp: OTLPRegistry,
  redact: ResolvedRedactionConfig,
  bindings: Record<string, unknown> = {},
  source: InternalLoggerSource = 'root'
): BlypLogger {
  const rawLogger = Object.keys(bindings).length > 0
    ? rootRawLogger.child(bindings)
    : rootRawLogger;

  const writeRecord = (
    level: LogMethodName,
    message: unknown,
    args: unknown[],
    writeSource: InternalLoggerSource = source
  ): void => {
    if (writeSource === 'root' && shouldDropRootLogWrite()) {
      return;
    }

    const record = buildRecord(level, message, args, bindings, redact);
    const consoleMessage = record.message;
    const payload: Record<string, unknown> = {
      caller: record.caller,
    };
    const consoleData = getConsoleDataPayload(record.data);

    if (!consoleData.hidden && consoleData.value !== undefined) {
      payload.data = consoleData.value;
    }

    const consoleMethod = CONSOLE_LEVELS[level];
    const boundLogger = rawLogger as Record<string, (payload: unknown, message: string) => void>;
    const logMethod =
      boundLogger[consoleMethod] ??
      boundLogger.info ??
      ((_payload: unknown, _message: string) => {});

    (logMethod as (this: unknown, payload: unknown, message: string) => void).call(
      rawLogger,
      payload,
      consoleMessage
    );
    sink.write(record);
    maybeSendToBetterStack(betterstack, record);
    maybeSendToDatabuddy(databuddy, record);
    maybeSendToPostHog(posthog, record);
    maybeSendToSentry(sentry, record);
    maybeSendToOTLP(otlp, record);
  };

  const writeStructuredRecord = (
    payload: StructuredLogPayload,
    message: string,
    writeSource: InternalLoggerSource = 'structured-flush'
  ): void => {
    const level = resolveStructuredWriteLevel(payload.level);
    const record = buildStructuredRecord(level, message, payload, bindings, redact);
    const consoleMethod = CONSOLE_LEVELS[level];
    const boundLogger = rawLogger as Record<string, (payload: unknown, message: string) => void>;
    const logMethod =
      boundLogger[consoleMethod] ??
      boundLogger.info ??
      ((_payload: unknown, _message: string) => {});

    (logMethod as (this: unknown, payload: unknown, message: string) => void).call(
      rawLogger,
      {
        caller: record.caller,
        ...record,
      },
      record.message
    );

    if (writeSource !== 'root' || !shouldDropRootLogWrite()) {
      sink.write(record);
    }

    maybeSendToBetterStack(betterstack, record);
    maybeSendToDatabuddy(databuddy, record);
    maybeSendToPostHog(posthog, record);
    maybeSendToSentry(sentry, record);
    maybeSendToOTLP(otlp, record);
  };

  const logger: InternalBlypLogger = {
    success: (message: unknown, ...args: unknown[]) => {
      writeRecord('success', message, args);
    },

    critical: (message: unknown, ...args: unknown[]) => {
      writeRecord('critical', message, args);
    },

    warning: (message: unknown, ...args: unknown[]) => {
      writeRecord('warning', message, args);
    },

    info: (message: unknown, ...args: unknown[]) => {
      writeRecord('info', message, args);
    },

    debug: (message: unknown, ...args: unknown[]) => {
      writeRecord('debug', message, args);
    },

    error: (message: unknown, ...args: unknown[]) => {
      writeRecord('error', message, args);
    },

    warn: (message: unknown, ...args: unknown[]) => {
      writeRecord('warn', message, args);
    },

    table: (message: string, data?: unknown) => {
      if (data && typeof data === 'object' && runtime.env.get('NODE_ENV') !== 'production') {
        console.log('TABLE:', message);
        console.table(sanitizeLogValue(data, redact));
      }
      writeRecord('table', message, data === undefined ? [] : [data]);
    },

    flush: async () => {
      await sink.flush();
      if (connectorDelivery) {
        await connectorDelivery.flush();
      }
      await Promise.allSettled([
        betterstack.flush(),
        databuddy.flush(),
        posthog.flush(),
        sentry.flush(),
        otlp.flush(),
      ]);
    },

    shutdown: async () => {
      await sink.shutdown();
      if (connectorDelivery) {
        await connectorDelivery.shutdown();
      }
      await Promise.allSettled([
        betterstack.flush(),
        databuddy.flush(),
        posthog.flush(),
        sentry.flush(),
        otlp.flush(),
      ]);
    },

    createStructuredLog: (
      groupId: string,
      initial?: Record<string, unknown>
    ): StructuredLog => {
      return createStructuredLogForLogger(logger, groupId, {
        initialFields: initial,
      });
    },

    child: (childBindings: Record<string, unknown>) => {
      const mergedBindings = { ...bindings, ...childBindings };
      return createLoggerInstance(
        rootRawLogger,
        sink,
        connectorDelivery,
        betterstack,
        databuddy,
        posthog,
        sentry,
        otlp,
        redact,
        mergedBindings,
        source
      );
    },

    [LOGGER_FACTORY]: {
      bindings,
      betterstack,
      databuddy,
      posthog,
      sentry,
      otlp,
      redact,
      sink,
      create: (
        nextSource: InternalLoggerSource,
        nextBindings: Record<string, unknown> = bindings
      ) => {
        return createLoggerInstance(
          rootRawLogger,
          sink,
          connectorDelivery,
          betterstack,
          databuddy,
          posthog,
          sentry,
          otlp,
          redact,
          nextBindings,
          nextSource
        );
      },
      writeStructured: (
        payload: StructuredLogPayload,
        message: string,
        nextSource: InternalLoggerSource = 'structured-flush'
      ) => {
        writeStructuredRecord(payload, message, nextSource);
      },
    },
  };

  return logger;
}

let loggerInstance: BlypLogger | null = null;

export function createBaseLogger(config?: Partial<BlypConfig>): BlypLogger {
  if (config === undefined && loggerInstance) {
    return loggerInstance;
  }

  const resolvedConfig = resolveConfig(config);
  const rawLogger = createPinoLogger(resolvedConfig);
  const sink = createPrimarySink(resolvedConfig);
  const betterstack = createBetterStackSenderForConfig(resolvedConfig);
  const databuddy = createDatabuddySenderForConfig(resolvedConfig);
  const posthog = createPostHogSenderForConfig(resolvedConfig);
  const sentry = createSentrySenderForConfig(resolvedConfig);
  const otlp = createOTLPRegistryForConfig(resolvedConfig);
  const connectorDelivery = resolvedConfig.connectors.delivery.enabled
    ? new ConnectorDeliveryManager(resolvedConfig.connectors.delivery)
    : null;

  if (connectorDelivery) {
    connectorDelivery.bindTarget(betterstack as unknown as ConnectorBatchDispatchTarget);
    connectorDelivery.bindTarget(databuddy as unknown as ConnectorBatchDispatchTarget);
    connectorDelivery.bindTarget(posthog as unknown as ConnectorBatchDispatchTarget);
    connectorDelivery.bindTarget(sentry as unknown as ConnectorBatchDispatchTarget);

    for (const sender of otlp.getAutoForwardTargets()) {
      connectorDelivery.bindTarget(sender as unknown as ConnectorBatchDispatchTarget);
    }
  }

  const instance = createLoggerInstance(
    rawLogger,
    sink,
    connectorDelivery,
    betterstack,
    databuddy,
    posthog,
    sentry,
    otlp,
    resolvedConfig.redact
  );

  if (config === undefined) {
    loggerInstance = instance;
  }

  return instance;
}

export const logger = createBaseLogger();
