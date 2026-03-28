import { createRequire } from 'node:module';
import type { DestinationStream } from 'pino';

type PinoPrettyFactory = (options: Record<string, unknown>) => DestinationStream;

const requireForPinoPretty = createRequire(
  typeof __filename === 'string' ? __filename : import.meta.url
);

let cachedFactory: PinoPrettyFactory | null = null;

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

function resolvePinoPrettyFactory(moduleValue: unknown): PinoPrettyFactory | null {
  if (typeof moduleValue === 'function') {
    return moduleValue as PinoPrettyFactory;
  }

  if (!moduleValue || typeof moduleValue !== 'object') {
    return null;
  }

  const defaultExport = 'default' in moduleValue ? moduleValue.default : undefined;
  return typeof defaultExport === 'function'
    ? defaultExport as PinoPrettyFactory
    : null;
}

export function loadPinoPretty(): PinoPrettyFactory {
  if (cachedFactory) {
    return cachedFactory;
  }

  let loaded: unknown;
  try {
    loaded = requireForPinoPretty('pino-pretty');
  } catch (error) {
    if (isMissingModuleError(error)) {
      throw new Error(
        '[Blyp] Failed to initialize the pretty logger transport because pretty: true requires "pino-pretty" to be installed.',
        { cause: error instanceof Error ? error : undefined }
      );
    }

    throw new Error(
      '[Blyp] Failed to initialize the pretty logger transport with "pino-pretty".',
      { cause: error instanceof Error ? error : undefined }
    );
  }

  const factory = resolvePinoPrettyFactory(loaded);
  if (!factory) {
    throw new Error(
      '[Blyp] Failed to initialize the pretty logger transport because "pino-pretty" did not expose a callable factory.'
    );
  }

  cachedFactory = factory;
  return factory;
}

export type { PinoPrettyFactory };
