import path from 'path';
import { blypAdapter } from '../adapters/blyp';
import { pinoAdapter } from '../adapters/pino';
import { winstonAdapter } from '../adapters/winston';
import type {
  BenchmarkAdapter,
  BenchmarkLibraryId,
  MemoryLibraryResult,
  MemoryScenarioResult,
} from '../types';
import { makeBenchmarkTempDir, removeBenchmarkTempDir } from '../utils/temp-dir';

const ITERATIONS = Number(process.env.BLYP_BENCHMARK_MEMORY_ITERATIONS ?? '1000');
const adapters: Record<BenchmarkLibraryId, BenchmarkAdapter> = {
  blyp: blypAdapter,
  pino: pinoAdapter,
  winston: winstonAdapter,
};

function forceGcIfAvailable(): boolean {
  if (typeof globalThis.gc === 'function') {
    globalThis.gc();
    return true;
  }

  return false;
}

function sampleHeapUsed(): number {
  return process.memoryUsage().heapUsed;
}

async function runWorkerScenario(
  scenario: MemoryScenarioResult['id'],
  library: BenchmarkLibraryId
): Promise<MemoryLibraryResult> {
  const adapter = adapters[library];
  const gcAvailable = forceGcIfAvailable();
  const before = sampleHeapUsed();

  if (scenario === 'at-rest') {
    const plainHandle = adapter.createPlainHandle();
    await plainHandle.close();
    forceGcIfAvailable();
    const after = sampleHeapUsed();
    return {
      heapUsedBytes: after,
      heapDeltaBytes: Math.max(0, after - before),
      gcAvailable,
    };
  }

  if (scenario === 'plain-burst') {
    const handle = adapter.createPlainHandle();
    try {
      for (let index = 0; index < ITERATIONS; index += 1) {
        handle.log();
      }
    } finally {
      await handle.close();
    }
  }

  if (scenario === 'structured-burst') {
    const handle = adapter.createStructuredHandle();
    try {
      for (let index = 0; index < ITERATIONS; index += 1) {
        handle.emit();
      }
    } finally {
      await handle.close();
    }
  }

  if (scenario === 'file-burst') {
    const tempDir = makeBenchmarkTempDir(`${library}-memory-file-`);
    const handle = adapter.createFileHandle(tempDir);

    try {
      for (let index = 0; index < ITERATIONS; index += 1) {
        handle.log();
      }
      await handle.flush();
    } finally {
      await handle.close();
      removeBenchmarkTempDir(tempDir);
    }
  }

  forceGcIfAvailable();
  const after = sampleHeapUsed();
  return {
    heapUsedBytes: after,
    heapDeltaBytes: Math.max(0, after - before),
    gcAvailable,
  };
}

async function runSubprocessScenario(
  scenario: MemoryScenarioResult['id'],
  library: BenchmarkLibraryId
): Promise<MemoryLibraryResult> {
  const proc = Bun.spawn(
    [process.execPath, '--expose-gc', path.join(import.meta.dir, 'memory.ts'), '--worker', scenario, library],
    {
      cwd: path.resolve(import.meta.dir, '..', '..'),
      stdout: 'pipe',
      stderr: 'pipe',
    }
  );

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(`Memory worker failed for ${library}/${scenario}: ${stderr}`);
  }

  return JSON.parse(stdout) as MemoryLibraryResult;
}

export async function runMemoryScenario(): Promise<MemoryScenarioResult[]> {
  const scenarios: MemoryScenarioResult['id'][] = [
    'at-rest',
    'plain-burst',
    'structured-burst',
    'file-burst',
  ];
  const results: MemoryScenarioResult[] = [];

  for (const scenario of scenarios) {
    const libraries = {} as Record<BenchmarkLibraryId, MemoryLibraryResult>;

    for (const library of Object.keys(adapters) as BenchmarkLibraryId[]) {
      libraries[library] = await runSubprocessScenario(scenario, library);
    }

    results.push({
      id: scenario,
      name: resolveScenarioName(scenario),
      libraries,
    });
  }

  return results;
}

function resolveScenarioName(id: MemoryScenarioResult['id']): string {
  switch (id) {
    case 'at-rest':
      return 'Heap at rest after logger creation';
    case 'plain-burst':
      return 'Heap delta after plain logging burst';
    case 'structured-burst':
      return 'Heap delta after structured logging burst';
    case 'file-burst':
      return 'Heap delta after file logging burst';
  }
}

if (process.argv.includes('--worker')) {
  const index = process.argv.indexOf('--worker');
  const scenario = process.argv[index + 1] as MemoryScenarioResult['id'];
  const library = process.argv[index + 2] as BenchmarkLibraryId;

  runWorkerScenario(scenario, library)
    .then((result) => {
      process.stdout.write(JSON.stringify(result));
    })
    .catch((error) => {
      process.stderr.write(String(error instanceof Error ? error.stack ?? error.message : error));
      process.exit(1);
    });
}
