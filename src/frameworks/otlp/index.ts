import type { BlypConnectorsConfig } from '../../core/config';
import { resolveConfig } from '../../core/config';
import type { BlypLogger } from '../../core/logger';
import {
  buildRecord,
  buildStructuredRecord,
  resolveStructuredWriteLevel,
  type LogMethodName,
} from '../../core/log-record';
import { createOTLPRegistry, type OTLPSender } from '../../core/otlp';
import {
  createStructuredLog,
  type StructuredLog,
  type StructuredLogPayload,
} from '../../core/structured-log';

export interface OTLPLoggerConfig {
  name: string;
  connectors?: BlypConnectorsConfig;
}

export interface OTLPLogger extends BlypLogger {}

function resolveSender(config: OTLPLoggerConfig = { name: '' }): OTLPSender {
  const registry = createOTLPRegistry(resolveConfig({
    ...(config.connectors ? { connectors: config.connectors } : {}),
  }));

  return registry.get(config.name);
}

function createOTLPLoggerInstance(
  sender: OTLPSender,
  bindings: Record<string, unknown> = {}
): OTLPLogger {
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
      return createOTLPLoggerInstance(sender, {
        ...bindings,
        ...childBindings,
      });
    },
  };
}

export function createOtlpLogger(config: OTLPLoggerConfig = { name: '' }): OTLPLogger {
  return createOTLPLoggerInstance(resolveSender(config));
}

export function createStructuredOtlpLogger<
  TFields extends Record<string, unknown> = Record<string, unknown>,
>(
  groupId: string,
  initial?: TFields,
  config?: OTLPLoggerConfig
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
