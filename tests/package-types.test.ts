import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'bun:test';

const repoRoot = path.resolve(import.meta.dir, '..');

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('Package type shims', () => {
  it('points client and workers exports at shipped declaration files', () => {
    const packageJson = JSON.parse(readRepoFile('package.json')) as {
      exports: Record<string, { types?: string }>;
    };

    expect(packageJson.exports['./client']?.types).toBe('./types/client.d.ts');
    expect(packageJson.exports['./expo']?.types).toBe('./types/expo.d.ts');
    expect(packageJson.exports['./posthog']?.types).toBe('./types/posthog.d.ts');
    expect(packageJson.exports['./workers']?.types).toBe('./types/workers.d.ts');

    expect(fs.existsSync(path.join(repoRoot, 'types/client.d.ts'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'types/expo.d.ts'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'types/posthog.d.ts'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'types/workers.d.ts'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'types/frameworks/client.d.ts'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'types/frameworks/expo.d.ts'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'types/frameworks/posthog.d.ts'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'types/frameworks/workers.d.ts'))).toBe(true);
  });

  it('declares the public client, expo, posthog, and workers entrypoints directly', () => {
    const clientTypes = readRepoFile('types/client.d.ts');
    const expoTypes = readRepoFile('types/expo.d.ts');
    const posthogTypes = readRepoFile('types/posthog.d.ts');
    const workersTypes = readRepoFile('types/workers.d.ts');

    expect(clientTypes).toContain('createClientLogger');
    expect(clientTypes).toContain("from './frameworks/client'");
    expect(expoTypes).toContain('createExpoLogger');
    expect(expoTypes).toContain("from './frameworks/expo'");
    expect(posthogTypes).toContain('createPosthogLogger');
    expect(posthogTypes).toContain("from './frameworks/posthog'");
    expect(workersTypes).toContain('createWorkersLogger');
    expect(workersTypes).toContain("from './frameworks/workers'");
    expect(clientTypes).not.toContain("../dist/client");
    expect(expoTypes).not.toContain("../dist/expo");
    expect(posthogTypes).not.toContain("../dist/posthog");
    expect(workersTypes).not.toContain("../dist/workers");
  });
});
