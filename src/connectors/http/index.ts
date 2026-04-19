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
import {
  createHTTPRegistry,
  normalizeHTTPRecord,
} from './sender';
import type {
  HTTPLogger,
  HTTPLoggerConfig,
  HTTPSender,
} from '../../types/connectors/http';

export type {
  HTTPLogger,
  HTTPLoggerConfig,
} from '../../types/connectors/http';
export { normalizeHTTPRecord } from './sender';

function resolveSender(config: HTTPLoggerConfig = { name: '' }): HTTPSender {
  const registry = createHTTPRegistry(resolveConfig({
    ...(config.connectors ? { connectors: config.connectors } : {}),
  }));

  return registry.get(config.name);
}

function createHTTPLoggerInstance(
  sender: HTTPSender,
  bindings: Record<string, unknown> = {}
): HTTPLogger {
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
    flush: async () => {},
    shutdown: async () => {},
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
      return createHTTPLoggerInstance(sender, {
        ...bindings,
        ...childBindings,
      });
    },
  };
}

export function createHttpLogger(config: HTTPLoggerConfig = { name: '' }): HTTPLogger {
  return createHTTPLoggerInstance(resolveSender(config));
}

export function createStructuredHttpLogger<
  TFields extends Record<string, unknown> = Record<string, unknown>,
>(
  groupId: string,
  initial?: TFields,
  config?: HTTPLoggerConfig
): StructuredLog<TFields> {
  const sender = resolveSender(config ?? { name: '' });

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
