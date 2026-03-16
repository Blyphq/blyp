import type { BlypErrorCode, BlypErrorLike, CreateCodeFunction, ErrorConstructionInput, ErrorLogLevel, ErrorLoggerLike, HttpCodeRegistry, ParseErrorOptions, ParseableErrorPayload as BaseParseableErrorPayload, ResolvedErrorConfig } from '../types/shared/errors';
export type { BlypErrorCode, BlypErrorCodeDefinition, BlypErrorLike, ErrorConstructionInput, ErrorLogLevel, ErrorLoggerLike, ParseErrorOptions, ResolvedErrorConfig, } from '../types/shared/errors';
export type ParseableErrorPayload = BaseParseableErrorPayload | BlypError;
export declare const HTTP_STATUS_DEFINITIONS: {
    readonly CONTINUE: {
        readonly status: 100;
        readonly message: "Continue";
    };
    readonly SWITCHING_PROTOCOLS: {
        readonly status: 101;
        readonly message: "Switching Protocols";
    };
    readonly PROCESSING: {
        readonly status: 102;
        readonly message: "Processing";
    };
    readonly EARLY_HINTS: {
        readonly status: 103;
        readonly message: "Early Hints";
    };
    readonly OK: {
        readonly status: 200;
        readonly message: "OK";
    };
    readonly CREATED: {
        readonly status: 201;
        readonly message: "Created";
    };
    readonly ACCEPTED: {
        readonly status: 202;
        readonly message: "Accepted";
    };
    readonly NON_AUTHORITATIVE_INFORMATION: {
        readonly status: 203;
        readonly message: "Non-Authoritative Information";
    };
    readonly NO_CONTENT: {
        readonly status: 204;
        readonly message: "No Content";
    };
    readonly RESET_CONTENT: {
        readonly status: 205;
        readonly message: "Reset Content";
    };
    readonly PARTIAL_CONTENT: {
        readonly status: 206;
        readonly message: "Partial Content";
    };
    readonly MULTI_STATUS: {
        readonly status: 207;
        readonly message: "Multi-Status";
    };
    readonly ALREADY_REPORTED: {
        readonly status: 208;
        readonly message: "Already Reported";
    };
    readonly IM_USED: {
        readonly status: 226;
        readonly message: "IM Used";
    };
    readonly MULTIPLE_CHOICES: {
        readonly status: 300;
        readonly message: "Multiple Choices";
    };
    readonly MOVED_PERMANENTLY: {
        readonly status: 301;
        readonly message: "Moved Permanently";
    };
    readonly FOUND: {
        readonly status: 302;
        readonly message: "Found";
    };
    readonly SEE_OTHER: {
        readonly status: 303;
        readonly message: "See Other";
    };
    readonly NOT_MODIFIED: {
        readonly status: 304;
        readonly message: "Not Modified";
    };
    readonly USE_PROXY: {
        readonly status: 305;
        readonly message: "Use Proxy";
    };
    readonly TEMPORARY_REDIRECT: {
        readonly status: 307;
        readonly message: "Temporary Redirect";
    };
    readonly PERMANENT_REDIRECT: {
        readonly status: 308;
        readonly message: "Permanent Redirect";
    };
    readonly BAD_REQUEST: {
        readonly status: 400;
        readonly message: "Bad Request";
    };
    readonly UNAUTHORIZED: {
        readonly status: 401;
        readonly message: "Unauthorized";
    };
    readonly PAYMENT_REQUIRED: {
        readonly status: 402;
        readonly message: "Payment Required";
    };
    readonly FORBIDDEN: {
        readonly status: 403;
        readonly message: "Forbidden";
    };
    readonly NOT_FOUND: {
        readonly status: 404;
        readonly message: "Not Found";
    };
    readonly METHOD_NOT_ALLOWED: {
        readonly status: 405;
        readonly message: "Method Not Allowed";
    };
    readonly NOT_ACCEPTABLE: {
        readonly status: 406;
        readonly message: "Not Acceptable";
    };
    readonly PROXY_AUTHENTICATION_REQUIRED: {
        readonly status: 407;
        readonly message: "Proxy Authentication Required";
    };
    readonly REQUEST_TIMEOUT: {
        readonly status: 408;
        readonly message: "Request Timeout";
    };
    readonly CONFLICT: {
        readonly status: 409;
        readonly message: "Conflict";
    };
    readonly GONE: {
        readonly status: 410;
        readonly message: "Gone";
    };
    readonly LENGTH_REQUIRED: {
        readonly status: 411;
        readonly message: "Length Required";
    };
    readonly PRECONDITION_FAILED: {
        readonly status: 412;
        readonly message: "Precondition Failed";
    };
    readonly PAYLOAD_TOO_LARGE: {
        readonly status: 413;
        readonly message: "Payload Too Large";
    };
    readonly URI_TOO_LONG: {
        readonly status: 414;
        readonly message: "URI Too Long";
    };
    readonly UNSUPPORTED_MEDIA_TYPE: {
        readonly status: 415;
        readonly message: "Unsupported Media Type";
    };
    readonly RANGE_NOT_SATISFIABLE: {
        readonly status: 416;
        readonly message: "Range Not Satisfiable";
    };
    readonly EXPECTATION_FAILED: {
        readonly status: 417;
        readonly message: "Expectation Failed";
    };
    readonly IM_A_TEAPOT: {
        readonly status: 418;
        readonly message: "I'm a Teapot";
    };
    readonly MISDIRECTED_REQUEST: {
        readonly status: 421;
        readonly message: "Misdirected Request";
    };
    readonly UNPROCESSABLE_ENTITY: {
        readonly status: 422;
        readonly message: "Unprocessable Entity";
    };
    readonly LOCKED: {
        readonly status: 423;
        readonly message: "Locked";
    };
    readonly FAILED_DEPENDENCY: {
        readonly status: 424;
        readonly message: "Failed Dependency";
    };
    readonly TOO_EARLY: {
        readonly status: 425;
        readonly message: "Too Early";
    };
    readonly UPGRADE_REQUIRED: {
        readonly status: 426;
        readonly message: "Upgrade Required";
    };
    readonly PRECONDITION_REQUIRED: {
        readonly status: 428;
        readonly message: "Precondition Required";
    };
    readonly TOO_MANY_REQUESTS: {
        readonly status: 429;
        readonly message: "Too Many Requests";
    };
    readonly REQUEST_HEADER_FIELDS_TOO_LARGE: {
        readonly status: 431;
        readonly message: "Request Header Fields Too Large";
    };
    readonly UNAVAILABLE_FOR_LEGAL_REASONS: {
        readonly status: 451;
        readonly message: "Unavailable For Legal Reasons";
    };
    readonly INTERNAL_SERVER_ERROR: {
        readonly status: 500;
        readonly message: "Internal Server Error";
    };
    readonly NOT_IMPLEMENTED: {
        readonly status: 501;
        readonly message: "Not Implemented";
    };
    readonly BAD_GATEWAY: {
        readonly status: 502;
        readonly message: "Bad Gateway";
    };
    readonly SERVICE_UNAVAILABLE: {
        readonly status: 503;
        readonly message: "Service Unavailable";
    };
    readonly GATEWAY_TIMEOUT: {
        readonly status: 504;
        readonly message: "Gateway Timeout";
    };
    readonly HTTP_VERSION_NOT_SUPPORTED: {
        readonly status: 505;
        readonly message: "HTTP Version Not Supported";
    };
    readonly VARIANT_ALSO_NEGOTIATES: {
        readonly status: 506;
        readonly message: "Variant Also Negotiates";
    };
    readonly INSUFFICIENT_STORAGE: {
        readonly status: 507;
        readonly message: "Insufficient Storage";
    };
    readonly LOOP_DETECTED: {
        readonly status: 508;
        readonly message: "Loop Detected";
    };
    readonly BANDWIDTH_LIMIT_EXCEEDED: {
        readonly status: 509;
        readonly message: "Bandwidth Limit Exceeded";
    };
    readonly NOT_EXTENDED: {
        readonly status: 510;
        readonly message: "Not Extended";
    };
    readonly NETWORK_AUTHENTICATION_REQUIRED: {
        readonly status: 511;
        readonly message: "Network Authentication Required";
    };
};
export declare class BlypError extends Error implements BlypErrorLike {
    readonly name = "BlypError";
    readonly status: number;
    readonly statusCode: number;
    readonly code?: string | number;
    readonly why?: string;
    readonly fix?: string;
    readonly link?: string;
    readonly details?: Record<string, unknown>;
    readonly cause?: unknown;
    readonly logLevel: ErrorLogLevel;
    constructor(config: ResolvedErrorConfig);
    toJSON(): {
        name: 'BlypError';
        message: string;
        status: number;
        statusCode: number;
        code?: string | number;
        why?: string;
        fix?: string;
        link?: string;
        details?: Record<string, unknown>;
    };
}
export declare function resolveErrorLogLevel(status: number, explicit?: ErrorLogLevel): ErrorLogLevel;
export declare function normalizeCauseForLog(cause: unknown): unknown;
export declare function emitErrorLog(logger: ErrorLoggerLike, error: BlypError, levelOverride?: ErrorLogLevel): void;
export declare function resolveErrorConfig(input: BlypErrorLike & {
    status?: number;
    logLevel?: ErrorLogLevel;
}, defaults?: Partial<ResolvedErrorConfig>): ResolvedErrorConfig;
export declare function createBlypError(input: ErrorConstructionInput, defaults?: Partial<ResolvedErrorConfig>): BlypError;
export declare function buildHttpCodeRegistry(createErrorFromCode?: CreateCodeFunction): HttpCodeRegistry<keyof typeof HTTP_STATUS_DEFINITIONS>;
export declare const HTTP_CODES: Readonly<Record<"OK" | "CONTINUE" | "SWITCHING_PROTOCOLS" | "PROCESSING" | "EARLY_HINTS" | "CREATED" | "ACCEPTED" | "NON_AUTHORITATIVE_INFORMATION" | "NO_CONTENT" | "RESET_CONTENT" | "PARTIAL_CONTENT" | "MULTI_STATUS" | "ALREADY_REPORTED" | "IM_USED" | "MULTIPLE_CHOICES" | "MOVED_PERMANENTLY" | "FOUND" | "SEE_OTHER" | "NOT_MODIFIED" | "USE_PROXY" | "TEMPORARY_REDIRECT" | "PERMANENT_REDIRECT" | "BAD_REQUEST" | "UNAUTHORIZED" | "PAYMENT_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "METHOD_NOT_ALLOWED" | "NOT_ACCEPTABLE" | "PROXY_AUTHENTICATION_REQUIRED" | "REQUEST_TIMEOUT" | "CONFLICT" | "GONE" | "LENGTH_REQUIRED" | "PRECONDITION_FAILED" | "PAYLOAD_TOO_LARGE" | "URI_TOO_LONG" | "UNSUPPORTED_MEDIA_TYPE" | "RANGE_NOT_SATISFIABLE" | "EXPECTATION_FAILED" | "IM_A_TEAPOT" | "MISDIRECTED_REQUEST" | "UNPROCESSABLE_ENTITY" | "LOCKED" | "FAILED_DEPENDENCY" | "TOO_EARLY" | "UPGRADE_REQUIRED" | "PRECONDITION_REQUIRED" | "TOO_MANY_REQUESTS" | "REQUEST_HEADER_FIELDS_TOO_LARGE" | "UNAVAILABLE_FOR_LEGAL_REASONS" | "INTERNAL_SERVER_ERROR" | "NOT_IMPLEMENTED" | "BAD_GATEWAY" | "SERVICE_UNAVAILABLE" | "GATEWAY_TIMEOUT" | "HTTP_VERSION_NOT_SUPPORTED" | "VARIANT_ALSO_NEGOTIATES" | "INSUFFICIENT_STORAGE" | "LOOP_DETECTED" | "BANDWIDTH_LIMIT_EXCEEDED" | "NOT_EXTENDED" | "NETWORK_AUTHENTICATION_REQUIRED", BlypErrorCode>>;
export declare function getHttpCode(status: number): BlypErrorCode | undefined;
export declare function extractErrorCandidate(payload: unknown): BlypErrorLike | string | undefined;
export declare function readResponseErrorPayload(response: Response): Promise<unknown>;
export declare function parseError(input: Response, options?: ParseErrorOptions): Promise<BlypError>;
export declare function parseError(input: ParseableErrorPayload, options?: ParseErrorOptions): BlypError;
