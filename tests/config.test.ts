import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { resolveConfig, resetConfigCache } from '../src/core/config';
import { createDrizzleDatabaseAdapter } from '../src/database';
import { makeTempDir } from './helpers/fs';

describe('Configuration', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tempDir = makeTempDir('blyp-config-');
    resetConfigCache();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
    resetConfigCache();
  });

  it('applies explicit args over config file over defaults', () => {
    process.chdir(tempDir);
    fs.writeFileSync(
      path.join(tempDir, 'blyp.config.json'),
      JSON.stringify({
        level: 'error',
        logDir: 'config-logs',
        file: {
          rotation: {
            maxSizeBytes: 2048,
          },
        },
        clientLogging: {
          enabled: true,
          path: '/config-inngest',
        },
      })
    );

    resetConfigCache();
    const resolved = resolveConfig({
      level: 'debug',
      file: {
        rotation: {
          maxArchives: 9,
        },
      },
    });

    expect(resolved.level).toBe('debug');
    expect(resolved.destination).toBe('file');
    expect(resolved.logDir).toBe('config-logs');
    expect(resolved.file?.rotation?.maxSizeBytes).toBe(2048);
    expect(resolved.file?.rotation?.maxArchives).toBe(9);
    expect(resolved.clientLogging?.path).toBe('/config-inngest');
  });

  it('bootstraps blyp.config.json and .gitignore for consumer projects', () => {
    process.chdir(tempDir);
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify({ name: 'example-app' }, null, 2)
    );

    const resolved = resolveConfig();
    const configPath = path.join(tempDir, 'blyp.config.json');
    const gitignorePath = path.join(tempDir, '.gitignore');
    const createdConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const gitignore = fs.readFileSync(gitignorePath, 'utf8');

    expect(resolved.level).toBe('info');
    expect(resolved.destination).toBe('file');
    expect(createdConfig.clientLogging).toEqual({
      enabled: true,
      path: '/inngest',
    });
    expect(gitignore).toContain('logs');
    expect(gitignore).toContain('.blyp');
  });

  it('resolves connector delivery defaults', () => {
    process.chdir(tempDir);

    const resolved = resolveConfig();

    expect(resolved.connectors.delivery).toMatchObject({
      enabled: false,
      memoryBufferSize: 500,
      durableSpillStrategy: 'after-first-failure',
      memoryBatchSize: 25,
      sqliteWriteBatchSize: 100,
      sqliteReadBatchSize: 50,
      dispatchConcurrency: 4,
      pollIntervalMs: 1000,
      overflowStrategy: 'drop-oldest',
      durableReady: false,
      retry: {
        maxAttempts: 8,
        initialBackoffMs: 500,
        maxBackoffMs: 30000,
        multiplier: 2,
        jitter: true,
      },
    });
    expect(resolved.connectors.delivery.durableQueuePath).toContain(
      path.join('.blyp', 'connectors.sqlite')
    );
  });

  it('resolves default redaction settings and merges runtime overrides', () => {
    process.chdir(tempDir);
    fs.writeFileSync(
      path.join(tempDir, 'blyp.config.ts'),
      [
        'export default {',
        '  redact: {',
        '    keys: ["internal_secret"],',
        '    paths: ["payment.**.raw"],',
        '    patterns: [/MY_ORG_[A-Z0-9]{32}/],',
        '    disablePatternScanning: false,',
        '  },',
        '};',
      ].join('\n')
    );

    resetConfigCache();
    const resolved = resolveConfig({
      redact: {
        keys: ['custom_token'],
        paths: ['user.ssn'],
        disablePatternScanning: true,
      },
    });

    expect(resolved.redact.keys).toContain('password');
    expect(resolved.redact.keys).toContain('internal_secret');
    expect(resolved.redact.keys).toContain('custom_token');
    expect(resolved.redact.paths).toContain('payment.**.raw');
    expect(resolved.redact.paths).toContain('user.ssn');
    expect(resolved.redact.patterns).toHaveLength(1);
    expect(resolved.redact.disablePatternScanning).toBe(true);
  });

  it('loads executable database config and marks it ready', () => {
    process.chdir(tempDir);
    fs.writeFileSync(
      path.join(tempDir, 'blyp.config.ts'),
      [
        'const db = {',
        '  insert() {',
        '    return { values: async () => {} };',
        '  },',
        '};',
        'const table = { name: "blypLogs" };',
        'export default {',
        '  destination: "database",',
        '  database: {',
        '    dialect: "postgres",',
        '    adapter: { type: "drizzle", db, table },',
        '  },',
        '};',
      ].join('\n')
    );

    resetConfigCache();
    const resolved = resolveConfig();

    expect(resolved.destination).toBe('database');
    expect(resolved.database?.status).toBe('enabled');
    expect(resolved.database?.ready).toBe(true);
  });

  it('warns and disables json database config', () => {
    process.chdir(tempDir);
    fs.writeFileSync(
      path.join(tempDir, 'blyp.config.json'),
      JSON.stringify({
        destination: 'database',
        database: {
          dialect: 'postgres',
          adapter: createDrizzleDatabaseAdapter({
            db: { insert() {} },
            table: { name: 'blypLogs' },
          }),
        },
      })
    );

    const warnings: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };

    resetConfigCache();
    const resolved = resolveConfig();
    console.warn = originalWarn;

    expect(resolved.destination).toBe('database');
    expect(resolved.database?.ready).toBe(false);
    expect(resolved.database?.status).toBe('missing');
    expect(String(warnings[0]?.[0] ?? '')).toContain('executable blyp config file');
  });
});
