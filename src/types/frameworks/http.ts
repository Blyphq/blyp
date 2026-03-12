import type { BlypErrorLike } from '../shared/errors';

export type HeaderRecord = Record<string, string | string[] | undefined>;

export interface RequestLike {
  method: string;
  url: string;
  headers?: Headers | HeaderRecord | { get(name: string): string | null };
}

export interface ErrorLike extends BlypErrorLike {}

export interface ResolveLike {
  set?: { status?: number | string };
  error?: ErrorLike;
  code?: string | number;
  statusCode?: number;
}

export interface HttpRequestLog {
  type: 'http_request' | 'http_error';
  method: string;
  url: string;
  statusCode: number;
  responseTime: number;
  hostname?: string;
  ip?: string;
  forwardedFor?: string[];
  protocol?: string;
  port?: string;
  userAgent?: string;
  origin?: string;
  referer?: string;
  acceptLanguage?: string;
  client?: {
    ip?: string;
    hostname?: string;
    browser?: string;
    os?: string;
    deviceType?: 'desktop' | 'mobile' | 'tablet' | 'bot' | 'unknown';
    platform?: string;
    isMobile?: boolean;
  };
  error?: string;
  stack?: string;
  [key: string]: unknown;
}
