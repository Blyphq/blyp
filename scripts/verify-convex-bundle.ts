import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = path.resolve(import.meta.dir, '..');
const esmArtifact = path.join(repoRoot, 'dist/convex.mjs');
const cjsArtifact = path.join(repoRoot, 'dist/convex.js');
const convexBundlerPath = path.join(
  repoRoot,
  'node_modules/convex/dist/esm/bundler/debugBundle.js'
);
const bareNodeBuiltins = new Set([
  'async_hooks',
  'buffer',
  'child_process',
  'crypto',
  'events',
  'fs',
  'http',
  'https',
  'module',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'stream',
  'tls',
  'url',
  'util',
  'worker_threads',
  'zlib',
]);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertArtifactRuntimeImports(filePath: string): void {
  const source = fs.readFileSync(filePath, 'utf8');
  const runtimeSpecifiers = Array.from(
    source.matchAll(/(?:from\s*|require\()['"]([^'"]+)['"]/g),
    (match) => match[1]
  );
  assert(
    source.includes('node:async_hooks'),
    `${path.basename(filePath)} must preserve the Convex-supported node:async_hooks import.`
  );
  assert(
    !/(?:from\s*|require\()['"]async_hooks['"]/.test(source),
    `${path.basename(filePath)} must not contain the unsupported bare async_hooks import.`
  );
  const unsupportedNodeImports = runtimeSpecifiers.filter(
    (specifier) =>
      (specifier.startsWith('node:') && specifier !== 'node:async_hooks') ||
      bareNodeBuiltins.has(specifier)
  );
  assert(
    unsupportedNodeImports.length === 0,
    `${path.basename(filePath)} contains unsupported Node imports: ${unsupportedNodeImports.join(', ')}.`
  );
}

assertArtifactRuntimeImports(esmArtifact);
assertArtifactRuntimeImports(cjsArtifact);

const tempDir = fs.mkdtempSync(path.join(repoRoot, '.tmp-convex-bundle-'));
const fixturePath = path.join(tempDir, 'mixed.ts');

fs.writeFileSync(fixturePath, `
import {
  actionGeneric as action,
  httpActionGeneric as httpAction,
  mutationGeneric as mutation,
  queryGeneric as query,
} from 'convex/server';
import { logger } from '@blyp/core/convex';

export const read = query({
  args: {},
  handler: logger.wrap(async () => {
    logger.info('query');
    return null;
  }),
});

export const write = mutation({
  args: {},
  handler: logger.wrap(async () => {
    logger.info('mutation');
    return null;
  }),
});

export const run = action({
  args: {},
  handler: logger.wrap(async () => {
    logger.info('action');
    return null;
  }),
});

export const receive = httpAction(logger.wrap(async () => {
  logger.info('http action');
  return new Response(null, { status: 204 });
}));
`);

try {
  const { innerEsbuild } = await import(pathToFileURL(convexBundlerPath).href) as {
    innerEsbuild: (options: {
      entryPoints: string[];
      platform: 'browser';
      dir: string;
      extraConditions: string[];
      generateSourceMaps: boolean;
      plugins: [];
      chunksFolder: string;
      splitting: boolean;
    }) => Promise<{ outputFiles: Array<{ text: string }> }>;
  };

  const result = await innerEsbuild({
    entryPoints: [fixturePath],
    platform: 'browser',
    dir: tempDir,
    extraConditions: [],
    generateSourceMaps: false,
    plugins: [],
    chunksFolder: '_deps',
    splitting: false,
  });
  const bundledSource = result.outputFiles.map((file) => file.text).join('\n');

  assert(
    bundledSource.includes('globalThis.AsyncLocalStorage'),
    'Convex isolate bundling must replace node:async_hooks with its runtime shim.'
  );
  assert(
    !/(?:from\s*|require\()['"](?:node:)?async_hooks['"]/.test(bundledSource),
    'The Convex isolate bundle must not retain an async_hooks module import.'
  );
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log('Convex isolate bundle verification passed.');
