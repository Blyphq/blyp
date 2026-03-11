import type { ExecutionContext } from '@nestjs/common';
import {
  buildAbsoluteUrl,
  createRequestLike,
  extractPathname,
  readNodeRequestBody,
} from '../shared';
import { isPlainObject } from '../../shared/validation';
import type {
  NestAdapterType,
  NestLoggerContext,
} from '../../types/frameworks/nestjs';

type NestHeaderRecord = Record<string, string | string[] | undefined>;

export function resolveNestAdapterType(
  request: unknown,
  response: unknown
): NestAdapterType {
  if (
    isPlainObject(response) &&
    'raw' in response &&
    response.raw !== undefined
  ) {
    return 'fastify';
  }

  if (
    isPlainObject(request) &&
    'raw' in request &&
    request.raw !== undefined
  ) {
    return 'fastify';
  }

  return 'express';
}

export function getNestRequestMethod(request: unknown): string {
  if (!isPlainObject(request)) {
    return 'GET';
  }

  if (typeof request.method === 'string') {
    return request.method;
  }

  if (isPlainObject(request.raw) && typeof request.raw.method === 'string') {
    return request.raw.method;
  }

  return 'GET';
}

export function getNestRequestHeaders(request: unknown): NestHeaderRecord | undefined {
  if (!isPlainObject(request)) {
    return undefined;
  }

  if (isPlainObject(request.headers)) {
    return request.headers as NestHeaderRecord;
  }

  if (isPlainObject(request.raw) && isPlainObject(request.raw.headers)) {
    return request.raw.headers as NestHeaderRecord;
  }

  return undefined;
}

export function getNestRequestUrl(request: unknown): string {
  if (!isPlainObject(request)) {
    return '/';
  }

  if (typeof request.originalUrl === 'string' && request.originalUrl.length > 0) {
    return request.originalUrl;
  }

  if (typeof request.url === 'string' && request.url.length > 0) {
    return request.url;
  }

  if (isPlainObject(request.raw) && typeof request.raw.url === 'string' && request.raw.url.length > 0) {
    return request.raw.url;
  }

  return '/';
}

export function getNestRequestPath(request: unknown): string {
  return extractPathname(getNestRequestUrl(request));
}

export async function readNestRequestBody(request: unknown): Promise<unknown> {
  if (!isPlainObject(request)) {
    return undefined;
  }

  if ('body' in request && request.body !== undefined) {
    return request.body;
  }

  if (isPlainObject(request.raw) && 'body' in request.raw && request.raw.body !== undefined) {
    return request.raw.body;
  }

  if (Symbol.asyncIterator in request) {
    return await readNodeRequestBody(
      request as AsyncIterable<Uint8Array | string>
    );
  }

  if (
    isPlainObject(request.raw) &&
    Symbol.asyncIterator in request.raw
  ) {
    return await readNodeRequestBody(
      request.raw as AsyncIterable<Uint8Array | string>
    );
  }

  return undefined;
}

export function setNestRequestStartTime(request: unknown, startTime: number): void {
  if (!isPlainObject(request)) {
    return;
  }

  request.blypStartTime = startTime;
}

export function getNestRequestStartTime(request: unknown): number | undefined {
  if (!isPlainObject(request)) {
    return undefined;
  }

  return typeof request.blypStartTime === 'number'
    ? request.blypStartTime
    : undefined;
}

export function setNestStructuredLogEmitted(request: unknown, emitted: boolean): void {
  if (!isPlainObject(request)) {
    return;
  }

  request.blypStructuredLogEmitted = emitted;
}

export function getNestStructuredLogEmitted(request: unknown): boolean {
  if (!isPlainObject(request)) {
    return false;
  }

  return request.blypStructuredLogEmitted === true;
}

export function attachNestRequestLogger(request: unknown, logger: unknown): void {
  if (!isPlainObject(request)) {
    return;
  }

  request.blypLog = logger;
}

export function buildNestRequestLike(request: unknown) {
  const method = getNestRequestMethod(request);
  const headers = getNestRequestHeaders(request);
  const path = getNestRequestUrl(request);
  return createRequestLike(method, buildAbsoluteUrl(path, headers), headers);
}

export function getNestResponseStatus(response: unknown): number {
  if (!isPlainObject(response)) {
    return 200;
  }

  if (typeof response.statusCode === 'number') {
    return response.statusCode;
  }

  if (isPlainObject(response.raw) && typeof response.raw.statusCode === 'number') {
    return response.raw.statusCode;
  }

  return 200;
}

function setRawStatus(target: Record<string, unknown>, statusCode: number): void {
  target.statusCode = statusCode;
}

export function setNestResponseHeaders(
  response: unknown,
  headers: Record<string, string>
): void {
  if (!isPlainObject(response)) {
    return;
  }

  if (typeof response.setHeader === 'function') {
    for (const [key, value] of Object.entries(headers)) {
      response.setHeader(key, value);
    }
    return;
  }

  if (typeof response.header === 'function') {
    for (const [key, value] of Object.entries(headers)) {
      response.header(key, value);
    }
    return;
  }

  if (isPlainObject(response.raw) && typeof response.raw.setHeader === 'function') {
    for (const [key, value] of Object.entries(headers)) {
      response.raw.setHeader(key, value);
    }
  }
}

export function sendNestStatusResponse(response: unknown, statusCode: number): void {
  if (!isPlainObject(response)) {
    return;
  }

  if (typeof response.status === 'function') {
    const expressResponse = response.status(statusCode) as { end?: () => void };
    expressResponse.end?.();
    return;
  }

  if (typeof response.code === 'function') {
    const fastifyReply = response.code(statusCode) as { send?: (payload?: unknown) => void };
    fastifyReply.send?.();
    return;
  }

  if (isPlainObject(response.raw)) {
    setRawStatus(response.raw, statusCode);
    if (typeof response.raw.end === 'function') {
      response.raw.end();
    }
    return;
  }

  setRawStatus(response, statusCode);
  if (typeof response.end === 'function') {
    response.end();
  }
}

export function getControllerName(context: ExecutionContext): string | undefined {
  const controller = context.getClass();
  return controller?.name || undefined;
}

export function getHandlerName(context: ExecutionContext): string | undefined {
  const handler = context.getHandler();
  return handler?.name || undefined;
}

export function createNestLoggerContext(options: {
  request: unknown;
  response: unknown;
  executionContext?: ExecutionContext;
  error?: unknown;
}): NestLoggerContext {
  const { request, response, executionContext, error } = options;
  const adapterType = resolveNestAdapterType(request, response);

  return {
    request,
    response,
    adapterType,
    executionContext,
    error,
    controllerName: executionContext ? getControllerName(executionContext) : undefined,
    handlerName: executionContext ? getHandlerName(executionContext) : undefined,
  };
}
