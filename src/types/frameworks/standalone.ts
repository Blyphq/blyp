import type {
  BlypConnectorsConfig,
  ClientLoggingConfig,
  LogFileConfig,
  LogRotationConfig,
} from '../../core/config';

export type LogLevel = 'error' | 'critical' | 'warning' | 'info' | 'success' | 'debug' | 'table';

export interface StandaloneLoggerConfig {
  pretty?: boolean;
  level?: string;
  logDir?: string;
  file?: LogFileConfig;
  clientLogging?: ClientLoggingConfig;
  connectors?: BlypConnectorsConfig;
}

export type { BlypConnectorsConfig, ClientLoggingConfig, LogFileConfig, LogRotationConfig };

export type RuntimeType = 'bun' | 'node';

export interface RuntimeAdapter {
  readonly type: RuntimeType;
  readonly isBun: boolean;
  readonly isNode: boolean;

  file: {
    existsSync: (path: string) => boolean;
    mkdirSync: (path: string, options?: { recursive?: boolean }) => void;
    writeFileSync: (path: string, data: string) => void;
  };

  path: {
    join: (...paths: string[]) => string;
  };

  env: {
    get: (key: string) => string | undefined;
  };

  cwd: () => string;
}

export interface LogLevels {
  error: 0;
  critical: 1;
  warning: 2;
  info: 3;
  success: 4;
  debug: 5;
  table: 6;
  [key: string]: number;
}

export interface ColorConfig {
  error: string;
  critical: string;
  warning: string;
  info: string;
  success: string;
  debug: string;
  table: string;
}

export interface CallerLocation {
  file: string;
  line: number | null;
}
