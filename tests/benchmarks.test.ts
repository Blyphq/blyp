import fs from 'fs';
import path from 'path';
import { afterEach, describe, expect, it } from 'bun:test';
import { blypAdapter } from '../benchmarks/adapters/blyp';
import { pinoAdapter } from '../benchmarks/adapters/pino';
import { winstonAdapter } from '../benchmarks/adapters/winston';
import { renderBenchmarkMarkdown, renderDocsSnapshot } from '../benchmarks/report';
import { runMemoryScenario } from '../benchmarks/scenarios/memory';
import type { BenchmarkSuiteResult } from '../benchmarks/types';
import { assertZeroRealIo } from '../benchmarks/utils/assert-zero-io';
import { makeBenchmarkTempDir, removeBenchmarkTempDir } from '../benchmarks/utils/temp-dir';

const sampleResult: BenchmarkSuiteResult = {
  metadata: {
    generatedAtUtc: '2026-03-26T00:00:00.000Z',
    gitSha: 'abc123',
    bunVersion: '1.3.9',
    platform: 'linux',
    arch: 'x64',
    cpuModel: 'Test CPU',
    cpuCount: 8,
    hostname: 'test-host',
    runnerType: 'local',
  },
  throughput: [
    {
      id: 'plain-throughput',
      name: 'Baseline throughput',
      description: 'plain',
      zeroIoValidated: true,
      zeroIoNotes: 'validated',
      libraries: {
        blyp: {
          opsPerSecond: 1000,
          avgNanoseconds: 100,
          minNanoseconds: 90,
          maxNanoseconds: 120,
          p75Nanoseconds: 110,
          p99Nanoseconds: 119,
          samples: 10,
        },
        pino: {
          opsPerSecond: 900,
          avgNanoseconds: 110,
          minNanoseconds: 100,
          maxNanoseconds: 125,
          p75Nanoseconds: 115,
          p99Nanoseconds: 124,
          samples: 10,
        },
        winston: {
          opsPerSecond: 800,
          avgNanoseconds: 120,
          minNanoseconds: 110,
          maxNanoseconds: 130,
          p75Nanoseconds: 125,
          p99Nanoseconds: 129,
          samples: 10,
        },
      },
      blypVsPinoRatio: 1.11,
      blypVsPinoPercent: 11.1,
      passed: true,
    },
  ],
  memory: [
    {
      id: 'at-rest',
      name: 'Heap at rest after logger creation',
      libraries: {
        blyp: { heapUsedBytes: 1000, heapDeltaBytes: 50, gcAvailable: true },
        pino: { heapUsedBytes: 900, heapDeltaBytes: 40, gcAvailable: true },
        winston: { heapUsedBytes: 1100, heapDeltaBytes: 60, gcAvailable: true },
      },
    },
  ],
  notes: ['sample note'],
};

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    removeBenchmarkTempDir(tempDirs.pop()!);
  }

  delete process.env.BLYP_BENCHMARK_MEMORY_ITERATIONS;
});

describe('benchmark reporting', () => {
  it('renders stable markdown tables', () => {
    const markdown = renderBenchmarkMarkdown(sampleResult);
    const snapshot = renderDocsSnapshot(sampleResult);

    expect(markdown).toContain('| Scenario | Blyp | Pino | Winston | Blyp vs Pino |');
    expect(markdown).toContain('Baseline throughput');
    expect(snapshot).toContain('abc123');
    expect(snapshot).toContain('Heap at rest after logger creation');
  });
});

describe('benchmark adapters', () => {
  it('creates no-op plain handles for all libraries', async () => {
    for (const adapter of [blypAdapter, pinoAdapter, winstonAdapter]) {
      const handle = adapter.createPlainHandle();

      expect(() => handle.log()).not.toThrow();
      expect(handle.destinationStats().writes).toBeGreaterThanOrEqual(0);
      await handle.close();
    }
  });

  it('writes temp-file output for all libraries', async () => {
    for (const adapter of [blypAdapter, pinoAdapter, winstonAdapter]) {
      const tempDir = makeBenchmarkTempDir(`blyp-bench-test-${adapter.id}-`);
      tempDirs.push(tempDir);
      const handle = adapter.createFileHandle(tempDir);

      handle.log();
      await handle.flush();
      await handle.close();

      expect(fs.existsSync(handle.outputPath)).toBe(true);
      expect(fs.statSync(handle.outputPath).size).toBeGreaterThan(0);
    }
  });
});

describe('benchmark utilities', () => {
  it('fails zero-I/O validation when a file write happens', async () => {
    const tempDir = makeBenchmarkTempDir('blyp-zero-io-');
    tempDirs.push(tempDir);
    const targetPath = path.join(tempDir, 'write.txt');

    await expect(assertZeroRealIo(() => {
      fs.writeFileSync(targetPath, 'boom');
    })).rejects.toThrow('Expected zero real I/O');
  });

  it('returns memory benchmark data with required fields', async () => {
    process.env.BLYP_BENCHMARK_MEMORY_ITERATIONS = '10';

    const results = await runMemoryScenario();

    expect(results).toHaveLength(4);
    expect(results[0]?.libraries.blyp.heapUsedBytes).toBeGreaterThanOrEqual(0);
    expect(typeof results[0]?.libraries.pino.gcAvailable).toBe('boolean');
  });
});
