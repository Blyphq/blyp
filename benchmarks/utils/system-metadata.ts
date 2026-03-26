import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import type { BenchmarkOutputPaths, BenchmarkSystemMetadata } from '../types';

const benchmarksDir = path.dirname(fileURLToPath(new URL('../run.ts', import.meta.url)));
const repoRoot = path.resolve(benchmarksDir, '..');
const resultsDir = path.join(benchmarksDir, 'results');
const fixturesDir = path.join(benchmarksDir, 'fixtures', 'results');

export function getBenchmarkPaths(): BenchmarkOutputPaths {
  return {
    repoRoot,
    benchmarksDir,
    resultsDir,
    fixturesDir,
    latestJsonPath: path.join(resultsDir, 'latest.json'),
    latestMarkdownPath: path.join(resultsDir, 'latest.md'),
  };
}

export function ensureBenchmarkDirectories(): BenchmarkOutputPaths {
  const paths = getBenchmarkPaths();
  fs.mkdirSync(paths.resultsDir, { recursive: true });
  fs.mkdirSync(paths.fixturesDir, { recursive: true });
  return paths;
}

export async function collectSystemMetadata(): Promise<BenchmarkSystemMetadata> {
  const gitSha = await resolveGitSha();
  const cpus = os.cpus();

  return {
    generatedAtUtc: new Date().toISOString(),
    gitSha,
    bunVersion: Bun.version,
    platform: process.platform,
    arch: process.arch,
    cpuModel: cpus[0]?.model ?? 'unknown',
    cpuCount: cpus.length,
    hostname: os.hostname(),
    runnerType: process.env.GITHUB_ACTIONS === 'true' ? 'github-actions' : 'local',
  };
}

async function resolveGitSha(): Promise<string> {
  const proc = Bun.spawn(['git', 'rev-parse', 'HEAD'], {
    cwd: repoRoot,
    stdout: 'pipe',
    stderr: 'ignore',
  });

  const output = await new Response(proc.stdout).text();
  await proc.exited;
  return output.trim() || 'unknown';
}
