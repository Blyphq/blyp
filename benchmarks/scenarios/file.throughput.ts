import { do_not_optimize, measure } from 'mitata';
import { blypAdapter, readOutputBytes } from '../adapters/blyp';
import { pinoAdapter, readPinoOutputBytes } from '../adapters/pino';
import { winstonAdapter, readWinstonOutputBytes } from '../adapters/winston';
import type { BenchmarkAdapter, ThroughputLibraryResult, ThroughputScenarioResult } from '../types';
import { makeBenchmarkTempDir, removeBenchmarkTempDir } from '../utils/temp-dir';

const adapters: BenchmarkAdapter[] = [blypAdapter, pinoAdapter, winstonAdapter];
const MEASURE_OPTIONS = {
  warmup_samples: 16,
  min_cpu_time: 400 * 1e6,
};

function toThroughputResult(stats: Awaited<ReturnType<typeof measure>>): ThroughputLibraryResult {
  return {
    opsPerSecond: 1e9 / stats.avg,
    avgNanoseconds: stats.avg,
    minNanoseconds: stats.min,
    maxNanoseconds: stats.max,
    p75Nanoseconds: stats.p75,
    p99Nanoseconds: stats.p99,
    samples: stats.samples.length,
  };
}

function readBytes(adapterId: BenchmarkAdapter['id'], filePath: string): number {
  switch (adapterId) {
    case 'blyp':
      return readOutputBytes(filePath);
    case 'pino':
      return readPinoOutputBytes(filePath);
    case 'winston':
      return readWinstonOutputBytes(filePath);
  }
}

export async function runFileThroughputScenario(): Promise<ThroughputScenarioResult> {
  const libraries = {} as ThroughputScenarioResult['libraries'];
  const bytesWritten = {} as Record<BenchmarkAdapter['id'], number>;

  for (const adapter of adapters) {
    const tempDir = makeBenchmarkTempDir(`blyp-benchmark-${adapter.id}-`);
    const handle = adapter.createFileHandle(tempDir);

    try {
      const stats = await measure(() => {
        handle.log();
        do_not_optimize(handle.outputPath);
      }, MEASURE_OPTIONS);
      await handle.flush();
      await handle.close();
      libraries[adapter.id] = toThroughputResult(stats);
      bytesWritten[adapter.id] = readBytes(adapter.id, handle.outputPath);
    } finally {
      removeBenchmarkTempDir(tempDir);
    }
  }

  const blypVsPinoRatio = libraries.blyp.opsPerSecond / libraries.pino.opsPerSecond;

  return {
    id: 'file-throughput',
    name: 'File destination throughput',
    description: 'Real NDJSON file logging to a temporary directory with steady-state append behavior.',
    zeroIoValidated: false,
    zeroIoNotes: 'Not applicable: this scenario intentionally performs file I/O.',
    libraries,
    blypVsPinoRatio,
    blypVsPinoPercent: (blypVsPinoRatio - 1) * 100,
    passed: libraries.blyp.opsPerSecond >= libraries.pino.opsPerSecond,
    bytesWritten,
  };
}
