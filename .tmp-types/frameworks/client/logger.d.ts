import type { ClientLogger, ClientLoggerConfig } from '../../types/frameworks/client';
export declare function createClientLogger(config?: ClientLoggerConfig): ClientLogger;
export declare const logger: ClientLogger;
export declare function resetClientWarningsForTests(): void;
