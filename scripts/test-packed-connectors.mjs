import { mkdtempSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '..');
const fixture = mkdtempSync(join(tmpdir(), 'blyp-packed-'));
const bare = mkdtempSync(join(tmpdir(), 'blyp-no-sdks-'));
try {
  if (!process.env.BLYP_TEST_TARBALL) execFileSync('bun', ['run', 'build'], { cwd: root, stdio: 'pipe' });
  const packed = process.env.BLYP_TEST_TARBALL || join(fixture, JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', fixture], { cwd: root, encoding: 'utf8' }))[0].filename);
  const files = execFileSync('tar', ['-tf', packed], { encoding: 'utf8' });
  for (const doc of ['contracts.md', 'carsxe-migration.md', 'investigation.md', 'RELEASE_NOTES.md']) if (!files.includes(doc)) throw new Error(`Packed artifact missing ${doc}`);
  writeFileSync(join(bare, 'package.json'), JSON.stringify({ private: true }));
  execFileSync('npm', ['install', '--ignore-scripts', '--legacy-peer-deps', packed], { cwd: bare, stdio: 'pipe' });
  execFileSync('node', ['-e', `
    const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blyp-no-credentials-'));
    process.chdir(dir);
    const { createStandaloneLogger } = require('@blyp/core/standalone');
    const logger = createStandaloneLogger({ pretty: false, file: { enabled: false }, clientLogging: { enabled: false }, connectors: { delivery: { enabled: false }, posthog: { enabled: true }, sentry: { enabled: true } } });
    logger.info('optional credentials missing');
    logger.shutdown().then(result => { require('node:assert/strict').equal(result.status, 'delivered'); require('node:assert/strict').deepEqual(fs.readdirSync(dir), []); fs.rmSync(dir, {recursive:true}); });
  `], { cwd: bare, stdio: 'inherit', timeout: 15_000 });
  writeFileSync(join(fixture, 'package.json'), JSON.stringify({ private: true }));
  const pkg = JSON.parse(execFileSync('node', ['-p', 'JSON.stringify(require("./package.json"))'], { cwd: root, encoding: 'utf8' }));
  const sdkNames = ['posthog-node', '@sentry/node', '@opentelemetry/api-logs', '@opentelemetry/exporter-logs-otlp-http', '@opentelemetry/resources', '@opentelemetry/sdk-logs'];
  execFileSync('npm', ['install', '--ignore-scripts', '--legacy-peer-deps', packed, ...sdkNames.map(name => `${name}@${pkg.devDependencies[name]}`), 'esbuild@0.25.12', 'next@16', 'react@19', 'react-dom@19'], { cwd: fixture, stdio: 'pipe' });
  cpSync(join(root, 'tests/fixtures/packed-connectors/collector.cjs'), join(fixture, 'collector.cjs'));
  cpSync(join(root, 'tests/fixtures/packed-connectors/esm.mjs'), join(fixture, 'esm.mjs'));
  for (const mode of ['cjs', 'esm']) {
    execFileSync('node', [mode === 'cjs' ? 'collector.cjs' : 'esm.mjs'], { cwd: fixture, stdio: 'inherit', timeout: 60_000 });
  }
} finally { rmSync(bare, { recursive: true, force: true }); if (!process.env.BLYP_KEEP_FIXTURE) rmSync(fixture, { recursive: true, force: true }); else console.log(fixture); }
