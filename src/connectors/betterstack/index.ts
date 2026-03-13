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
  createBetterStackSender,
} from './sender';
import type {
  BetterStackLogger,
  BetterStackLoggerConfig,
  BetterStackSender,
} from '../../types/connectors/betterstack';

export type {
  BetterStackLogger,
  BetterStackLoggerConfig,
} from '../../types/connectors/betterstack';

function resolveSender(config: BetterStackLoggerConfig = {}): BetterStackSender {
  return createBetterStackSender(resolveConfig({
    ...(config.connectors ? { connectors: config.connectors } : {}),
  }));
}

function createBetterStackLoggerInstance(
  sender: BetterStackSender,
  bindings: Record<string, unknown> = {}
): BetterStackLogger {
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
      return createBetterStackLoggerInstance(sender, {
        ...bindings,
        ...childBindings,
      });
    },
  };
}

export function createBetterStackLogger(
  config: BetterStackLoggerConfig = {}
): BetterStackLogger {
  return createBetterStackLoggerInstance(resolveSender(config));
}

export function createStructuredBetterStackLogger<
  TFields extends Record<string, unknown> = Record<string, unknown>,
>(
  groupId: string,
  initial?: TFields,
  config: BetterStackLoggerConfig = {}
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
