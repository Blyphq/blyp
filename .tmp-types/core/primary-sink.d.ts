import type { BlypConfig } from './config';
import type { LogRecord } from './file-logger';
export interface BlypPrimarySink {
    write(record: LogRecord): void;
    flush(): Promise<void>;
    shutdown(): Promise<void>;
    readonly isAsync: boolean;
    readonly isReady: boolean;
}
export declare function createPrimarySink(config: BlypConfig): BlypPrimarySink;
