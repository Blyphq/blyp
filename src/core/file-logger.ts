import fs from 'fs';
import path from 'path';
import { gzipSync } from 'fflate';
import type { BlypConfig } from './config';
import type {
  FileLoggerDependencies,
  LogRecord,
  ResolvedFileLoggerConfig,
  StreamState,
} from '../types/core/file-logger';

export type { LogRecord } from '../types/core/file-logger';

function gzipBuffer(buf: Buffer): Buffer {
  return Buffer.from(gzipSync(buf));
}

function warnWithConsole(message: string, error?: unknown): void {
  console.warn(`[Blyp] Warning: ${message}`, error);
}

function ensureDirectory(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function getFileSize(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function formatArchiveTimestamp(timestamp: Date): string {
  const year = timestamp.getUTCFullYear();
  const month = String(timestamp.getUTCMonth() + 1).padStart(2, '0');
  const day = String(timestamp.getUTCDate()).padStart(2, '0');
  const hours = String(timestamp.getUTCHours()).padStart(2, '0');
  const minutes = String(timestamp.getUTCMinutes()).padStart(2, '0');
  const seconds = String(timestamp.getUTCSeconds()).padStart(2, '0');
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

function getUniqueArchivePath(basePath: string, extension: string): string {
  let candidate = `${basePath}${extension}`;
  let suffix = 1;

  while (fs.existsSync(candidate)) {
    candidate = `${basePath}-${suffix}${extension}`;
    suffix += 1;
  }

  return candidate;
}

function pruneArchives(
  archiveDir: string,
  archivePrefix: string,
  maxArchives: number,
  warn: (message: string, error?: unknown) => void
): void {
  const prefix = `${archivePrefix}.`;

  try {
    const archivePaths = fs
      .readdirSync(archiveDir)
      .filter((name) =>
        name.startsWith(prefix) &&
        (name.endsWith('.ndjson') || name.endsWith('.ndjson.gz'))
      )
      .map((name) => path.join(archiveDir, name))
      .sort((left, right) => {
        return fs.statSync(left).mtimeMs - fs.statSync(right).mtimeMs;
      });

    const deleteCount = Math.max(archivePaths.length - maxArchives, 0);

    for (let index = 0; index < deleteCount; index += 1) {
      fs.rmSync(archivePaths[index]!);
    }
  } catch (error) {
    warn(`Failed to prune archives for ${archivePrefix}`, error);
  }
}

function createSafeReplacer() {
  const seen = new WeakSet<object>();

  return (_key: string, value: unknown) => {
    if (typeof value === 'function') {
      return `[Function: ${value.name || 'anonymous'}]`;
    }

    if (value === undefined) {
      return '[undefined]';
    }

    if (typeof value === 'symbol') {
      return value.toString();
    }

    if (value !== null && typeof value === 'object') {
      if (seen.has(value)) {
        return '[Circular]';
      }

      seen.add(value);
    }

    return value;
  };
}

export function serializeLogRecord(record: LogRecord): string {
  return JSON.stringify(record, createSafeReplacer());
}

function resolveFileLoggerConfig(config: BlypConfig): ResolvedFileLoggerConfig {
  const fileConfig = config.file;
  const dir = fileConfig?.dir || config.logDir || path.join(process.cwd(), 'logs');
  const archiveDir = fileConfig?.archiveDir || path.join(dir, 'archive');
  const rotation = fileConfig?.rotation;

  return {
    enabled: fileConfig?.enabled ?? true,
    dir,
    archiveDir,
    rotationEnabled: rotation?.enabled ?? true,
    maxSizeBytes: rotation?.maxSizeBytes ?? 10 * 1024 * 1024,
    maxArchives: rotation?.maxArchives ?? 5,
    compress: rotation?.compress ?? true,
  };
}

export class RotatingFileLogger {
  private readonly config: ResolvedFileLoggerConfig;
  private readonly gzip: (input: Buffer) => Buffer;
  private readonly warn: (message: string, error?: unknown) => void;
  private readonly combined: StreamState;
  private readonly error: StreamState;

  constructor(config: BlypConfig, dependencies: FileLoggerDependencies = {}) {
    this.config = resolveFileLoggerConfig(config);
    this.gzip = dependencies.gzip ?? gzipBuffer;
    this.warn = dependencies.warn ?? warnWithConsole;
    this.combined = {
      activePath: path.join(this.config.dir, 'log.ndjson'),
      archivePrefix: 'log',
      bytes: 0,
      queue: [],
      processing: false,
    };
    this.error = {
      activePath: path.join(this.config.dir, 'log.error.ndjson'),
      archivePrefix: 'log.error',
      bytes: 0,
      queue: [],
      processing: false,
    };

    if (!this.config.enabled) {
      return;
    }

    ensureDirectory(this.config.dir);
    ensureDirectory(this.config.archiveDir);
    this.seedStream(this.combined);
    this.seedStream(this.error);
  }

  write(record: LogRecord): void {
    if (!this.config.enabled) {
      return;
    }

    const line = `${serializeLogRecord(record)}\n`;
    this.enqueue(this.combined, line);

    if (record.level === 'error' || record.level === 'critical') {
      this.enqueue(this.error, line);
    }
  }

  private enqueue(stream: StreamState, line: string): void {
    stream.queue.push(line);
    this.processQueue(stream);
  }

  private processQueue(stream: StreamState): void {
    if (stream.processing) {
      return;
    }

    stream.processing = true;

    try {
      while (stream.queue.length > 0) {
        const queuedLine = stream.queue.shift();
        if (queuedLine === undefined) {
          continue;
        }

        try {
          this.append(stream, queuedLine);
        } catch (error) {
          this.warn(`Failed writing log line for ${stream.archivePrefix}`, error);
        }
      }
    } finally {
      stream.processing = false;
    }
  }

  private seedStream(stream: StreamState): void {
    stream.bytes = getFileSize(stream.activePath);

    if (this.config.rotationEnabled && stream.bytes > this.config.maxSizeBytes && stream.bytes > 0) {
      this.rotate(stream);
      fs.closeSync(fs.openSync(stream.activePath, 'a'));
      stream.bytes = 0;
    }
  }

  private append(stream: StreamState, line: string): void {
    ensureDirectory(this.config.dir);
    const lineBytes = Buffer.byteLength(line, 'utf8');

    if (
      this.config.rotationEnabled &&
      stream.bytes > 0 &&
      stream.bytes + lineBytes > this.config.maxSizeBytes
    ) {
      this.rotate(stream);
    }

    fs.appendFileSync(stream.activePath, line, 'utf8');
    stream.bytes += lineBytes;
  }

  private rotate(stream: StreamState): void {
    ensureDirectory(this.config.archiveDir);
    if (!fs.existsSync(stream.activePath) || stream.bytes === 0) {
      stream.bytes = 0;
      return;
    }

    const archiveTimestamp = formatArchiveTimestamp(new Date());
    const archiveBasePath = path.join(
      this.config.archiveDir,
      `${stream.archivePrefix}.${archiveTimestamp}`
    );
    const archivePath = getUniqueArchivePath(archiveBasePath, '.ndjson');

    fs.renameSync(stream.activePath, archivePath);

    if (this.config.compress) {
      try {
        const compressedPath = `${archivePath}.gz`;
        const gzipped = this.gzip(fs.readFileSync(archivePath));
        fs.writeFileSync(compressedPath, gzipped);
        fs.rmSync(archivePath);
      } catch (error) {
        this.warn(`Failed to gzip archive ${archivePath}`, error);
      }
    }

    stream.bytes = 0;
    pruneArchives(this.config.archiveDir, stream.archivePrefix, this.config.maxArchives, this.warn);
  }
}

export function createFileLogger(config: BlypConfig): RotatingFileLogger {
  return new RotatingFileLogger(config);
}
