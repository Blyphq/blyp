import type { SvelteKitLoggerConfig, SvelteKitLoggerFactory } from '../../types/frameworks/sveltekit';
export declare function createSvelteKitLogger(config?: SvelteKitLoggerConfig): SvelteKitLoggerFactory;
export declare const createLogger: typeof createSvelteKitLogger;
