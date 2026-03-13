/// <reference lib="dom" />

import { z } from 'zod';
import {
  normalizeError,
  normalizeLogValue,
  serializeLogMessage,
} from './log-value';
import {
  isPlainObject,
  nonEmptyStringSchema,
  plainObjectSchema,
} from './validation';
import type {
  ClientConnectorRequest,
  ClientLogBrowserContext,
  ClientLogDeviceContext,
  ClientLogEvent,
  ClientLogLevel,
  ClientLogPageContext,
  ClientLogSessionContext,
  RemoteDeliveryConfig,
  RemoteDeliveryDropContext,
  RemoteDeliveryFailureContext,
  RemoteDeliveryFailureReason,
  RemoteDeliveryRetryContext,
  RemoteDeliveryRuntime,
  RemoteDeliverySuccessContext,
  RemoteDeliveryTransport,
} from '../types/shared/client-log';

export type {
  ClientConnectorRequest,
  ClientLogBrowserContext,
  ClientLogDeviceContext,
  ClientLogEvent,
  ClientLogLevel,
  ClientLogPageContext,
  ClientLogSessionContext,
  RemoteDeliveryConfig,
  RemoteDeliveryDropContext,
  RemoteDeliveryFailureContext,
  RemoteDeliveryFailureReason,
  RemoteDeliveryRetryContext,
  RemoteDeliverySuccessContext,
  RemoteDeliveryTransport,
} from '../types/shared/client-log';

export const DEFAULT_CLIENT_LOG_ENDPOINT = '/inngest';
const SESSION_STORAGE_KEY = 'blyp:session-id';

const CLIENT_LOG_LEVELS: ClientLogLevel[] = [
  'debug',
  'info',
  'warning',
  'error',
  'critical',
  'success',
  'table',
];
const clientConnectorRequestSchema = z.union([
  z.literal('betterstack'),
  z.literal('posthog'),
  z.literal('sentry'),
  z.undefined(),
  z.object({
    type: z.literal('otlp'),
    name: nonEmptyStringSchema,
  }),
]);

function isClientLogLevel(value: unknown): value is ClientLogLevel {
  return typeof value === 'string' && CLIENT_LOG_LEVELS.includes(value as ClientLogLevel);
}

function isClientConnectorRequest(value: unknown): value is ClientConnectorRequest {
  return clientConnectorRequestSchema.safeParse(value).success;
}

function safeGet<T>(getter: () => T): T | undefined {
  try {
    return getter();
  } catch {
    return undefined;
  }
}

function randomSegment(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function createRandomId(): string {
  const maybeCrypto = safeGet(() => globalThis.crypto);
  const randomUUID = maybeCrypto && typeof maybeCrypto.randomUUID === 'function'
    ? maybeCrypto.randomUUID.bind(maybeCrypto)
    : undefined;

  if (randomUUID) {
    return randomUUID();
  }

  return `${Date.now().toString(36)}-${randomSegment()}`;
}

export function normalizeClientLogLevel(level: ClientLogLevel | 'warn'): ClientLogLevel {
  return level === 'warn' ? 'warning' : level;
}

export { normalizeError, normalizeLogValue, serializeLogMessage };

export function normalizeClientPayloadData(message: unknown, args: unknown[]): unknown {
  const normalizedArgs = args.map((entry) => normalizeLogValue(entry));
  const messageData = message instanceof Error ? normalizeError(message) : undefined;

  if (messageData !== undefined && normalizedArgs.length === 0) {
    return messageData;
  }

  const combined = messageData === undefined ? normalizedArgs : [messageData, ...normalizedArgs];

  if (combined.length === 0) {
    return undefined;
  }

  if (combined.length === 1) {
    return combined[0];
  }

  return combined;
}

export function getBrowserPageContext(): ClientLogPageContext {
  const location = safeGet(() => globalThis.location);
  const document = safeGet(() => globalThis.document);

  return {
    url: location?.href,
    pathname: location?.pathname,
    search: location?.search,
    hash: location?.hash,
    title: document?.title,
    referrer: document?.referrer,
  };
}

export function getBrowserContext(): ClientLogBrowserContext {
  const navigator = safeGet(() => globalThis.navigator);

  return {
    userAgent: navigator?.userAgent,
    language: navigator?.language,
    platform: navigator?.platform,
  };
}

export function getClientSessionId(): string {
  const storage = safeGet(() => globalThis.sessionStorage);
  const existing = safeGet(() => storage?.getItem(SESSION_STORAGE_KEY));

  if (existing) {
    return existing;
  }

  const sessionId = createRandomId();
  safeGet(() => storage?.setItem(SESSION_STORAGE_KEY, sessionId));
  return sessionId;
}

export function normalizeMetadata(
  metadata: Record<string, unknown> | (() => Record<string, unknown>) | undefined
): Record<string, unknown> | undefined {
  if (metadata === undefined) {
    return undefined;
  }

  const resolved = typeof metadata === 'function' ? safeGet(metadata) : metadata;
  if (!isPlainObject(resolved)) {
    return undefined;
  }

  return normalizeLogValue(resolved) as Record<string, unknown>;
}

export function isClientLogEvent(payload: unknown): payload is ClientLogEvent {
  if (!isPlainObject(payload)) {
    return false;
  }

  if (
    payload.type !== 'client_log' ||
    payload.source !== 'client' ||
    !isClientLogLevel(payload.level) ||
    typeof payload.id !== 'string' ||
    typeof payload.message !== 'string' ||
    typeof payload.clientTimestamp !== 'string'
  ) {
    return false;
  }

  const pageResult = plainObjectSchema.safeParse(payload.page);
  const browserResult = plainObjectSchema.safeParse(payload.browser);
  const sessionResult = plainObjectSchema.safeParse(payload.session);

  if (!pageResult.success || !browserResult.success || !sessionResult.success) {
    return false;
  }

  if (!isClientConnectorRequest(payload.connector)) {
    return false;
  }

  return (
    typeof sessionResult.data.pageId === 'string' &&
    typeof sessionResult.data.sessionId === 'string'
  );
}

export function normalizeEndpointPath(path: string | undefined): string {
  if (!path) {
    return DEFAULT_CLIENT_LOG_ENDPOINT;
  }

  return path.startsWith('/') ? path : `/${path}`;
}
