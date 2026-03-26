import { createJiti } from 'jiti';

const jiti = createJiti(
  typeof __filename === 'string' ? __filename : import.meta.url,
  {
    interopDefault: false,
    moduleCache: true,
    fsCache: false,
  }
);

const moduleCache = new Map<string, unknown>();

function isMissingModuleError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const code = 'code' in error ? error.code : undefined;
  const message = 'message' in error ? error.message : undefined;

  return code === 'MODULE_NOT_FOUND' ||
    code === 'ERR_MODULE_NOT_FOUND' ||
    (typeof message === 'string' && (
      message.includes('Cannot find module') ||
      message.includes('Cannot find package')
    ));
}

export function loadOptionalModule<TModule>(
  subpath: string,
  peerDependencies: string[],
  modulePath: string = `@blyp/core/${subpath}`
): TModule {
  const moduleId = `@blyp/core/${subpath}`;
  const cacheKey = `${moduleId}::${modulePath}`;
  const cached = moduleCache.get(cacheKey);

  if (cached) {
    return cached as TModule;
  }

  try {
    const loaded = jiti(modulePath) as TModule;
    moduleCache.set(cacheKey, loaded);
    return loaded;
  } catch (error) {
    if (!isMissingModuleError(error)) {
      throw error;
    }

    const peerList = peerDependencies.map((dependency) => `"${dependency}"`).join(', ');
    const installHint = peerDependencies.join(' ');

    throw new Error(
      `[Blyp] Optional connector dependencies missing for "${moduleId}". Install ${peerList} to use this API. Example: bun add ${installHint}. You can also import directly from "${moduleId}".`,
      { cause: error instanceof Error ? error : undefined }
    );
  }
}
