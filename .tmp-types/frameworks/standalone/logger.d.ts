import type { StandaloneLogger, StandaloneLoggerConfig } from '../../types/frameworks/standalone';
export type { StandaloneLogger } from '../../types/frameworks/standalone';
export declare function createStandaloneLogger(config?: StandaloneLoggerConfig): StandaloneLogger;
export declare function configureDefaultStandaloneLogger(config?: StandaloneLoggerConfig): StandaloneLogger;
export declare const logger: StandaloneLogger;
