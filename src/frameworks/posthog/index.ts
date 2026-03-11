import type { BlypConnectorsConfig } from '../../core/config';
import { resolveConfig } from '../../core/config';
import type { BlypLogger } from '../../core/logger';
import {
  buildRecord,
  buildStructuredRecord,
  resolveStructuredWriteLevel,
  type LogMethodName,
} from '../../core/log-record';
import { createPostHogSender, type PostHogSender } from '../../core/posthog';
import {
  createStructuredLog,
  type StructuredLog,
  type StructuredLogPayload,
} from '../../core/structured-log';

export interface PostHogLoggerConfig {
  connectors?: BlypConnectorsConfig;
}

export interface PostHogLogger extends BlypLogger {}

function resolveSender(config: PostHogLoggerConfig = {}): PostHogSender {
  return createPostHogSender(resolveConfig({
    ...(config.connectors ? { connectors: config.connectors } : {}),
  }));
}

function createPostHogLoggerInstance(
  sender: PostHogSender,
  bindings: Record<string, unknown> = {}
): PostHogLogger {
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
      return createPostHogLoggerInstance(sender, {
        ...bindings,
        ...childBindings,
      });
    },
  };
}

export function createPosthogLogger(config: PostHogLoggerConfig = {}): PostHogLogger {
  return createPostHogLoggerInstance(resolveSender(config));
}

export function createStructuredPosthogLogger<
  TFields extends Record<string, unknown> = Record<string, unknown>,
>(
  groupId: string,
  initial?: TFields,
  config: PostHogLoggerConfig = {}
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

