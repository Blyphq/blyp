import fs from 'fs';
import path from 'path';
import { runFileThroughputScenario } from './scenarios/file.throughput';
import { runMemoryScenario } from './scenarios/memory';
import { runPlainThroughputScenario } from './scenarios/plain.throughput';
import { runStructuredThroughputScenario } from './scenarios/structured.throughput';
import type { BenchmarkSuiteResult } from './types';
import { renderBenchmarkMarkdown, writeMarkdownArtifacts } from './report';
import { collectSystemMetadata, ensureBenchmarkDirectories } from './utils/system-metadata';

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const paths = ensureBenchmarkDirectories();
  const metadata = await collectSystemMetadata();
  const throughput = [
    await runPlainThroughputScenario(),
    await runStructuredThroughputScenario(),
    await runFileThroughputScenario(),
  ];
  const memory = await runMemoryScenario();

  const result: BenchmarkSuiteResult = {
    metadata,
    throughput,
    memory,
    notes: [
      'Pino is the primary baseline because Blyp builds on top of it.',
      'Winston is included as the incumbent comparison.',
    ],
  };

  const timestamp = metadata.generatedAtUtc.replace(/[:]/g, '-');
  const timestampedJsonPath = path.join(paths.resultsDir, `${timestamp}.json`);
  const fixtureJsonPath = path.join(paths.fixturesDir, 'latest.json');
  fs.writeFileSync(paths.latestJsonPath, JSON.stringify(result, null, 2));
  fs.writeFileSync(timestampedJsonPath, JSON.stringify(result, null, 2));
  fs.writeFileSync(fixtureJsonPath, JSON.stringify(result, null, 2));

  if (!args.has('--json-only')) {
    writeMarkdownArtifacts(result);
    process.stdout.write(`${renderBenchmarkMarkdown(result)}\n`);
  } else {
    process.stdout.write(`${paths.latestJsonPath}\n`);
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
