import type { WorkersLoggerConfig, WorkersRequestLogger } from '../../types/frameworks/workers';
export declare function initWorkersLogger(config?: WorkersLoggerConfig): void;
export declare function createWorkersLogger(request: Request): WorkersRequestLogger;
