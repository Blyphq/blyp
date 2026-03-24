import { resolveConfig } from '../../core/config';
import {
  buildRecord,
  buildStructuredRecord,
  resolveStructuredWriteLevel,
  type LogMethodName,
} from '../../core/log-record';
import {
  createStructuredLog,
  type StructuredLog,
  type StructuredLogPayload,
} from '../../core/structured-log';
import { createDatabuddySender } from './sender';
import type {
  DatabuddyErrorTracker,
  DatabuddyExceptionCaptureOptions,
  DatabuddyLogger,
  DatabuddyLoggerConfig,
  DatabuddySender,
} from '../../types/connectors/databuddy';

export type {
  DatabuddyErrorTracker,
  DatabuddyExceptionCaptureOptions,
  DatabuddyLogger,
  DatabuddyLoggerConfig,
} from '../../types/connectors/databuddy';

function resolveSender(config: DatabuddyLoggerConfig = {}): DatabuddySender {
  return createDatabuddySender(resolveConfig({
    ...(config.connectors ? { connectors: config.connectors } : {}),
  }));
}

function createDatabuddyLoggerInstance(
  sender: DatabuddySender,
  bindings: Record<string, unknown> = {}
): DatabuddyLogger {
  const writeRecord = (
    level: LogMethodName,
    message: unknown,
    args: unknown[]
  ): void => {
    sender.send(buildRecord(level, message, args, bindings), {
      source: 'server',
      warnIfUnavailable: true,
    });
  };

  const writeStructured = (
    payload: StructuredLogPayload,
    message: string
  ): void => {
    sender.send(
      buildStructuredRecord(
        resolveStructuredWriteLevel(payload.level),
        message,
        payload,
        bindings
      ),
      {
        source: 'server',
        warnIfUnavailable: true,
      }
    );
  };

  return {
    debug: (message: unknown, ...args: unknown[]) => {
      writeRecord('debug', message, args);
    },
    info: (message: unknown, ...args: unknown[]) => {
      writeRecord('info', message, args);
    },
    error: (message: unknown, ...args: unknown[]) => {
      writeRecord('error', message, args);
    },
    warn: (message: unknown, ...args: unknown[]) => {
      writeRecord('warn', message, args);
    },
    warning: (message: unknown, ...args: unknown[]) => {
      writeRecord('warning', message, args);
    },
    success: (message: unknown, ...args: unknown[]) => {
      writeRecord('success', message, args);
    },
    critical: (message: unknown, ...args: unknown[]) => {
      writeRecord('critical', message, args);
    },
    table: (message: string, data?: unknown) => {
      writeRecord('table', message, data === undefined ? [] : [data]);
    },
    flush: async () => {
      await sender.flush();
    },
    shutdown: async () => {
      await sender.flush();
    },
    createStructuredLog: (
      groupId: string,
      initial?: Record<string, unknown>
    ): StructuredLog => {
      return createStructuredLog(groupId, {
        initialFields: initial,
        write: writeStructured,
      });
    },
    child: (childBindings: Record<string, unknown>) => {
      return createDatabuddyLoggerInstance(sender, {
        ...bindings,
        ...childBindings,
      });
    },
  };
}

function createDatabuddyErrorTrackerInstance(
  sender: DatabuddySender,
  bindings: Record<string, unknown> = {}
): DatabuddyErrorTracker {
  return {
    capture: (error: unknown, options: DatabuddyExceptionCaptureOptions = {}) => {
      sender.captureException(error, {
        source: 'server',
        warnIfUnavailable: true,
        properties: {
          ...bindings,
          ...(options.properties ?? {}),
          blyp_source: 'server',
          blyp_manual: true,
        },
      });
    },
    child: (childBindings: Record<string, unknown>) => {
      return createDatabuddyErrorTrackerInstance(sender, {
        ...bindings,
        ...childBindings,
      });
    },
  };
}

export function createDatabuddyLogger(config: DatabuddyLoggerConfig = {}): DatabuddyLogger {
  return createDatabuddyLoggerInstance(resolveSender(config));
}

export function createStructuredDatabuddyLogger<
  TFields extends Record<string, unknown> = Record<string, unknown>,
>(
  groupId: string,
  initial?: TFields,
  config: DatabuddyLoggerConfig = {}
): StructuredLog<TFields> {
  const sender = resolveSender(config);

  return createStructuredLog(groupId, {
    initialFields: initial,
    write: (payload, message) => {
      sender.send(
        buildStructuredRecord(
          resolveStructuredWriteLevel(payload.level),
          message,
          payload,
          {}
        ),
        {
          source: 'server',
          warnIfUnavailable: true,
        }
      );
    },
  }) as StructuredLog<TFields>;
}

export function createDatabuddyErrorTracker(
  config: DatabuddyLoggerConfig = {}
): DatabuddyErrorTracker {
  return createDatabuddyErrorTrackerInstance(resolveSender(config));
}

export function captureDatabuddyException(
  error: unknown,
  options: DatabuddyExceptionCaptureOptions = {},
  config: DatabuddyLoggerConfig = {}
): void {
  createDatabuddyErrorTracker(config).capture(error, options);
}
