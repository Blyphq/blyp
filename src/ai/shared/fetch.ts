import { logger as rootLogger } from '../../core/logger';
import { getActiveRequestLogger } from '../../frameworks/shared/request-context';
import { omitPaths, toLoggableValue, truncateValue } from './redaction';
import type { BlypLogger } from '../../core/logger';
import type { BlypProviderOptions } from './types';

export type BlypFetchOptions = Pick<
  BlypProviderOptions,
  'logger' | 'metadata' | 'limits' | 'exclude'
> & {
  inspectJsonBody?: boolean;
};

export function blypFetch(
  fetchImpl: typeof fetch,
  options: BlypFetchOptions = {}
): typeof fetch {
  const baseLogger = options.logger ?? getActiveRequestLogger() ?? rootLogger;
  const metadata = { ...(options.metadata ?? {}) };
  const maxContentBytes = options.limits?.maxContentBytes ?? 16_384;
  const excludeRequestPaths = options.exclude?.requestPaths ?? [];
  const excludeResponsePaths = options.exclude?.responsePaths ?? [];

  const wrappedFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const startedAt = performance.now();
    const startedAtIso = new Date().toISOString();
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    try {
      const response = await fetchImpl(input, init);
      const endedAt = new Date().toISOString();

      const structured = baseLogger.createStructuredLog(
        `fetch_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
        {
          type: 'fetch_trace',
          fetch: {
            url,
            method,
            status: response.status,
            startedAt: startedAtIso,
            endedAt,
            durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
            requestId:
              response.headers.get('x-request-id') ??
              response.headers.get('request-id') ??
              response.headers.get('cf-ray') ??
              undefined,
            metadata: omitPaths(metadata, options.exclude?.metadataPaths ?? []),
          },
        }
      );

      if (
        options.inspectJsonBody === true &&
        !response.bodyUsed &&
        response.headers.get('content-type')?.includes('application/json')
      ) {
        try {
          const clone = response.clone();
          const body = await clone.json();
          const captured = truncateValue(
            {
              request: omitPaths(toLoggableValue(init ?? {}) as Record<string, unknown>, excludeRequestPaths),
              response: omitPaths(toLoggableValue(body) as Record<string, unknown>, excludeResponsePaths),
            },
            maxContentBytes
          );
          structured.set({ fetchBody: captured.value });
        } catch {
          // Ignore body inspection failures.
        }
      }

      structured.emit({
        message: 'fetch_trace',
        level: response.ok ? 'info' : 'error',
      });

      return response;
    } catch (error) {
      const structured = baseLogger.createStructuredLog(
        `fetch_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
        {
          type: 'fetch_trace',
          fetch: {
            url,
            method,
            startedAt: startedAtIso,
            endedAt: new Date().toISOString(),
            durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
            metadata: omitPaths(metadata, options.exclude?.metadataPaths ?? []),
          },
        }
      );

      structured.emit({
        message: 'fetch_trace',
        level: 'error',
        error: toLoggableValue(error),
      });

      throw error;
    }
  }) as typeof fetch;

  if ('preconnect' in fetchImpl) {
    (wrappedFetch as typeof fetch & { preconnect?: typeof fetch.preconnect }).preconnect = fetchImpl.preconnect;
  }

  return wrappedFetch;
}
