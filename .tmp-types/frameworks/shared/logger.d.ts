import { createBaseLogger } from '../../core/logger';
import type { ErrorLike, HttpRequestLog, RequestLike, ResolveLike } from '../../types/frameworks/http';
import type { ClientLogIngestionConfig, ResolvedServerLogger, ServerLoggerConfig } from '../../types/frameworks/shared';
import type { HttpErrorCaptureContext } from '../../types/frameworks/request-logger';
export declare function resolveClientLoggingConfig<Ctx>(clientLogging: ServerLoggerConfig<Ctx>['clientLogging'], defaultClientLogging: {
    enabled?: boolean;
    path?: string;
} | undefined): ClientLogIngestionConfig<Ctx> | null;
export declare function resolveServerLogger<Ctx>(config?: ServerLoggerConfig<Ctx>, loggerOverride?: ReturnType<typeof createBaseLogger>): ResolvedServerLogger<Ctx>;
export declare function shouldSkipAutoLogging<Ctx>(config: ResolvedServerLogger<Ctx>, ctx: Ctx, path: string): boolean;
export declare function shouldSkipErrorLogging<Ctx>(config: ResolvedServerLogger<Ctx>, path: string): boolean;
export declare function resolveAdditionalProps<Ctx>(config: ResolvedServerLogger<Ctx>, ctx: Ctx): Record<string, unknown>;
export declare function emitHttpRequestLog(logger: ResolvedServerLogger<unknown>['logger'], level: string, request: RequestLike, path: string, statusCode: number, responseTime: number, additionalProps?: Record<string, unknown>): HttpRequestLog;
export declare function emitHttpErrorLog(logger: ResolvedServerLogger<unknown>['logger'], level: string, request: RequestLike, path: string, statusCode: number, responseTime: number, error: ErrorLike | undefined, additionalProps?: Record<string, unknown>, captureContext?: HttpErrorCaptureContext): HttpRequestLog;
export declare function parseClientLogPayload(request: RequestLike & {
    json?: () => Promise<unknown>;
}, body?: unknown): Promise<unknown>;
export declare function handleClientLogIngestion<Ctx>(options: {
    config: ResolvedServerLogger<Ctx>;
    ctx: Ctx;
    request: RequestLike & {
        json?: () => Promise<unknown>;
    };
    body?: unknown;
    deliveryPath?: string;
}): Promise<{
    status: number;
    headers?: Record<string, string>;
}>;
export declare function readNodeRequestBody(stream: AsyncIterable<Uint8Array | string>): Promise<string>;
export declare function buildAbsoluteUrl(path: string, headers?: RequestLike['headers']): string;
export declare function resolveRequestStatus(ctx: ResolveLike, successCode?: number, errorCode?: number, isError?: boolean): number;
export declare function shouldAutoFlushServerLogger<Ctx>(config: ResolvedServerLogger<Ctx>): boolean;
export declare function flushServerLoggerSafely<Ctx>(config: ResolvedServerLogger<Ctx>): Promise<void>;
export { buildInfoLogMessage, buildRequestLogData, createRequestLike, extractPathname, isErrorStatus, toErrorLike, } from './http';
