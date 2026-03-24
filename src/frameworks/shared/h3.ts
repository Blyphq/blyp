import type { BlypLogger } from '../../core/logger';
import { buildAbsoluteUrl, createRequestLike, readNodeRequestBody } from './logger';
import type {
  NitroEventLike,
  NitroResponseLike,
} from '../../types/frameworks/nitro';
import type { RequestLike } from '../../types/frameworks/http';

export interface NitroRequestState {
  startTime: number;
  path: string;
  structuredLogEmitted: boolean;
  scopedLogger?: BlypLogger;
  errorLogged?: boolean;
}

const BLYP_NITRO_STATE_KEY = Symbol.for('blyp.nitro.state');

export function getNitroState(event: NitroEventLike): NitroRequestState | undefined {
  return event.context[BLYP_NITRO_STATE_KEY] as NitroRequestState | undefined;
}

export function setNitroState(event: NitroEventLike, state: NitroRequestState): NitroRequestState {
  event.context[BLYP_NITRO_STATE_KEY] = state;
  return state;
}

export function getNitroMethod(event: NitroEventLike): string {
  return event.method ?? event.node?.req?.method ?? event.request?.method ?? 'GET';
}

export function getNitroHeaders(event: NitroEventLike): RequestLike['headers'] {
  return event.headers ?? event.node?.req?.headers ?? event.request?.headers;
}

export function getNitroUrl(event: NitroEventLike): string {
  if (event.request?.url) {
    return event.request.url;
  }

  const path = event.url ?? event.path ?? event.node?.req?.url ?? '/';
  return buildAbsoluteUrl(path, getNitroHeaders(event));
}

export function getNitroPath(event: NitroEventLike): string {
  if (typeof event.path === 'string' && event.path.length > 0) {
    return event.path;
  }

  if (event.request?.url) {
    return new URL(event.request.url).pathname;
  }

  const requestUrl = event.url ?? event.node?.req?.url ?? '/';
  if (requestUrl.startsWith('http://') || requestUrl.startsWith('https://')) {
    return new URL(requestUrl).pathname;
  }

  const queryIndex = requestUrl.indexOf('?');
  return queryIndex >= 0 ? requestUrl.slice(0, queryIndex) : requestUrl;
}

export function createNitroRequestLike(event: NitroEventLike): RequestLike {
  return createRequestLike(getNitroMethod(event), getNitroUrl(event), getNitroHeaders(event));
}

export function getNitroStatus(
  event: NitroEventLike,
  response?: NitroResponseLike | Response,
  fallbackStatus: number = 200
): number {
  if (response instanceof Response) {
    return response.status;
  }

  if (typeof response?.status === 'number') {
    return response.status;
  }

  if (typeof response?.statusCode === 'number') {
    return response.statusCode;
  }

  if (typeof event.node?.res?.statusCode === 'number' && event.node.res.statusCode > 0) {
    return event.node.res.statusCode;
  }

  return fallbackStatus;
}

export async function readNitroBody(event: NitroEventLike): Promise<unknown> {
  if (event.body !== undefined) {
    return event.body;
  }

  if (event.request) {
    const contentType = event.request.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      return await event.request.json();
    }

    return await event.request.text();
  }

  if (event.node?.req) {
    return await readNodeRequestBody(event.node.req);
  }

  throw new Error('Unable to parse Nitro request body');
}
