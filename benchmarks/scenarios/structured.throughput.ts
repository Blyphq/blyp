import { do_not_optimize, measure } from 'mitata';
import { blypAdapter } from '../adapters/blyp';
import { pinoAdapter } from '../adapters/pino';
import { winstonAdapter } from '../adapters/winston';
import type { BenchmarkAdapter, ThroughputLibraryResult, ThroughputScenarioResult } from '../types';
import { assertZeroRealIo } from '../utils/assert-zero-io';

const adapters: BenchmarkAdapter[] = [blypAdapter, pinoAdapter, winstonAdapter];
const MEASURE_OPTIONS = {
  warmup_samples: 24,
  min_cpu_time: 300 * 1e6,
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

export async function runStructuredThroughputScenario(): Promise<ThroughputScenarioResult> {
  const libraries = {} as ThroughputScenarioResult['libraries'];
  let zeroIoValidated = true;
  let zeroIoNotes = 'Validated with internal no-op destination and equivalent structured-object emission.';

  for (const adapter of adapters) {
    const handle = adapter.createStructuredHandle();
    try {
      await assertZeroRealIo(async () => {
        for (let index = 0; index < 32; index += 1) {
          handle.emit();
        }
      });
      const stats = await measure(() => {
        handle.emit();
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
    id: 'structured-throughput',
    name: 'Structured log throughput',
    description: 'Equivalent structured event emission with field accumulation and a final emit/log call.',
    zeroIoValidated,
    zeroIoNotes,
    libraries,
    blypVsPinoRatio,
    blypVsPinoPercent: (blypVsPinoRatio - 1) * 100,
    passed: libraries.blyp.opsPerSecond >= libraries.pino.opsPerSecond,
  };
}
