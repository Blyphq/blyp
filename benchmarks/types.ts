export type BenchmarkLibraryId = 'blyp' | 'pino' | 'winston';

export interface BenchmarkSystemMetadata {
  generatedAtUtc: string;
  gitSha: string;
  bunVersion: string;
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
  cpuModel: string;
  cpuCount: number;
  hostname: string;
  runnerType: 'github-actions' | 'local';
}

export interface ThroughputLibraryResult {
  opsPerSecond: number;
  avgNanoseconds: number;
  minNanoseconds: number;
  maxNanoseconds: number;
  p75Nanoseconds: number;
  p99Nanoseconds: number;
  samples: number;
}

export interface ThroughputScenarioResult {
  id: 'plain-throughput' | 'structured-throughput' | 'file-throughput';
  name: string;
  description: string;
  zeroIoValidated: boolean;
  zeroIoNotes?: string;
  libraries: Record<BenchmarkLibraryId, ThroughputLibraryResult>;
  blypVsPinoRatio: number;
  blypVsPinoPercent: number;
  passed: boolean;
  bytesWritten?: Record<BenchmarkLibraryId, number>;
}

export interface MemoryLibraryResult {
  heapUsedBytes: number;
  heapDeltaBytes: number;
  gcAvailable: boolean;
}

export interface MemoryScenarioResult {
  id: 'at-rest' | 'plain-burst' | 'structured-burst' | 'file-burst';
  name: string;
  libraries: Record<BenchmarkLibraryId, MemoryLibraryResult>;
}

export interface BenchmarkSuiteResult {
  metadata: BenchmarkSystemMetadata;
  throughput: ThroughputScenarioResult[];
  memory: MemoryScenarioResult[];
  notes: string[];
}

export interface BenchmarkOutputPaths {
  repoRoot: string;
  benchmarksDir: string;
  resultsDir: string;
  fixturesDir: string;
  latestJsonPath: string;
  latestMarkdownPath: string;
}

export interface NoopDestinationStats {
  writes: number;
  bytes: number;
}

export interface RealIoValidationResult {
  stdoutWrites: number;
  stderrWrites: number;
  fsWrites: number;
}

export interface PlainBenchmarkHandle {
  log: () => void;
  close: () => Promise<void>;
  destinationStats: () => NoopDestinationStats;
}

export interface StructuredBenchmarkHandle {
  emit: () => void;
  close: () => Promise<void>;
  destinationStats: () => NoopDestinationStats;
}

export interface FileBenchmarkHandle {
  log: () => void;
  flush: () => Promise<void>;
  close: () => Promise<void>;
  outputPath: string;
}

export interface BenchmarkAdapter {
  id: BenchmarkLibraryId;
  name: string;
  createPlainHandle: () => PlainBenchmarkHandle;
  createStructuredHandle: () => StructuredBenchmarkHandle;
  createFileHandle: (directory: string) => FileBenchmarkHandle;
}
