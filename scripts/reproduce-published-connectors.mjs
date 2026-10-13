import { mkdtempSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '..');
const fixture = mkdtempSync(join(tmpdir(), 'blyp-published-'));
const version = process.argv[2] || '0.1.30';
try {
  const metadata = JSON.parse(execFileSync('npm', ['pack', `@blyp/core@${version}`, '--json', '--pack-destination', fixture], { encoding: 'utf8' }))[0];
  const sdkNames = ['posthog-node', '@sentry/node', '@opentelemetry/api-logs', '@opentelemetry/exporter-logs-otlp-http', '@opentelemetry/resources', '@opentelemetry/sdk-logs'];
  const pkg = JSON.parse(execFileSync('node', ['-p', 'JSON.stringify(require("./package.json"))'], { cwd: root, encoding: 'utf8' }));
  writeFileSync(join(fixture, 'package.json'), JSON.stringify({ private: true }));
  execFileSync('npm', ['install', '--ignore-scripts', '--legacy-peer-deps', join(fixture, metadata.filename), ...sdkNames.map(name => `${name}@${pkg.devDependencies[name]}`)], { cwd: fixture, stdio: 'pipe' });
  console.log(JSON.stringify({ version, missingSenders: ['connectors/posthog/sender', 'connectors/sentry/sender'].map(path => ({ path, files: metadata.files.filter(f => f.path.includes(path)).map(f => f.path) })) }));
  cpSync(join(root, 'tests/fixtures/packed-connectors/published.cjs'), join(fixture, 'published.cjs'));
  execFileSync('node', ['published.cjs'], { cwd: fixture, stdio: 'inherit', env: { ...process.env, BLYP_PUBLISHED_VERSION: version }, timeout: 30_000 });
} finally { rmSync(fixture, { recursive: true, force: true }); }
