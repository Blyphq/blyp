import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { resolveConfig, resetConfigCache } from '../src/core/config';
import { RotatingFileLogger, type LogRecord } from '../src/core/file-logger';
import { readLogFile, formatLogRecord } from '../src/core/log-reader';
import { createBaseLogger } from '../src/core/logger';
import { createStandaloneLogger } from '../src/frameworks/standalone';
import { makeTempDir, readJsonLines } from './helpers/fs';

describe('Structured File Logging', () => {
  let originalCwd: string;
  let tempDir: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tempDir = makeTempDir('blyp-file-');
    resetConfigCache();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
    resetConfigCache();
  });

  it('writes standalone logs to configured NDJSON files', () => {
    const logger = createStandaloneLogger({
      pretty: false,
      logDir: tempDir,
      file: {
        rotation: {
          maxSizeBytes: 1024,
          maxArchives: 5,
          compress: true,
        },
      },
    });

    logger.info('hello');
    logger.error('boom');

    const combinedRecords = readJsonLines(path.join(tempDir, 'log.ndjson'));
    const errorRecords = readJsonLines(path.join(tempDir, 'log.error.ndjson'));

    expect(combinedRecords).toHaveLength(2);
    expect(errorRecords).toHaveLength(1);
    expect(combinedRecords[0]?.message).toBe('hello');
    expect(errorRecords[0]?.level).toBe('error');
  });

  it('stores object logs as structured message plus data', () => {
    const logger = createStandaloneLogger({
      pretty: false,
      logDir: tempDir,
    });
    const payload = { user: 'ada', nested: { admin: true } };

    logger.info(payload);

    const [record] = readJsonLines(path.join(tempDir, 'log.ndjson'));
    expect(typeof record?.message).toBe('string');
    expect(record?.message).toContain('"user": "ada"');
    expect(record?.data).toEqual(payload);
  });

  it('rotates combined logs by size and compresses archives', () => {
    const logger = createStandaloneLogger({
      pretty: false,
      logDir: tempDir,
      file: {
        rotation: {
          maxSizeBytes: 220,
          maxArchives: 5,
          compress: true,
        },
      },
    });

    for (let index = 0; index < 8; index += 1) {
      logger.info(`message-${index}-${'x'.repeat(40)}`);
    }

    const archiveDir = path.join(tempDir, 'archive');
    const archives = fs
      .readdirSync(archiveDir)
      .filter((name) => name.startsWith('log.') && name.endsWith('.ndjson.gz'));

    expect(archives.length).toBeGreaterThan(0);
    expect(archives[0]).toMatch(/^log\.\d{8}T\d{6}Z(?:-\d+)?\.ndjson\.gz$/);
  });

  it('keeps rotated archives uncompressed when compress is disabled', () => {
    const logger = createStandaloneLogger({
      pretty: false,
      logDir: tempDir,
      file: {
        rotation: {
          maxSizeBytes: 220,
          maxArchives: 5,
          compress: false,
        },
      },
    });

    for (let index = 0; index < 8; index += 1) {
      logger.info(`plain-archive-${index}-${'n'.repeat(40)}`);
    }

    const archiveDir = path.join(tempDir, 'archive');
    const plainArchives = fs
      .readdirSync(archiveDir)
      .filter((name) => name.startsWith('log.') && name.endsWith('.ndjson'));
    const compressedArchives = fs
      .readdirSync(archiveDir)
      .filter((name) => name.startsWith('log.') && name.endsWith('.ndjson.gz'));

    expect(plainArchives.length).toBeGreaterThan(0);
    expect(compressedArchives).toHaveLength(0);
  });

  it('rotates the error stream independently', () => {
    const logger = createStandaloneLogger({
      pretty: false,
      logDir: tempDir,
      file: {
        rotation: {
          maxSizeBytes: 260,
          maxArchives: 5,
          compress: true,
        },
      },
    });

    for (let index = 0; index < 6; index += 1) {
      logger.info(`info-only-${index}-${'y'.repeat(30)}`);
    }

    const archiveDir = path.join(tempDir, 'archive');
    const errorArchivesBefore = fs
      .readdirSync(archiveDir)
      .filter((name) => name.startsWith('log.error.'));

    expect(errorArchivesBefore).toHaveLength(0);

    for (let index = 0; index < 6; index += 1) {
      logger.error(`error-only-${index}-${'z'.repeat(30)}`);
    }

    const errorArchivesAfter = fs
      .readdirSync(archiveDir)
      .filter((name) => name.startsWith('log.error.') && name.endsWith('.ndjson.gz'));

    expect(errorArchivesAfter.length).toBeGreaterThan(0);
  });

  it('rotates oversized active files on startup before appending', () => {
    fs.mkdirSync(path.join(tempDir, 'archive'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'log.ndjson'), `${'a'.repeat(600)}\n`);

    const logger = createStandaloneLogger({
      pretty: false,
      logDir: tempDir,
      file: {
        rotation: {
          maxSizeBytes: 256,
          maxArchives: 5,
          compress: true,
        },
      },
    });

    logger.info('fresh-line');

    const archives = fs
      .readdirSync(path.join(tempDir, 'archive'))
      .filter((name) => name.startsWith('log.') && name.endsWith('.ndjson.gz'));
    const activeContent = fs.readFileSync(path.join(tempDir, 'log.ndjson'), 'utf8');

    expect(archives.length).toBeGreaterThan(0);
    expect(activeContent).toContain('fresh-line');
  });

  it('prunes archives when maxArchives is zero', () => {
    const logger = createStandaloneLogger({
      pretty: false,
      logDir: tempDir,
      file: {
        rotation: {
          maxSizeBytes: 200,
          maxArchives: 0,
          compress: true,
        },
      },
    });

    for (let index = 0; index < 10; index += 1) {
      logger.info(`prune-${index}-${'q'.repeat(40)}`);
    }

    expect(fs.readdirSync(path.join(tempDir, 'archive'))).toHaveLength(0);
  });

  it('keeps uncompressed archives when gzip fails and continues logging', () => {
    const backend = new RotatingFileLogger(
      resolveConfig({
        pretty: false,
        logDir: tempDir,
        file: {
          rotation: {
            maxSizeBytes: 220,
            maxArchives: 5,
            compress: true,
          },
        },
      }),
      {
        gzip: () => {
          throw new Error('gzip failed');
        },
        warn: () => {},
      }
    );

    const record: LogRecord = {
      timestamp: new Date().toISOString(),
      level: 'info',
      message: `payload-${'r'.repeat(60)}`,
    };

    backend.write(record);
    backend.write(record);
    backend.write({ ...record, message: 'after-rotate' });

    const archives = fs
      .readdirSync(path.join(tempDir, 'archive'))
      .filter((name) => name.startsWith('log.') && name.endsWith('.ndjson'));
    const activeContent = fs.readFileSync(path.join(tempDir, 'log.ndjson'), 'utf8');

    expect(archives.length).toBeGreaterThan(0);
    expect(activeContent).toContain('after-rotate');
  });

  it('reads active and gzipped archives in pretty and json modes', async () => {
    const logger = createStandaloneLogger({
      pretty: false,
      logDir: tempDir,
      file: {
        rotation: {
          maxSizeBytes: 210,
          maxArchives: 5,
          compress: true,
        },
      },
    });

    for (let index = 0; index < 8; index += 1) {
      logger.info(`reader-${index}-${'m'.repeat(35)}`);
    }

    const archiveName = fs
      .readdirSync(path.join(tempDir, 'archive'))
      .find((name) => name.startsWith('log.') && name.endsWith('.ndjson.gz'));

    expect(archiveName).toBeDefined();

    const prettyOutput = await readLogFile(path.join(tempDir, 'archive', archiveName!));
    const jsonOutput = await readLogFile(path.join(tempDir, 'archive', archiveName!), {
      format: 'json',
      limit: 1,
    });

    expect(typeof prettyOutput).toBe('string');
    expect(prettyOutput).toContain('INFO');
    expect(Array.isArray(jsonOutput)).toBe(true);
    expect((jsonOutput as LogRecord[])[0]?.level).toBe('info');
  });

  it('preserves malformed lines instead of throwing in the reader', async () => {
    const filePath = path.join(tempDir, 'bad.ndjson');
    fs.writeFileSync(filePath, '{"level":"info","message":"ok"}\nnot-json\n');

    const prettyOutput = await readLogFile(filePath);
    const jsonOutput = await readLogFile(filePath, { format: 'json' });

    expect(prettyOutput).toContain('not-json');
    expect((jsonOutput as LogRecord[])[1]?.message).toBe('not-json');
  });

  it('formats records into readable lines', () => {
    const line = formatLogRecord({
      timestamp: '2026-03-09T10:15:30.000Z',
      level: 'info',
      message: 'hello',
      caller: 'app.ts:4',
    });

    expect(line).toBe('[2026-03-09T10:15:30.000Z] INFO hello (app.ts:4)');
  });

  it('records child logger bindings in file output', () => {
    const logger = createStandaloneLogger({
      pretty: false,
      logDir: tempDir,
    }).child({ requestId: 'req-1' });

    logger.info('child-message');

    const [record] = readJsonLines(path.join(tempDir, 'log.ndjson'));
    expect(record?.bindings).toEqual({ requestId: 'req-1' });
  });

  it('prints a compact console summary for client-ingested logs while preserving full file payloads', () => {
    const originalWrite = process.stdout.write.bind(process.stdout);
    const chunks: string[] = [];

    process.stdout.write = ((chunk: string | Uint8Array) => {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stdout.write;

    try {
      const logger = createBaseLogger({
        pretty: false,
        level: 'info',
        file: {
          enabled: false,
        },
      });

      logger.info('[client] count is', {
        type: 'client_log',
        source: 'client',
        message: 'count is',
        data: { count: 12 },
        page: {
          pathname: '/',
          url: 'http://localhost:5173/',
        },
        metadata: {
          app: 'dashboard',
        },
        browser: {
          userAgent: 'Mozilla/5.0',
        },
        session: {
          pageId: 'page-id',
          sessionId: 'session-id',
        },
        delivery: {
          hostname: 'localhost',
          protocol: 'http',
        },
      });
    } finally {
      process.stdout.write = originalWrite;
    }

    const output = chunks.join('').trim();
    expect(output).toContain('"data":{"count":12}');
    expect(output).toContain('"page":"/"');
    expect(output).toContain('"metadata":{"app":"dashboard"}');
    expect(output).not.toContain('"browser"');
    expect(output).not.toContain('"session"');
    expect(output).not.toContain('"delivery"');
  });
});
