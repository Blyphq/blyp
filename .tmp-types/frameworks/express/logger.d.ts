import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { ExpressLoggerConfig } from '../../types/frameworks/express';
export declare function createExpressLogger(config?: ExpressLoggerConfig): RequestHandler;
export declare function createExpressErrorLogger(_config?: ExpressLoggerConfig): ErrorRequestHandler;
export declare const createLogger: typeof createExpressLogger;
