import type {
  NitroEventLike,
} from '../../types/frameworks/nitro';
import type {
  NuxtLoggerConfig,
  NuxtLoggerFactory,
} from '../../types/frameworks/nuxt';
import { createNitroLoggerFactory } from '../nitro/logger';
import { resolveServerLogger } from '../shared';

export function createNuxtLogger(
  config: NuxtLoggerConfig = {}
): NuxtLoggerFactory {
  const nitro = createNitroLoggerFactory(resolveServerLogger(config));

  return {
    logger: nitro.logger,
    serverPlugin: nitro.plugin,
    clientLogHandler: nitro.clientLogHandler,
    getLogger: (event: NitroEventLike) => nitro.getLogger(event),
  };
}

export const createLogger = createNuxtLogger;
