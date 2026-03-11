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
      exports: Record<string, { types?: string }>;
    };

    expect(packageJson.exports['./client']?.types).toBe('./types/client.d.ts');
    expect(packageJson.exports['./expo']?.types).toBe('./types/expo.d.ts');
    expect(packageJson.exports['./posthog']?.types).toBe('./types/posthog.d.ts');
    expect(packageJson.exports['./otlp']?.types).toBe('./types/otlp.d.ts');
    expect(packageJson.exports['./sentry']?.types).toBe('./types/sentry.d.ts');
    expect(packageJson.exports['./workers']?.types).toBe('./types/workers.d.ts');

    expect(fs.existsSync(path.join(repoRoot, 'types/client.d.ts'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'types/expo.d.ts'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'types/posthog.d.ts'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'types/otlp.d.ts'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'types/sentry.d.ts'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'types/workers.d.ts'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'types/frameworks/client.d.ts'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'types/frameworks/expo.d.ts'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'types/frameworks/posthog.d.ts'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'types/frameworks/otlp.d.ts'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'types/frameworks/sentry.d.ts'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'types/frameworks/workers.d.ts'))).toBe(true);
  });

  it('declares the public client, expo, posthog, otlp, sentry, and workers entrypoints directly', () => {
    const clientTypes = readRepoFile('types/client.d.ts');
    const expoTypes = readRepoFile('types/expo.d.ts');
    const posthogTypes = readRepoFile('types/posthog.d.ts');
    const otlpTypes = readRepoFile('types/otlp.d.ts');
    const sentryTypes = readRepoFile('types/sentry.d.ts');
    const workersTypes = readRepoFile('types/workers.d.ts');

    expect(clientTypes).toContain('createClientLogger');
    expect(clientTypes).toContain("from './frameworks/client'");
    expect(expoTypes).toContain('createExpoLogger');
    expect(expoTypes).toContain("from './frameworks/expo'");
    expect(posthogTypes).toContain('createPosthogLogger');
    expect(posthogTypes).toContain("from './frameworks/posthog'");
    expect(otlpTypes).toContain('createOtlpLogger');
    expect(otlpTypes).toContain("from './frameworks/otlp'");
    expect(sentryTypes).toContain('createSentryLogger');
    expect(sentryTypes).toContain("from './frameworks/sentry'");
    expect(workersTypes).toContain('createWorkersLogger');
    expect(workersTypes).toContain("from './frameworks/workers'");
    expect(clientTypes).not.toContain("../dist/client");
    expect(expoTypes).not.toContain("../dist/expo");
    expect(posthogTypes).not.toContain("../dist/posthog");
    expect(otlpTypes).not.toContain("../dist/otlp");
    expect(sentryTypes).not.toContain("../dist/sentry");
    expect(workersTypes).not.toContain("../dist/workers");
  });
});
