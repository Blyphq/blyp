import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { describe, expect, it } from 'bun:test';

const repoRoot = path.resolve(import.meta.dir, '..');
const rootDeclarationPath = path.join(repoRoot, 'dist/index.d.ts');
const elysiaLoggerDeclarationPath = path.join(repoRoot, 'dist/frameworks/elysia/logger.d.ts');
const typescriptBinPath = path.join(repoRoot, 'node_modules/.bin/tsc');
let typesBuilt = false;

function ensureTypeDeclarations(): void {
  if (typesBuilt && fs.existsSync(elysiaLoggerDeclarationPath)) {
    return;
  }

  const result = spawnSync('bun', ['run', 'build:types'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(
      `Failed to build type declarations for package surface tests.\n${result.stderr || result.stdout}`
    );
  }

  typesBuilt = true;
}

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

function compileFixture(source: string): ReturnType<typeof spawnSync> {
  ensureTypeDeclarations();

  const tempDir = fs.mkdtempSync(path.join(repoRoot, '.tmp-config-types-'));
  const fixturePath = path.join(tempDir, 'index.ts');
  const tsconfigPath = path.join(tempDir, 'tsconfig.json');
  const packageDir = path.join(tempDir, 'node_modules', '@blyp', 'core');

  fs.mkdirSync(path.dirname(packageDir), { recursive: true });
  fs.symlinkSync(repoRoot, packageDir, 'dir');

  fs.writeFileSync(fixturePath, source);
  fs.writeFileSync(
    tsconfigPath,
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        noEmit: true,
        skipLibCheck: true,
      },
      include: ['./index.ts'],
    }, null, 2)
  );

  try {
    return spawnSync(typescriptBinPath, ['--project', tsconfigPath, '--pretty', 'false'], {
      cwd: tempDir,
      encoding: 'utf8',
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
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
        'solid-start': ['dist/frameworks/solid-start/index.d.ts'],
        sveltekit: ['dist/frameworks/sveltekit/index.d.ts'],
        astro: ['dist/frameworks/astro/index.d.ts'],
        nitro: ['dist/frameworks/nitro/index.d.ts'],
        nuxt: ['dist/frameworks/nuxt/index.d.ts'],
        'ai/vercel': ['dist/ai/vercel/index.d.ts'],
        'ai/better-agent': ['dist/ai/better-agent/index.d.ts'],
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
      './solid-start': {
        types: './dist/frameworks/solid-start/index.d.ts',
        import: './dist/solid-start.mjs',
        require: './dist/solid-start.js',
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
      './ai/better-agent': {
        types: './dist/ai/better-agent/index.d.ts',
        import: './dist/ai/better-agent.mjs',
        require: './dist/ai/better-agent.js',
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

  it('keeps the Elysia declaration surface opaque to avoid duplicate framework type instances', () => {
    ensureTypeDeclarations();

    const elysiaLoggerDeclaration = fs.readFileSync(elysiaLoggerDeclarationPath, 'utf8');

    expect(elysiaLoggerDeclaration).toContain(
      'export declare function createElysiaLogger(config?: ElysiaLoggerConfig): ElysiaLoggerPlugin;'
    );
    expect(elysiaLoggerDeclaration).not.toContain("import { Elysia } from 'elysia';");
  });

  it('exports the root config authoring helpers in the declaration surface', () => {
    ensureTypeDeclarations();

    const rootDeclaration = fs.readFileSync(rootDeclarationPath, 'utf8');

    expect(rootDeclaration).toContain('defineConfig');
    expect(rootDeclaration).toContain('BlypUserConfig');
  });

  it('allows valid typed blyp.config authoring through the published declarations', () => {
    const result = compileFixture(`
      import { defineConfig } from '@blyp/core';
      import type { BlypUserConfig } from '@blyp/core';

      export default defineConfig({
        level: 'info',
        file: {
          rotation: {
            maxArchives: 3,
          },
        },
        connectors: {
          posthog: {
            enabled: true,
            mode: 'auto',
          },
        },
      });

      const alternative = {
        destination: 'file',
        clientLogging: {
          path: '/ingest',
        },
      } satisfies BlypUserConfig;

      alternative;
    `);

    expect(result.status).toBe(0);
  });

  it('exposes SolidStart locals augmentation through the published declarations', () => {
    const result = compileFixture(`
      import type { BlypLogger } from '@blyp/core';
      import type { SolidStartLoggerFactory } from '@blyp/core/solid-start';

      const loggerFactory = null as unknown as SolidStartLoggerFactory;
      loggerFactory;

      const locals = {} as App.RequestEventLocals;
      const maybeLogger: BlypLogger | undefined = locals.blypLog;
      const maybeTraceId: string | undefined = locals.blypTraceId;

      maybeLogger;
      maybeTraceId;
    `);

    expect(result.status).toBe(0);
  });

  it('rejects invalid typed blyp.config authoring through the published declarations', () => {
    const result = compileFixture(`
      import { defineConfig } from '@blyp/core';

      defineConfig({
        // @ts-expect-error misspelled config keys should fail
        levle: 'info',
      });

      defineConfig({
        // @ts-expect-error unsupported destination literals should fail
        destination: 'stdout',
      });
    `);

    expect(result.status).toBe(0);
  });

  it('declares framework and connector integrations as optional peers', () => {
    const packageJson = readPackageJson();

    const optionalPeers = [
      '@better-agent/core',
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
      '@solidjs/start',
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
