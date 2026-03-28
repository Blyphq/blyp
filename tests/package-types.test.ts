import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'bun:test';

const repoRoot = path.resolve(import.meta.dir, '..');

function readPackageJson(): {
  types?: string;
  files?: string[];
  exports?: Record<string, { types?: string; import?: string; require?: string }>;
  typesVersions?: Record<string, unknown>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  dependencies?: Record<string, string>;
} {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
}

describe('package surface', () => {
  it('publishes dist directly and removes shim directories', () => {
    const packageJson = readPackageJson();

    expect(packageJson.types).toBe('./dist/index.d.ts');
    expect(packageJson.files).toEqual(['dist', 'README.md', 'STABILITY.md']);
    expect(fs.existsSync(path.join(repoRoot, 'exports'))).toBe(false);
    expect(fs.existsSync(path.join(repoRoot, 'types'))).toBe(false);
  });

  it('keeps a typesVersions fallback for legacy TypeScript module resolution', () => {
    const packageJson = readPackageJson();

    expect(packageJson.typesVersions).toEqual({
      '*': {
        standalone: ['dist/frameworks/standalone/index.d.ts'],
        elysia: ['dist/frameworks/elysia/index.d.ts'],
        hono: ['dist/frameworks/hono/index.d.ts'],
        express: ['dist/frameworks/express/index.d.ts'],
        fastify: ['dist/frameworks/fastify/index.d.ts'],
        nestjs: ['dist/frameworks/nestjs/index.d.ts'],
        nextjs: ['dist/frameworks/nextjs/index.d.ts'],
        'react-router': ['dist/frameworks/react-router/index.d.ts'],
        'tanstack-start': ['dist/frameworks/tanstack-start/index.d.ts'],
        sveltekit: ['dist/frameworks/sveltekit/index.d.ts'],
        astro: ['dist/frameworks/astro/index.d.ts'],
        nitro: ['dist/frameworks/nitro/index.d.ts'],
        nuxt: ['dist/frameworks/nuxt/index.d.ts'],
        'ai/vercel': ['dist/ai/vercel/index.d.ts'],
        'ai/openai': ['dist/ai/openai/index.d.ts'],
        'ai/anthropic': ['dist/ai/anthropic/index.d.ts'],
        'ai/shared': ['dist/ai/shared/index.d.ts'],
        'ai/fetch': ['dist/ai/shared/fetch.d.ts'],
        client: ['dist/frameworks/client/index.d.ts'],
        expo: ['dist/frameworks/expo/index.d.ts'],
        database: ['dist/database/index.d.ts'],
        betterstack: ['dist/connectors/betterstack/index.d.ts'],
        databuddy: ['dist/connectors/databuddy/index.d.ts'],
        posthog: ['dist/connectors/posthog/index.d.ts'],
        otlp: ['dist/connectors/otlp/index.d.ts'],
        sentry: ['dist/connectors/sentry/index.d.ts'],
        workers: ['dist/frameworks/workers/index.d.ts'],
      },
    });
  });

  it('points package exports directly at built dist files', () => {
    const packageJson = readPackageJson();
    const expectedExports: Record<string, { types: string; import: string; require: string }> = {
      '.': {
        types: './dist/index.d.ts',
        import: './dist/index.mjs',
        require: './dist/index.js',
      },
      './standalone': {
        types: './dist/frameworks/standalone/index.d.ts',
        import: './dist/standalone.mjs',
        require: './dist/standalone.js',
      },
      './elysia': {
        types: './dist/frameworks/elysia/index.d.ts',
        import: './dist/elysia.mjs',
        require: './dist/elysia.js',
      },
      './hono': {
        types: './dist/frameworks/hono/index.d.ts',
        import: './dist/hono.mjs',
        require: './dist/hono.js',
      },
      './express': {
        types: './dist/frameworks/express/index.d.ts',
        import: './dist/express.mjs',
        require: './dist/express.js',
      },
      './fastify': {
        types: './dist/frameworks/fastify/index.d.ts',
        import: './dist/fastify.mjs',
        require: './dist/fastify.js',
      },
      './nestjs': {
        types: './dist/frameworks/nestjs/index.d.ts',
        import: './dist/nestjs.mjs',
        require: './dist/nestjs.js',
      },
      './nextjs': {
        types: './dist/frameworks/nextjs/index.d.ts',
        import: './dist/nextjs.mjs',
        require: './dist/nextjs.js',
      },
      './react-router': {
        types: './dist/frameworks/react-router/index.d.ts',
        import: './dist/react-router.mjs',
        require: './dist/react-router.js',
      },
      './tanstack-start': {
        types: './dist/frameworks/tanstack-start/index.d.ts',
        import: './dist/tanstack-start.mjs',
        require: './dist/tanstack-start.js',
      },
      './sveltekit': {
        types: './dist/frameworks/sveltekit/index.d.ts',
        import: './dist/sveltekit.mjs',
        require: './dist/sveltekit.js',
      },
      './astro': {
        types: './dist/frameworks/astro/index.d.ts',
        import: './dist/astro.mjs',
        require: './dist/astro.js',
      },
      './nitro': {
        types: './dist/frameworks/nitro/index.d.ts',
        import: './dist/nitro.mjs',
        require: './dist/nitro.js',
      },
      './nuxt': {
        types: './dist/frameworks/nuxt/index.d.ts',
        import: './dist/nuxt.mjs',
        require: './dist/nuxt.js',
      },
      './ai/vercel': {
        types: './dist/ai/vercel/index.d.ts',
        import: './dist/ai/vercel.mjs',
        require: './dist/ai/vercel.js',
      },
      './ai/openai': {
        types: './dist/ai/openai/index.d.ts',
        import: './dist/ai/openai.mjs',
        require: './dist/ai/openai.js',
      },
      './ai/anthropic': {
        types: './dist/ai/anthropic/index.d.ts',
        import: './dist/ai/anthropic.mjs',
        require: './dist/ai/anthropic.js',
      },
      './ai/shared': {
        types: './dist/ai/shared/index.d.ts',
        import: './dist/ai/shared.mjs',
        require: './dist/ai/shared.js',
      },
      './ai/fetch': {
        types: './dist/ai/shared/fetch.d.ts',
        import: './dist/ai/fetch.mjs',
        require: './dist/ai/fetch.js',
      },
      './client': {
        types: './dist/frameworks/client/index.d.ts',
        import: './dist/client.mjs',
        require: './dist/client.js',
      },
      './expo': {
        types: './dist/frameworks/expo/index.d.ts',
        import: './dist/expo.mjs',
        require: './dist/expo.js',
      },
      './database': {
        types: './dist/database/index.d.ts',
        import: './dist/database.mjs',
        require: './dist/database.js',
      },
      './betterstack': {
        types: './dist/connectors/betterstack/index.d.ts',
        import: './dist/connectors/betterstack.mjs',
        require: './dist/connectors/betterstack.js',
      },
      './databuddy': {
        types: './dist/connectors/databuddy/index.d.ts',
        import: './dist/connectors/databuddy.mjs',
        require: './dist/connectors/databuddy.js',
      },
      './posthog': {
        types: './dist/connectors/posthog/index.d.ts',
        import: './dist/connectors/posthog.mjs',
        require: './dist/connectors/posthog.js',
      },
      './otlp': {
        types: './dist/connectors/otlp/index.d.ts',
        import: './dist/connectors/otlp.mjs',
        require: './dist/connectors/otlp.js',
      },
      './sentry': {
        types: './dist/connectors/sentry/index.d.ts',
        import: './dist/connectors/sentry.mjs',
        require: './dist/connectors/sentry.js',
      },
      './workers': {
        types: './dist/frameworks/workers/index.d.ts',
        import: './dist/workers.mjs',
        require: './dist/workers.js',
      },
    };

    expect(packageJson.exports).toEqual(expectedExports);
    expect(packageJson.exports?.['./connectors/posthog']).toBeUndefined();
    expect(packageJson.exports?.['./connectors/sentry']).toBeUndefined();
  });

  it('declares framework and connector integrations as optional peers', () => {
    const packageJson = readPackageJson();

    const optionalPeers = [
      '@databuddy/sdk',
      '@logtail/node',
      '@nestjs/common',
      '@nestjs/core',
      '@nestjs/platform-express',
      '@nestjs/platform-fastify',
      '@opentelemetry/api-logs',
      '@opentelemetry/exporter-logs-otlp-http',
      '@opentelemetry/resources',
      '@opentelemetry/sdk-logs',
      '@prisma/client',
      '@sentry/node',
      '@sveltejs/kit',
      '@tanstack/react-start',
      'ai',
      'astro',
      'drizzle-orm',
      'elysia',
      'express',
      'fastify',
      'hono',
      'next',
      'nitropack',
      'nuxt',
      'posthog-node',
      'react-router',
      'rxjs',
    ] as const;

    for (const dependency of optionalPeers) {
      expect(packageJson.peerDependencies?.[dependency]).toBeDefined();
      expect(packageJson.peerDependenciesMeta?.[dependency]?.optional).toBe(true);
    }

    expect(packageJson.peerDependencies?.['@databuddy/sdk']).toBe('^2');
    expect(packageJson.peerDependencies?.['@logtail/node']).toBe('^0.5');
    expect(packageJson.peerDependencies?.['@opentelemetry/api-logs']).toBe('^0.206');
    expect(packageJson.peerDependencies?.['@opentelemetry/exporter-logs-otlp-http']).toBe('^0.206');
    expect(packageJson.peerDependencies?.['@opentelemetry/resources']).toBe('^2');
    expect(packageJson.peerDependencies?.['@opentelemetry/sdk-logs']).toBe('^0.206');
    expect(packageJson.peerDependencies?.['@sentry/node']).toBe('^10');
    expect(packageJson.peerDependencies?.['posthog-node']).toBe('^5');
  });

  it('keeps only the core runtime dependencies installed by default', () => {
    const packageJson = readPackageJson();

    expect(packageJson.dependencies).toEqual({
      fflate: '0.8.2',
      jiti: '2.6.1',
      pino: '9.14.0',
      'pino-pretty': '11.3.0',
      zod: '3.25.76',
    });
  });
});
