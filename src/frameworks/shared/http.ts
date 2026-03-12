import { getArrowForMethod, getMethodColor, getResponseTimeColor, getStatusColor } from '../../core/colors';
import type {
  ErrorLike,
  HeaderRecord,
  HttpRequestLog,
  RequestLike,
} from '../../types/frameworks/http';

export type { ErrorLike, HeaderRecord, HttpRequestLog, RequestLike, ResolveLike } from '../../types/frameworks/http';

export function getHeaderValue(
  headers: RequestLike['headers'],
  name: string
): string | undefined {
  if (!headers) {
    return undefined;
  }

  if (headers instanceof Headers) {
    return headers.get(name) ?? headers.get(name.toLowerCase()) ?? undefined;
  }

  if (typeof (headers as { get?: unknown }).get === 'function') {
    const direct = (headers as { get(name: string): string | null }).get(name);
    return direct ?? (headers as { get(name: string): string | null }).get(name.toLowerCase()) ?? undefined;
  }

  const record = headers as HeaderRecord;
  const direct = record[name] ?? record[name.toLowerCase()];
  if (Array.isArray(direct)) {
    return direct[0];
  }

  return direct;
}

function parseForwardedHeader(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const match = entry.match(/for="?(\[[^\]]+\]|[^;,\s"]+)/i);
      return match?.[1]?.replace(/^"|"$/g, '') ?? '';
    })
    .map((entry) => entry.replace(/^\[|\]$/g, ''))
    .filter(Boolean);
}

