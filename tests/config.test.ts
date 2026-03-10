import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { resolveConfig, resetConfigCache } from '../src/core/config';
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
    expect(createdConfig.clientLogging).toEqual({
      enabled: true,
      path: '/inngest',
    });
    expect(gitignore).toContain('logs');
  });
});
