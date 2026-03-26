import { do_not_optimize, measure } from 'mitata';
import { blypAdapter } from '../adapters/blyp';
import { pinoAdapter } from '../adapters/pino';
import { winstonAdapter } from '../adapters/winston';
import type { BenchmarkAdapter, ThroughputLibraryResult, ThroughputScenarioResult } from '../types';
import { assertZeroRealIo } from '../utils/assert-zero-io';

const adapters: BenchmarkAdapter[] = [blypAdapter, pinoAdapter, winstonAdapter];
const MEASURE_OPTIONS = {
  warmup_samples: 32,
  min_cpu_time: 250 * 1e6,
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

export async function runPlainThroughputScenario(): Promise<ThroughputScenarioResult> {
  const libraries = {} as ThroughputScenarioResult['libraries'];
  let zeroIoValidated = true;
  let zeroIoNotes = 'Validated with internal no-op destination + sink and a real-I/O guard.';

  for (const adapter of adapters) {
    const handle = adapter.createPlainHandle();
    try {
      await assertZeroRealIo(async () => {
        for (let index = 0; index < 64; index += 1) {
          handle.log();
        }
      });
      const stats = await measure(() => {
        handle.log();
        do_not_optimize(handle.destinationStats());
      }, MEASURE_OPTIONS);
      libraries[adapter.id] = toThroughputResult(stats);
    } catch (error) {
      zeroIoValidated = false;
      zeroIoNotes = String(error);
      throw error;
    } finally {
      await handle.close();
    }
  }

  const blypVsPinoRatio = libraries.blyp.opsPerSecond / libraries.pino.opsPerSecond;

  return {
    id: 'plain-throughput',
    name: 'Baseline throughput',
    description: "Plain logger.info('message') with no connectors and no real I/O.",
    zeroIoValidated,
    zeroIoNotes,
    libraries,
    blypVsPinoRatio,
    blypVsPinoPercent: (blypVsPinoRatio - 1) * 100,
    passed: libraries.blyp.opsPerSecond >= libraries.pino.opsPerSecond,
  };
}