function parseForwardedFor(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function stripPort(host: string): string {
  if (host.startsWith('[')) {
    const endIndex = host.indexOf(']');
    return endIndex >= 0 ? host.slice(1, endIndex) : host;
  }

  return host.replace(/:\d+$/, '');
}

function detectBrowser(userAgent: string): string {
  if (/edg\//i.test(userAgent)) return 'Edge';
  if (/opr\//i.test(userAgent) || /opera/i.test(userAgent)) return 'Opera';
  if (/chrome\//i.test(userAgent) && !/edg\//i.test(userAgent)) return 'Chrome';
  if (/firefox\//i.test(userAgent)) return 'Firefox';
  if (/safari\//i.test(userAgent) && !/chrome\//i.test(userAgent)) return 'Safari';
  if (/curl\//i.test(userAgent)) return 'curl';
  if (/postmanruntime/i.test(userAgent)) return 'Postman';
  return 'Unknown';
}

function detectOperatingSystem(userAgent: string): string {
  if (/windows/i.test(userAgent)) return 'Windows';
  if (/android/i.test(userAgent)) return 'Android';
  if (/iphone|ipad|ipod/i.test(userAgent)) return 'iOS';
  if (/mac os x|macintosh/i.test(userAgent)) return 'macOS';
  if (/linux/i.test(userAgent)) return 'Linux';
  return 'Unknown';
}

function detectDeviceType(userAgent: string): 'desktop' | 'mobile' | 'tablet' | 'bot' | 'unknown' {
  if (!userAgent) return 'unknown';
  if (/bot|crawler|spider|curl|wget|postmanruntime/i.test(userAgent)) return 'bot';
  if (/ipad|tablet/i.test(userAgent)) return 'tablet';
  if (/mobi|iphone|android/i.test(userAgent)) return 'mobile';
  return 'desktop';
}

export function extractPathname(requestUrl: string, fallbackPath: string = '/'): string {
  if (!requestUrl) {
    return fallbackPath;
  }

  if (requestUrl.startsWith('http://') || requestUrl.startsWith('https://')) {
    try {
      return new URL(requestUrl).pathname || fallbackPath;
    } catch {
      return fallbackPath;
    }
  }

  if (requestUrl.startsWith('/')) {
    const queryIndex = requestUrl.indexOf('?');
    return queryIndex >= 0 ? requestUrl.slice(0, queryIndex) : requestUrl;
  }

  try {
    return new URL(requestUrl, 'http://localhost').pathname || fallbackPath;
  } catch {
    return fallbackPath;
  }
}

export function createRequestLike(
  method: string,
  url: string,
  headers?: RequestLike['headers']
): RequestLike {
  return { method, url, headers };
}

export function buildClientDetails(
  request: RequestLike,
  fallbackPath?: string
): Omit<HttpRequestLog, 'type' | 'method' | 'url' | 'statusCode' | 'responseTime' | 'error' | 'stack'> {
  const pathname = fallbackPath ?? extractPathname(request.url);
  const urlObject = (() => {
    try {
      return new URL(request.url);
    } catch {
      try {
        return new URL(pathname, 'http://localhost');
      } catch {
        return null;
      }
    }
  })();

  const hostHeader =
    getHeaderValue(request.headers, 'x-forwarded-host') ??
    getHeaderValue(request.headers, 'host') ??
    urlObject?.host ??
    undefined;
  const hostname = hostHeader ? stripPort(hostHeader) : urlObject?.hostname;
  const port = hostHeader?.match(/:(\d+)$/)?.[1] ?? (urlObject?.port || undefined);
  const xForwardedFor = parseForwardedFor(getHeaderValue(request.headers, 'x-forwarded-for'));
  const forwardedFor = parseForwardedHeader(getHeaderValue(request.headers, 'forwarded'));
  const ipCandidates = [
    getHeaderValue(request.headers, 'cf-connecting-ip'),
    getHeaderValue(request.headers, 'true-client-ip'),
    getHeaderValue(request.headers, 'fly-client-ip'),
    getHeaderValue(request.headers, 'x-real-ip'),
    getHeaderValue(request.headers, 'x-client-ip'),
    xForwardedFor[0],
    forwardedFor[0],
  ].filter((value): value is string => Boolean(value));
  const userAgent = getHeaderValue(request.headers, 'user-agent');
  const platform =
    getHeaderValue(request.headers, 'sec-ch-ua-platform')?.replace(/^"|"$/g, '') ??
    undefined;
  const deviceType = detectDeviceType(userAgent ?? '');

  return {
    hostname,
    ip: ipCandidates[0],
    forwardedFor: [...xForwardedFor, ...forwardedFor].filter((value, index, values) => {
      return values.indexOf(value) === index;
    }),
    protocol:
      getHeaderValue(request.headers, 'x-forwarded-proto') ??
      (urlObject?.protocol ? urlObject.protocol.replace(/:$/, '') : undefined),
    port,
    userAgent,
    origin: getHeaderValue(request.headers, 'origin'),
    referer: getHeaderValue(request.headers, 'referer'),
    acceptLanguage: getHeaderValue(request.headers, 'accept-language'),
    client: {
      ip: ipCandidates[0],
      hostname,
      browser: userAgent ? detectBrowser(userAgent) : undefined,
      os: userAgent ? detectOperatingSystem(userAgent) : undefined,
      deviceType,
      platform,
      isMobile: deviceType === 'mobile',
    },
  };
}

export function buildRequestLogData(
  request: RequestLike,
  type: 'http_request' | 'http_error',
  path: string,
  statusCode: number,
  responseTime: number,
  extra: Record<string, unknown> = {}
): HttpRequestLog {
  return {
    type,
    method: request.method,
    url: path,
    statusCode,
    responseTime,
    ...buildClientDetails(request, path),
    ...extra,
  };
}

export function buildInfoLogMessage(
  method: string,
  statusCode: number,
  url: string,
  responseTime: number
): string {
  const methodColor = getMethodColor(method);
  const statusColor = getStatusColor(statusCode);
  const timeColor = getResponseTimeColor(responseTime);
  const arrow = getArrowForMethod(method);
  return `${methodColor} ${arrow} ${statusColor} ${url} ${timeColor}`;
}

export function toErrorLike(error: unknown, fallbackStatusCode?: number): ErrorLike | undefined {
  if (error === undefined || error === null) {
    return fallbackStatusCode === undefined
      ? undefined
      : { statusCode: fallbackStatusCode, message: `HTTP ${fallbackStatusCode}` };
  }

  if (error instanceof Error) {
    const errorWithStatus = error as ErrorLike;
    return {
      status: errorWithStatus.status,
      statusCode: errorWithStatus.statusCode ?? fallbackStatusCode,
      code: errorWithStatus.code,
      message: error.message,
      stack: error.stack,
      why: errorWithStatus.why,
      fix: errorWithStatus.fix,
      link: errorWithStatus.link,
      details: errorWithStatus.details,
      cause: errorWithStatus.cause,
    };
  }

  if (typeof error === 'object') {
    const record = error as Record<string, unknown>;
    return {
      status: typeof record.status === 'number' ? record.status : undefined,
      statusCode:
        typeof record.statusCode === 'number'
          ? record.statusCode
          : fallbackStatusCode,
      code:
        typeof record.code === 'string' || typeof record.code === 'number'
          ? record.code
          : undefined,
      message: typeof record.message === 'string' ? record.message : `HTTP ${fallbackStatusCode ?? 500}`,
      stack: typeof record.stack === 'string' ? record.stack : undefined,
      why: typeof record.why === 'string' ? record.why : undefined,
      fix: typeof record.fix === 'string' ? record.fix : undefined,
      link: typeof record.link === 'string' ? record.link : undefined,
      details:
        record.details !== null && typeof record.details === 'object' && !Array.isArray(record.details)
          ? record.details as Record<string, unknown>
          : undefined,
      cause: record.cause,
    };
  }

  return {
    statusCode: fallbackStatusCode,
    message: typeof error === 'string' ? error : `HTTP ${fallbackStatusCode ?? 500}`,
  };
}

export function isErrorStatus(statusCode: number): boolean {
  return statusCode >= 400;
}
