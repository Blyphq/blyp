import type { MiddlewareHandler } from 'hono';
import type { HonoLoggerConfig } from '../../types/frameworks/hono';
export declare function createHonoLogger(config?: HonoLoggerConfig): MiddlewareHandler;
export declare const createLogger: typeof createHonoLogger;
