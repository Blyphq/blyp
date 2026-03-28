import fs from 'fs';
import os from 'os';
import path from 'path';
import { beforeAll, describe, expect, it } from 'bun:test';

const repoRoot = path.resolve(import.meta.dir, '..');
let builtExpressEsmPath = '';
let builtExpressCjsPath = '';

function readStream(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) {
    return Promise.resolve('');
  }

  return new Response(stream).text();
}

function escapeForJavaScriptLiteral(filePath: string): string {
  return filePath.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function runNode(args: string[]): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const proc = Bun.spawn(['node', ...args], {
    cwd: repoRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    readStream(proc.stdout),
    readStream(proc.stderr),
  ]);

  return { exitCode, stdout, stderr };
}

function ensureBuildArtifacts(): void {
  const tempOutDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blyp-dist-'));
  const tsupBin = path.join(repoRoot, 'node_modules', '.bin', 'tsup');
  const buildResult = Bun.spawnSync([
    tsupBin,
    'src/frameworks/express/index.ts',
    '--format',
    'esm,cjs',
    '--platform',
    'node',
    '--target',
    'es2020',
    '--out-dir',
    tempOutDir,
    '--silent',
  ], {
    cwd: repoRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  if (buildResult.exitCode !== 0) {
    const stdout = buildResult.stdout ? new TextDecoder().decode(buildResult.stdout) : '';
    const stderr = buildResult.stderr ? new TextDecoder().decode(buildResult.stderr) : '';
    throw new Error(`build:js failed\n${stdout}\n${stderr}`);
  }

  builtExpressEsmPath = path.join(tempOutDir, 'index.mjs');
  builtExpressCjsPath = path.join(tempOutDir, 'index.js');
}

function makeMissingModuleHook(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blyp-pino-hook-'));
  const hookPath = path.join(dir, 'missing-pino-pretty.cjs');
  fs.writeFileSync(
    hookPath,
    [
      "const Module = require('node:module');",
      'const originalLoad = Module._load;',
      "Module._load = function patchedLoad(request, parent, isMain) {",
      "  if (request === 'pino-pretty') {",
      "    const error = new Error(\"Cannot find module 'pino-pretty'\");",
      "    error.code = 'MODULE_NOT_FOUND';",
      '    throw error;',
      '  }',
      '  return originalLoad.call(this, request, parent, isMain);',
      '};',
    ].join('\n')
  );
  return hookPath;
}

describe('pino-pretty loading', () => {
  beforeAll(() => {
    ensureBuildArtifacts();
  });

  it('loads the built ESM express entrypoint in Node with pretty logging enabled', async () => {
    const script = [
      `const mod = await import('file://${escapeForJavaScriptLiteral(builtExpressEsmPath)}');`,
      'mod.createLogger({ pretty: true, file: { enabled: false } });',
      'process.exit(0);',
    ].join('\n');

    const result = await runNode(['--input-type=module', '--eval', script]);

    expect(result.exitCode).toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).not.toContain('Dynamic require of "pino-pretty" is not supported');
  });

  it('loads the built CJS express entrypoint in Node with pretty logging enabled', async () => {
    const script = [
      `const mod = require('${escapeForJavaScriptLiteral(builtExpressCjsPath)}');`,
      'mod.createLogger({ pretty: true, file: { enabled: false } });',
      'process.exit(0);',
    ].join('\n');

    const result = await runNode(['--eval', script]);

    expect(result.exitCode).toBe(0);
  });

  it('reports a clear error when pretty logging is enabled without pino-pretty', async () => {
    const hookPath = makeMissingModuleHook();
    const script = [
      `const mod = await import('file://${escapeForJavaScriptLiteral(builtExpressEsmPath)}');`,
      'try {',
      "  mod.createLogger({ pretty: true, file: { enabled: false } });",
      '} catch (error) {',
      "  console.error(String(error && error.message ? error.message : error));",
      '  process.exit(1);',
      '}',
      "console.error('expected failure');",
      'process.exit(2);',
    ].join('\n');

    const result = await runNode([
      '--require',
      hookPath,
      '--input-type=module',
      '--eval',
      script,
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('pretty: true');
    expect(result.stderr).toContain('pino-pretty');
    expect(result.stderr).toContain('pretty logger transport');
  });
});
