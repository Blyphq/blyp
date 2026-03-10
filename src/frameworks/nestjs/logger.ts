import type { ResolvedServerLogger } from '../shared';
import { resolveServerLogger } from '../shared';
import {
  configureDefaultStandaloneLogger,
  type StandaloneLogger,
} from '../standalone/logger';
import type { StandaloneLoggerConfig } from '../../types/frameworks/standalone';
import { BLYP_NEST_LOGGER_INIT_ERROR } from './constants';
import type {
  NestLoggerConfig,
  NestLoggerContext,
} from '../../types/frameworks/nestjs';

export interface NestLoggerState
  extends Omit<ResolvedServerLogger<NestLoggerContext>, 'logger'> {
  logger: StandaloneLogger;
}

let nestLoggerState: NestLoggerState | null = null;

function toStandaloneLoggerConfig(
  config: NestLoggerConfig
): StandaloneLoggerConfig {
  const clientLogging = config.clientLogging === undefined
    ? undefined
    : config.clientLogging === false
      ? { enabled: false }
      : config.clientLogging === true
        ? { enabled: true }
        : {
            enabled: true,
            path: config.clientLogging.path,
          };

  return {
    ...(config.level !== undefined ? { level: config.level } : {}),
    ...(config.pretty !== undefined ? { pretty: config.pretty } : {}),
    ...(config.logDir !== undefined ? { logDir: config.logDir } : {}),
    ...(config.file !== undefined ? { file: config.file } : {}),
    ...(clientLogging !== undefined ? { clientLogging } : {}),
  };
}

export function createNestLogger(
  config: NestLoggerConfig = {}
): StandaloneLogger {
  const logger = configureDefaultStandaloneLogger(toStandaloneLoggerConfig(config));
  const shared = resolveServerLogger(config, logger);

  nestLoggerState = {
    ...shared,
    logger,
  };

  return logger;
}

export const createLogger = createNestLogger;

export function getNestLoggerStateOrThrow(): NestLoggerState {
  if (!nestLoggerState) {
    throw new Error(BLYP_NEST_LOGGER_INIT_ERROR);
  }

  return nestLoggerState;
}

export function resetNestLoggerState(): void {
  nestLoggerState = null;
  configureDefaultStandaloneLogger();
}
