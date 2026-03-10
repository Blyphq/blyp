/// <reference lib="dom" />

export const DEFAULT_CLIENT_LOG_ENDPOINT = '/inngest';
const SESSION_STORAGE_KEY = 'blyp:session-id';

export type ClientLogLevel =
  | 'debug'
  | 'info'
  | 'warning'
  | 'error'
  | 'critical'
  | 'success'
  | 'table';

export interface ClientLogPageContext {
  url?: string;
  pathname?: string;
  search?: string;
  hash?: string;
  title?: string;
  referrer?: string;
}

export interface ClientLogBrowserContext {
  userAgent?: string;
  language?: string;
  platform?: string;
}

export interface ClientLogDeviceContext {
  runtime?: 'expo' | 'browser';
  network?: {
    type?: string;
    isConnected?: boolean;
    isInternetReachable?: boolean;
  };
}

export interface ClientLogSessionContext {
  pageId: string;
  sessionId: string;
}

export interface ClientLogEvent {
  type: 'client_log';
  source: 'client';
  id: string;
  level: ClientLogLevel;
  message: string;
  data?: unknown;
  bindings?: Record<string, unknown>;
  clientTimestamp: string;
  page: ClientLogPageContext;
  browser: ClientLogBrowserContext;
  device?: ClientLogDeviceContext;
  session: ClientLogSessionContext;
  metadata?: Record<string, unknown>;
}

export type RemoteDeliveryRuntime = 'browser' | 'expo';

export type RemoteDeliveryTransport = 'fetch' | 'beacon';

export type RemoteDeliveryFailureReason =
  | 'offline'
  | 'network_error'
  | 'response_status'
  | 'invalid_endpoint'
  | 'missing_transport'
  | 'queue_overflow';

export interface RemoteDeliverySuccessContext {
  runtime: RemoteDeliveryRuntime;
  event: ClientLogEvent;
  attempt: number;
  status?: number;
  transport: RemoteDeliveryTransport;
}

export interface RemoteDeliveryRetryContext {
  runtime: RemoteDeliveryRuntime;
  event: ClientLogEvent;
  attempt: number;
  retriesRemaining: number;
  nextRetryAt: string;
  reason: 'offline' | 'network_error' | 'response_status';
  status?: number;
  error?: string;
}

export interface RemoteDeliveryFailureContext {
  runtime: RemoteDeliveryRuntime;
  event: ClientLogEvent;
  attempt: number;
  reason: RemoteDeliveryFailureReason;
  status?: number;
  error?: string;
}

export interface RemoteDeliveryDropContext {
  runtime: RemoteDeliveryRuntime;
  droppedEvent: ClientLogEvent;
  replacementEvent: ClientLogEvent;
  maxQueueSize: number;
  reason: 'queue_overflow';
}

export interface RemoteDeliveryConfig {
  maxRetries?: number;
  retryDelayMs?: number;
  maxQueueSize?: number;
  warnOnFailure?: boolean;
  onSuccess?: (ctx: RemoteDeliverySuccessContext) => void;
  onRetry?: (ctx: RemoteDeliveryRetryContext) => void;
  onFailure?: (ctx: RemoteDeliveryFailureContext) => void;
  onDrop?: (ctx: RemoteDeliveryDropContext) => void;
}

const CLIENT_LOG_LEVELS: ClientLogLevel[] = [
  'debug',
  'info',
  'warning',
  'error',
  'critical',
  'success',
  'table',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isClientLogLevel(value: unknown): value is ClientLogLevel {
  return typeof value === 'string' && CLIENT_LOG_LEVELS.includes(value as ClientLogLevel);
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

export function normalizeError(error: Error): Record<string, unknown> {
  const normalized: Record<string, unknown> = {
    name: error.name,
    message: error.message,
  };

  if (error.stack) {
    normalized.stack = error.stack;
  }

  const errorWithCause = error as Error & { cause?: unknown };
  if (errorWithCause.cause !== undefined) {
    normalized.cause = normalizeLogValue(errorWithCause.cause);
  }

  return normalized;
}

export function normalizeLogValue(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value instanceof Error) {
    return normalizeError(value);
  }

  if (typeof value === 'function') {
    return `[Function: ${value.name || 'anonymous'}]`;
  }

  if (typeof value === 'symbol') {
    return value.toString();
  }

  if (value === undefined || value === null) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeLogValue(entry, seen));
  }

  if (typeof value === 'object') {
    if (seen.has(value)) {
      return '[Circular]';
    }

    seen.add(value);
    const normalized: Record<string, unknown> = {};

    for (const [key, entry] of Object.entries(value)) {
      normalized[key] = normalizeLogValue(entry, seen);
    }

    seen.delete(value);
    return normalized;
  }

  return value;
}

export function serializeLogMessage(message: unknown): string {
  if (typeof message === 'string') {
    return message;
  }

  if (message instanceof Error) {
    return message.message || message.name;
  }

  const normalized = normalizeLogValue(message);
  if (typeof normalized === 'string') {
    return normalized;
  }

  try {
    return JSON.stringify(normalized, null, 2);
  } catch {
    return String(normalized);
  }
}

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
  if (!isRecord(resolved)) {
    return undefined;
  }

  return normalizeLogValue(resolved) as Record<string, unknown>;
}

export function isClientLogEvent(payload: unknown): payload is ClientLogEvent {
  if (!isRecord(payload)) {
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

  if (!isRecord(payload.page) || !isRecord(payload.browser) || !isRecord(payload.session)) {
    return false;
  }

  return (
    typeof payload.session.pageId === 'string' &&
    typeof payload.session.sessionId === 'string'
  );
}

export function normalizeEndpointPath(path: string | undefined): string {
  if (!path) {
    return DEFAULT_CLIENT_LOG_ENDPOINT;
  }

  return path.startsWith('/') ? path : `/${path}`;
}
