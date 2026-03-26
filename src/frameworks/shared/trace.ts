import { createRandomId } from '../../shared/client-log';
import {
  getActiveRequestTraceId as getRequestContextTraceId,
  setActiveRequestTraceId as setRequestContextTraceId,
} from './request-context';

export const BLYP_TRACE_HEADER = 'x-blyp-trace-id';
export const BLYP_TRACE_PREFIX = 'trace_';

export function createRequestTraceId(): string {
  return `${BLYP_TRACE_PREFIX}${createRandomId().replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 12)}`;
}

export function setActiveRequestTraceId(traceId: string | undefined): void {
  setRequestContextTraceId(traceId);
}

export function getActiveRequestTraceId(): string | undefined {
  return getRequestContextTraceId();
}

export function withTraceResponseHeader(response: Response, traceId: string): Response {
  const headers = new Headers(response.headers);
  headers.set(BLYP_TRACE_HEADER, traceId);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
