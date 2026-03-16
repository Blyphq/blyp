import type { LogRecord } from '../file-logger';
import { createFileLogger, type RotatingFileLogger } from '../file-logger';
import type { BlypConfig } from '../config';
import type { BlypPrimarySink } from '../primary-sink';

export class FilePrimarySink implements BlypPrimarySink {
  readonly isAsync = false;

  readonly isReady = true;

  constructor(private readonly logger: RotatingFileLogger) {}

  write(record: LogRecord): void {
    this.logger.write(record);
  }

  async flush(): Promise<void> {}

  async shutdown(): Promise<void> {}
}

export function createFilePrimarySink(config: BlypConfig): FilePrimarySink {
  return new FilePrimarySink(createFileLogger(config));
}
