import type { NextJsLoggerConfig, NextJsLoggerFactory } from '../../types/frameworks/nextjs';
export declare function createNextJsLogger(config?: NextJsLoggerConfig): NextJsLoggerFactory;
export declare const createLogger: typeof createNextJsLogger;
