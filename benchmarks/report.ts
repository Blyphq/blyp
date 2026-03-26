import fs from 'fs';
import path from 'path';
import type { BenchmarkSuiteResult, ThroughputScenarioResult } from './types';
import { ensureBenchmarkDirectories, getBenchmarkPaths } from './utils/system-metadata';

const README_PATH = path.join(getBenchmarkPaths().repoRoot, 'README.md');
const DOCS_PATH = path.join(getBenchmarkPaths().repoRoot, 'docs', 'README.md');

function formatOps(value: number): string {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPercent(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

function formatBytes(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function renderThroughputRow(scenario: ThroughputScenarioResult): string {
  return `| ${scenario.name} | ${formatOps(scenario.libraries.blyp.opsPerSecond)} | ${formatOps(scenario.libraries.pino.opsPerSecond)} | ${formatOps(scenario.libraries.winston.opsPerSecond)} | ${formatPercent(scenario.blypVsPinoPercent)} |`;
}

export function renderBenchmarkMarkdown(result: BenchmarkSuiteResult): string {
  const throughputRows = result.throughput.map(renderThroughputRow).join('\n');
  const memoryRows = result.memory.map((scenario) => {
    return `| ${scenario.name} | ${formatBytes(scenario.libraries.blyp.heapDeltaBytes)} | ${formatBytes(scenario.libraries.pino.heapDeltaBytes)} | ${formatBytes(scenario.libraries.winston.heapDeltaBytes)} |`;
  }).join('\n');
  const bytesRows = result.throughput
    .filter((scenario) => scenario.bytesWritten)
    .map((scenario) => {
      const bytes = scenario.bytesWritten!;
      return `| ${scenario.name} | ${formatBytes(bytes.blyp)} | ${formatBytes(bytes.pino)} | ${formatBytes(bytes.winston)} |`;
    })
    .join('\n');
  const hotPath = result.throughput.find((scenario) => scenario.id === 'plain-throughput');
  const hotPathVerdict = hotPath?.passed
    ? 'Blyp matched or exceeded Pino in the no-I/O hot path for this run.'
    : 'Blyp trailed Pino in the no-I/O hot path for this run.';

  return [
    '# Benchmark Results',
    '',
    `Generated: ${result.metadata.generatedAtUtc}`,
    `Commit: \`${result.metadata.gitSha}\``,
    `Bun: \`${result.metadata.bunVersion}\``,
    `Hardware: ${result.metadata.cpuModel} (${result.metadata.cpuCount} cores)`,
    `Runner: ${result.metadata.runnerType} on ${result.metadata.platform}/${result.metadata.arch}`,
    '',
    hotPathVerdict,
    '',
    'Release-run numbers come from shared CI hardware and should only be compared against runs from the same environment class.',
    '',
    '## Throughput',
    '',
    '| Scenario | Blyp | Pino | Winston | Blyp vs Pino |',
    '|---|---:|---:|---:|---:|',
    throughputRows,
    '',
    '## Memory',
    '',
    '| Scenario | Blyp heap delta | Pino heap delta | Winston heap delta |',
    '|---|---:|---:|---:|',
    memoryRows,
    '',
    '## File Output Bytes',
    '',
    '| Scenario | Blyp bytes | Pino bytes | Winston bytes |',
    '|---|---:|---:|---:|',
    bytesRows || '| File destination throughput | 0 | 0 | 0 |',
    '',
    '## Notes',
    '',
    '- Structured throughput compares equivalent structured event emission, not identical APIs.',
    '- Hot-path validation uses internal no-op destination plumbing plus a real-I/O guard.',
    ...result.notes.map((note) => `- ${note}`),
    ...result.throughput.map((scenario) => `- ${scenario.name}: ${scenario.zeroIoNotes ?? 'No additional notes.'}`),
  ].join('\n');
}

export function renderDocsSnapshot(result: BenchmarkSuiteResult): string {
  const throughputRows = result.throughput.map(renderThroughputRow).join('\n');
  const memoryRows = result.memory.map((scenario) => {
    return `| ${scenario.name} | ${formatBytes(scenario.libraries.blyp.heapDeltaBytes)} | ${formatBytes(scenario.libraries.pino.heapDeltaBytes)} | ${formatBytes(scenario.libraries.winston.heapDeltaBytes)} |`;
  }).join('\n');

  return [
    `Snapshot generated from \`${result.metadata.gitSha}\` on ${result.metadata.generatedAtUtc}.`,
    '',
    `Bun \`${result.metadata.bunVersion}\` on ${result.metadata.cpuModel} (${result.metadata.platform}/${result.metadata.arch}).`,
    '',
    '| Scenario | Blyp | Pino | Winston | Blyp vs Pino |',
    '|---|---:|---:|---:|---:|',
    throughputRows,
    '',
    '| Scenario | Blyp heap delta | Pino heap delta | Winston heap delta |',
    '|---|---:|---:|---:|',
    memoryRows,
  ].join('\n');
}

export function writeMarkdownArtifacts(result: BenchmarkSuiteResult): { latestMarkdownPath: string; fixtureMarkdownPath: string } {
  const paths = ensureBenchmarkDirectories();
  const markdown = renderBenchmarkMarkdown(result);
  const snapshot = renderDocsSnapshot(result);
  const timestamp = result.metadata.generatedAtUtc.replace(/[:]/g, '-');
  const timestampedMarkdownPath = path.join(paths.resultsDir, `${timestamp}.md`);
  const fixtureMarkdownPath = path.join(paths.fixturesDir, 'latest.md');

  fs.writeFileSync(paths.latestMarkdownPath, markdown);
  fs.writeFileSync(timestampedMarkdownPath, markdown);
  fs.writeFileSync(fixtureMarkdownPath, snapshot);

  return {
    latestMarkdownPath: paths.latestMarkdownPath,
    fixtureMarkdownPath,
  };
}

function replaceMarkedSection(
  filePath: string,
  marker: string,
  body: string
): void {
  const content = fs.readFileSync(filePath, 'utf8');
  const pattern = new RegExp(`<!-- ${marker}:start -->[\\s\\S]*<!-- ${marker}:end -->`);
  const replacement = `<!-- ${marker}:start -->\n${body}\n<!-- ${marker}:end -->`;
  fs.writeFileSync(filePath, content.replace(pattern, replacement));
}

export function updateDocsWithSnapshot(snapshotMarkdown: string): void {
  replaceMarkedSection(
    README_PATH,
    'benchmarks',
    [
      '## Performance Benchmarks',
      '',
      snapshotMarkdown,
      '',
      'Methodology: [benchmarks/README.md](benchmarks/README.md). Release benchmarking publishes fresh CI artifacts and updates the release notes section for traceability.',
    ].join('\n')
  );

  replaceMarkedSection(
    DOCS_PATH,
    'benchmarks',
    [
      '## Performance',
      '',
      snapshotMarkdown,
      '',
      'These benchmarks are reproducible only within the same hardware class. Release runs publish fresh CI artifacts and append the benchmark report to the GitHub release notes.',
      '',
      'Methodology: [benchmarks/README.md](../benchmarks/README.md)',
    ].join('\n')
  );
}

export function readSuiteResult(jsonPath: string): BenchmarkSuiteResult {
  return JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as BenchmarkSuiteResult;
}

async function main(): Promise<void> {
  const paths = ensureBenchmarkDirectories();
  const args = new Set(process.argv.slice(2));
  const jsonPath = path.join(paths.resultsDir, 'latest.json');
  const result = readSuiteResult(jsonPath);
  const { fixtureMarkdownPath, latestMarkdownPath } = writeMarkdownArtifacts(result);

  if (args.has('--update-docs')) {
    const snapshot = fs.readFileSync(fixtureMarkdownPath, 'utf8');
    updateDocsWithSnapshot(snapshot);
  }

  process.stdout.write(`${latestMarkdownPath}\n`);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
