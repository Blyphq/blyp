import type { TanStackStartLoggerConfig, TanStackStartLoggerFactory } from '../../types/frameworks/tanstack-start';
export declare function createTanStackStartLogger(config?: TanStackStartLoggerConfig): TanStackStartLoggerFactory;
export declare const createLogger: typeof createTanStackStartLogger;
