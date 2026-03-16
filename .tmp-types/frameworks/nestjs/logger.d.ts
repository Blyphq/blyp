import { type StandaloneLogger } from '../standalone/logger';
import type { NestLoggerConfig, NestLoggerState } from '../../types/frameworks/nestjs';
export declare function createNestLogger(config?: NestLoggerConfig): StandaloneLogger;
export declare const createLogger: typeof createNestLogger;
export declare function getNestLoggerStateOrThrow(): NestLoggerState;
export declare function resetNestLoggerState(): void;
