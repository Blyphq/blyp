import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'bun:test';

const repoRoot = path.resolve(import.meta.dir, '..');

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('Package type shims', () => {
  it('points public exports at shipped declaration files', () => {
    const packageJson = JSON.parse(readRepoFile('package.json')) as {
      exports: Record<string, { types?: string; import?: string; require?: string }>;
    };

    expect(packageJson.exports['./client']?.types).toBe('./types/client.d.ts');
    expect(packageJson.exports['./expo']?.types).toBe('./types/expo.d.ts');
    expect(packageJson.exports['./posthog']?.types).toBe('./types/connectors/posthog.d.ts');
    expect(packageJson.exports['./otlp']?.types).toBe('./types/connectors/otlp.d.ts');
    expect(packageJson.exports['./sentry']?.types).toBe('./types/connectors/sentry.d.ts');
    expect(packageJson.exports['./workers']?.types).toBe('./types/workers.d.ts');
    expect(packageJson.exports['./posthog']?.import).toBe('./exports/connectors/posthog.mjs');
    expect(packageJson.exports['./otlp']?.import).toBe('./exports/connectors/otlp.mjs');
    expect(packageJson.exports['./sentry']?.import).toBe('./exports/connectors/sentry.mjs');
    expect(packageJson.exports['./posthog']?.require).toBe('./exports/connectors/posthog.js');
    expect(packageJson.exports['./otlp']?.require).toBe('./exports/connectors/otlp.js');
    expect(packageJson.exports['./sentry']?.require).toBe('./exports/connectors/sentry.js');

    expect(fs.existsSync(path.join(repoRoot, 'types/client.d.ts'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'types/expo.d.ts'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'types/connectors/posthog.d.ts'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'types/connectors/otlp.d.ts'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'types/connectors/sentry.d.ts'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'types/workers.d.ts'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'types/frameworks/client.d.ts'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'types/frameworks/expo.d.ts'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'types/frameworks/posthog.d.ts'))).toBe(false);
    expect(fs.existsSync(path.join(repoRoot, 'types/frameworks/otlp.d.ts'))).toBe(false);
    expect(fs.existsSync(path.join(repoRoot, 'types/frameworks/sentry.d.ts'))).toBe(false);
    expect(fs.existsSync(path.join(repoRoot, 'types/frameworks/workers.d.ts'))).toBe(true);
  });

  it('keeps public client and expo declarations as direct shims and moves connector declarations under types/connectors', () => {
    const clientTypes = readRepoFile('types/client.d.ts');
    const expoTypes = readRepoFile('types/expo.d.ts');
    const posthogTypes = readRepoFile('types/connectors/posthog.d.ts');
    const otlpTypes = readRepoFile('types/connectors/otlp.d.ts');
    const sentryTypes = readRepoFile('types/connectors/sentry.d.ts');
    const workersTypes = readRepoFile('types/workers.d.ts');

    expect(clientTypes).toContain('createClientLogger');
    expect(clientTypes).toContain("from './frameworks/client'");
    expect(expoTypes).toContain('createExpoLogger');
    expect(expoTypes).toContain("from './frameworks/expo'");
    expect(posthogTypes).toContain('../../dist/connectors/posthog');
    expect(otlpTypes).toContain('../../dist/connectors/otlp');
    expect(sentryTypes).toContain('../../dist/connectors/sentry');
    expect(workersTypes).toContain('createWorkersLogger');
    expect(workersTypes).toContain("from './frameworks/workers'");
    expect(clientTypes).not.toContain("../dist/client");
    expect(expoTypes).not.toContain("../dist/expo");
    expect(posthogTypes).not.toContain('../../dist/posthog');
    expect(otlpTypes).not.toContain('../../dist/otlp');
    expect(sentryTypes).not.toContain('../../dist/sentry');
    expect(workersTypes).not.toContain("../dist/workers");
  });
});
