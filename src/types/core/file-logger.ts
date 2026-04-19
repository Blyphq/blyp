import type { BetterAuthLogContext } from '../better-auth';
import type { WorkOsLogContext } from '../workos';

export type AuthLogContext = BetterAuthLogContext | WorkOsLogContext;

export interface LogRecord {
  timestamp: string;
  level: string;
  message: string;
  caller?: string;
  data?: unknown;
  bindings?: Record<string, unknown>;
  auth?: AuthLogContext;
  [key: string]: unknown;
}

export interface StreamState {
  activePath: string;
  archivePrefix: string;
  bytes: number;
  queue: string[];
  processing: boolean;
}

export interface FileLoggerDependencies {
  gzip?: (input: Buffer) => Buffer;
  warn?: (message: string, error?: unknown) => void;
}

export interface ResolvedFileLoggerConfig {
  enabled: boolean;
  dir: string;
  archiveDir: string;
  rotationEnabled: boolean;
  maxSizeBytes: number;
  maxArchives: number;
  compress: boolean;
}
