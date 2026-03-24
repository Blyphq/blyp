import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'bun:test';

const repoRoot = path.resolve(import.meta.dir, '..');

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('Package type shims', () => {
  it('declares optional peer dependencies for framework-specific entrypoints', () => {
    const packageJson = JSON.parse(readRepoFile('package.json')) as {
      peerDependencies?: Record<string, string>;
      peerDependenciesMeta?: Record<string, { optional?: boolean }>;
    };

    expect(packageJson.peerDependencies?.next).toBe('^15');
    expect(packageJson.peerDependenciesMeta?.next?.optional).toBe(true);
    expect(packageJson.peerDependencies?.['@sveltejs/kit']).toBe('^2');
    expect(packageJson.peerDependenciesMeta?.['@sveltejs/kit']?.optional).toBe(true);
    expect(packageJson.peerDependencies?.['@tanstack/react-start']).toBe('^1');
    expect(packageJson.peerDependenciesMeta?.['@tanstack/react-start']?.optional).toBe(true);
    expect(packageJson.peerDependencies?.ai).toBe('^6');
    expect(packageJson.peerDependenciesMeta?.ai?.optional).toBe(true);
    expect(packageJson.peerDependencies?.elysia).toBe('^1.4.27');
    expect(packageJson.peerDependenciesMeta?.elysia?.optional).toBe(true);
    expect(packageJson.peerDependencies?.['react-router']).toBe('^7');
    expect(packageJson.peerDependenciesMeta?.['react-router']?.optional).toBe(true);
    expect(packageJson.peerDependencies?.astro).toBe('^6');
    expect(packageJson.peerDependenciesMeta?.astro?.optional).toBe(true);
    expect(packageJson.peerDependencies?.nitropack).toBe('^2');
    expect(packageJson.peerDependenciesMeta?.nitropack?.optional).toBe(true);
    expect(packageJson.peerDependencies?.nuxt).toBe('^4');
    expect(packageJson.peerDependenciesMeta?.nuxt?.optional).toBe(true);
  });

  it('points public exports at shipped declaration files', () => {
    const packageJson = JSON.parse(readRepoFile('package.json')) as {
      exports: Record<string, { types?: string; import?: string; require?: string }>;
    };

    expect(packageJson.exports['./client']?.types).toBe('./types/client.d.ts');
    expect(packageJson.exports['./expo']?.types).toBe('./types/expo.d.ts');
    expect(packageJson.exports['./database']?.types).toBe('./types/database.d.ts');
    expect(packageJson.exports['./betterstack']?.types).toBe('./types/connectors/betterstack.d.ts');
    expect(packageJson.exports['./databuddy']?.types).toBe('./types/connectors/databuddy.d.ts');
    expect(packageJson.exports['./posthog']?.types).toBe('./types/connectors/posthog.d.ts');
    expect(packageJson.exports['./otlp']?.types).toBe('./types/connectors/otlp.d.ts');
    expect(packageJson.exports['./sentry']?.types).toBe('./types/connectors/sentry.d.ts');
    expect(packageJson.exports['./workers']?.types).toBe('./types/workers.d.ts');
    expect(packageJson.exports['./ai/vercel']?.types).toBe('./types/ai/vercel.d.ts');
    expect(packageJson.exports['./ai/openai']?.types).toBe('./types/ai/openai.d.ts');
    expect(packageJson.exports['./ai/anthropic']?.types).toBe('./types/ai/anthropic.d.ts');
    expect(packageJson.exports['./ai/shared']?.types).toBe('./types/ai/shared.d.ts');
    expect(packageJson.exports['./ai/fetch']?.types).toBe('./types/ai/fetch.d.ts');
    expect(packageJson.exports['./react-router']?.types).toBe('./types/frameworks/react-router.d.ts');
    expect(packageJson.exports['./astro']?.types).toBe('./types/frameworks/astro.d.ts');
    expect(packageJson.exports['./nitro']?.types).toBe('./types/frameworks/nitro.d.ts');
    expect(packageJson.exports['./nuxt']?.types).toBe('./types/frameworks/nuxt.d.ts');
    expect(packageJson.exports['./betterstack']?.import).toBe('./exports/connectors/betterstack.mjs');
    expect(packageJson.exports['./database']?.import).toBe('./exports/database.mjs');
    expect(packageJson.exports['./databuddy']?.import).toBe('./exports/connectors/databuddy.mjs');
    expect(packageJson.exports['./posthog']?.import).toBe('./exports/connectors/posthog.mjs');
    expect(packageJson.exports['./otlp']?.import).toBe('./exports/connectors/otlp.mjs');
    expect(packageJson.exports['./sentry']?.import).toBe('./exports/connectors/sentry.mjs');
    expect(packageJson.exports['./betterstack']?.require).toBe('./exports/connectors/betterstack.js');
    expect(packageJson.exports['./database']?.require).toBe('./exports/database.js');
    expect(packageJson.exports['./databuddy']?.require).toBe('./exports/connectors/databuddy.js');
    expect(packageJson.exports['./posthog']?.require).toBe('./exports/connectors/posthog.js');
    expect(packageJson.exports['./otlp']?.require).toBe('./exports/connectors/otlp.js');
    expect(packageJson.exports['./sentry']?.require).toBe('./exports/connectors/sentry.js');
    expect(packageJson.exports['./ai/vercel']?.import).toBe('./exports/ai/vercel.mjs');
    expect(packageJson.exports['./ai/openai']?.import).toBe('./exports/ai/openai.mjs');
    expect(packageJson.exports['./ai/anthropic']?.import).toBe('./exports/ai/anthropic.mjs');
    expect(packageJson.exports['./ai/shared']?.import).toBe('./exports/ai/shared.mjs');
    expect(packageJson.exports['./ai/fetch']?.import).toBe('./exports/ai/fetch.mjs');
    expect(packageJson.exports['./ai/vercel']?.require).toBe('./exports/ai/vercel.js');
    expect(packageJson.exports['./ai/openai']?.require).toBe('./exports/ai/openai.js');
    expect(packageJson.exports['./ai/anthropic']?.require).toBe('./exports/ai/anthropic.js');
    expect(packageJson.exports['./ai/shared']?.require).toBe('./exports/ai/shared.js');
    expect(packageJson.exports['./ai/fetch']?.require).toBe('./exports/ai/fetch.js');
    expect(packageJson.exports['./react-router']?.import).toBe('./exports/frameworks/react-router.mjs');
    expect(packageJson.exports['./astro']?.import).toBe('./exports/frameworks/astro.mjs');
    expect(packageJson.exports['./nitro']?.import).toBe('./exports/frameworks/nitro.mjs');
    expect(packageJson.exports['./nuxt']?.import).toBe('./exports/frameworks/nuxt.mjs');
    expect(packageJson.exports['./react-router']?.require).toBe('./exports/frameworks/react-router.js');
    expect(packageJson.exports['./astro']?.require).toBe('./exports/frameworks/astro.js');
    expect(packageJson.exports['./nitro']?.require).toBe('./exports/frameworks/nitro.js');
    expect(packageJson.exports['./nuxt']?.require).toBe('./exports/frameworks/nuxt.js');

    expect(fs.existsSync(path.join(repoRoot, 'types/client.d.ts'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'types/expo.d.ts'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'types/database.d.ts'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'types/connectors/betterstack.d.ts'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'types/connectors/databuddy.d.ts'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'types/connectors/posthog.d.ts'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'types/connectors/otlp.d.ts'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'types/connectors/sentry.d.ts'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'types/workers.d.ts'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'types/ai/vercel.d.ts'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'types/ai/openai.d.ts'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'types/ai/anthropic.d.ts'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'types/ai/shared.d.ts'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'types/ai/fetch.d.ts'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'types/frameworks/client.d.ts'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'types/frameworks/expo.d.ts'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'types/frameworks/react-router.d.ts'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'types/frameworks/astro.d.ts'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'types/frameworks/nitro.d.ts'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'types/frameworks/nuxt.d.ts'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'types/frameworks/posthog.d.ts'))).toBe(false);
    expect(fs.existsSync(path.join(repoRoot, 'types/frameworks/otlp.d.ts'))).toBe(false);
    expect(fs.existsSync(path.join(repoRoot, 'types/frameworks/sentry.d.ts'))).toBe(false);
    expect(fs.existsSync(path.join(repoRoot, 'types/frameworks/workers.d.ts'))).toBe(true);
  });

  it('keeps public client and expo declarations as direct shims and moves connector declarations under types/connectors', () => {
    const clientTypes = readRepoFile('types/client.d.ts');
    const expoTypes = readRepoFile('types/expo.d.ts');
    const databaseTypes = readRepoFile('types/database.d.ts');
    const betterStackTypes = readRepoFile('types/connectors/betterstack.d.ts');
    const databuddyTypes = readRepoFile('types/connectors/databuddy.d.ts');
    const posthogTypes = readRepoFile('types/connectors/posthog.d.ts');
    const otlpTypes = readRepoFile('types/connectors/otlp.d.ts');
    const sentryTypes = readRepoFile('types/connectors/sentry.d.ts');
    const workersTypes = readRepoFile('types/workers.d.ts');
    const aiVercelTypes = readRepoFile('types/ai/vercel.d.ts');
    const aiOpenAITypes = readRepoFile('types/ai/openai.d.ts');
    const aiAnthropicTypes = readRepoFile('types/ai/anthropic.d.ts');
    const aiSharedTypes = readRepoFile('types/ai/shared.d.ts');
    const aiFetchTypes = readRepoFile('types/ai/fetch.d.ts');

    expect(clientTypes).toContain('createClientLogger');
    expect(clientTypes).toContain("from './frameworks/client'");
    expect(expoTypes).toContain('createExpoLogger');
    expect(expoTypes).toContain("from './frameworks/expo'");
    expect(databaseTypes).toContain('../dist/database');
    expect(betterStackTypes).toContain('../../dist/connectors/betterstack');
    expect(databuddyTypes).toContain('../../dist/connectors/databuddy');
    expect(posthogTypes).toContain('../../dist/connectors/posthog');
    expect(otlpTypes).toContain('../../dist/connectors/otlp');
    expect(sentryTypes).toContain('../../dist/connectors/sentry');
    expect(workersTypes).toContain('createWorkersLogger');
    expect(workersTypes).toContain("from './frameworks/workers'");
    expect(aiVercelTypes).toContain('../../dist/ai/vercel');
    expect(aiOpenAITypes).toContain('../../dist/ai/openai');
    expect(aiAnthropicTypes).toContain('../../dist/ai/anthropic');
    expect(aiSharedTypes).toContain('../../dist/ai/shared');
    expect(aiFetchTypes).toContain('../../dist/ai/fetch');
    expect(clientTypes).not.toContain("../dist/client");
    expect(expoTypes).not.toContain("../dist/expo");
    expect(betterStackTypes).not.toContain('../../dist/betterstack');
    expect(databuddyTypes).not.toContain('../../dist/databuddy');
    expect(posthogTypes).not.toContain('../../dist/posthog');
    expect(otlpTypes).not.toContain('../../dist/otlp');
    expect(sentryTypes).not.toContain('../../dist/sentry');
    expect(workersTypes).not.toContain("../dist/workers");
  });

  it('points framework declaration shims at dist/frameworks entrypoints', () => {
    const elysiaTypes = readRepoFile('types/frameworks/elysia.d.ts');
    const expressTypes = readRepoFile('types/frameworks/express.d.ts');
    const fastifyTypes = readRepoFile('types/frameworks/fastify.d.ts');
    const honoTypes = readRepoFile('types/frameworks/hono.d.ts');
    const nestjsTypes = readRepoFile('types/frameworks/nestjs.d.ts');
    const nextjsTypes = readRepoFile('types/frameworks/nextjs.d.ts');
    const reactRouterTypes = readRepoFile('types/frameworks/react-router.d.ts');
    const standaloneTypes = readRepoFile('types/frameworks/standalone.d.ts');
    const sveltekitTypes = readRepoFile('types/frameworks/sveltekit.d.ts');
    const tanstackStartTypes = readRepoFile('types/frameworks/tanstack-start.d.ts');
    const astroTypes = readRepoFile('types/frameworks/astro.d.ts');
    const nitroTypes = readRepoFile('types/frameworks/nitro.d.ts');
    const nuxtTypes = readRepoFile('types/frameworks/nuxt.d.ts');

    expect(elysiaTypes).toContain('../../dist/frameworks/elysia');
    expect(expressTypes).toContain('../../dist/frameworks/express');
    expect(fastifyTypes).toContain('../../dist/frameworks/fastify');
    expect(honoTypes).toContain('../../dist/frameworks/hono');
    expect(nestjsTypes).toContain('../../dist/frameworks/nestjs');
    expect(nextjsTypes).toContain('../../dist/frameworks/nextjs');
    expect(reactRouterTypes).toContain('../../dist/frameworks/react-router');
    expect(standaloneTypes).toContain('../../dist/frameworks/standalone');
    expect(sveltekitTypes).toContain('../../dist/frameworks/sveltekit');
    expect(tanstackStartTypes).toContain('../../dist/frameworks/tanstack-start');
    expect(astroTypes).toContain('../../dist/frameworks/astro');
    expect(nitroTypes).toContain('../../dist/frameworks/nitro');
    expect(nuxtTypes).toContain('../../dist/frameworks/nuxt');

    expect(elysiaTypes).not.toContain('../../dist/elysia');
    expect(expressTypes).not.toContain('../../dist/express');
    expect(fastifyTypes).not.toContain('../../dist/fastify');
    expect(honoTypes).not.toContain('../../dist/hono');
    expect(nestjsTypes).not.toContain('../../dist/nestjs');
    expect(nextjsTypes).not.toContain('../../dist/nextjs');
    expect(reactRouterTypes).not.toContain('../../dist/react-router');
    expect(standaloneTypes).not.toContain('../../dist/standalone');
    expect(sveltekitTypes).not.toContain('../../dist/sveltekit');
    expect(tanstackStartTypes).not.toContain('../../dist/tanstack-start');
    expect(astroTypes).not.toContain('../../dist/astro');
    expect(nitroTypes).not.toContain('../../dist/nitro');
    expect(nuxtTypes).not.toContain('../../dist/nuxt');
  });
});
