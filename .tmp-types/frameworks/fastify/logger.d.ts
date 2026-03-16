import type { FastifyPluginAsync } from 'fastify';
import type { FastifyLoggerConfig } from '../../types/frameworks/fastify';
export declare function createFastifyLogger(config?: FastifyLoggerConfig): FastifyPluginAsync;
export declare const createLogger: typeof createFastifyLogger;
