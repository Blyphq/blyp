import { createWarnOnceLogger } from '../shared/once';
import type { BlypConfig } from './config';
import type { LogRecord } from './file-logger';
import type { ResolvedDatabaseLoggerConfig } from '../types/database';
import { createFilePrimarySink } from './sinks/file-primary-sink';
import { DatabasePrimarySink } from './sinks/database-primary-sink';

export interface BlypPrimarySink {
  write(record: LogRecord): void;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
  readonly isAsync: boolean;
  readonly isReady: boolean;
}

class NoopPrimarySink implements BlypPrimarySink {
  readonly isAsync = false;

  readonly isReady = false;

  write(_record: LogRecord): void {}

  async flush(): Promise<void> {}

  async shutdown(): Promise<void> {}
}

const warnOnce = createWarnOnceLogger(new Set<string>());

export function createPrimarySink(config: BlypConfig): BlypPrimarySink {
  if (config.destination === 'cloud') {
    return new NoopPrimarySink();
  }

  if (config.destination !== 'database') {
    return createFilePrimarySink(config);
  }

  const databaseConfig = config.database as ResolvedDatabaseLoggerConfig | undefined;
  if (!databaseConfig?.ready) {
    warnOnce(
      'database-sink-disabled',
      '[Blyp] Warning: Database destination is configured but not ready. Falling back to a no-op primary sink.'
    );
    return new NoopPrimarySink();
  }

  return new DatabasePrimarySink(databaseConfig);
}
