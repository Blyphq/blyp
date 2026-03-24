import type { BlypLogger } from '../../core/logger';
import type {
  HttpRequestLog,
} from './shared';
import type {
  NitroClientLogIngestionConfig as NuxtClientLogIngestionConfig,
  NitroEventHandler as NuxtEventHandler,
  NitroEventLike as NuxtEventLike,
  NitroLoggerConfig as BaseNuxtLoggerConfig,
  NitroLoggerPlugin as NuxtLoggerPlugin,
  NitroLoggerContext,
} from './nitro';

export interface NuxtLoggerConfig extends BaseNuxtLoggerConfig {}

export interface NuxtLoggerFactory {
  logger: BlypLogger;
  serverPlugin: NuxtLoggerPlugin;
  clientLogHandler: NuxtEventHandler;
  getLogger: (event: NuxtEventLike) => BlypLogger;
}

export type {
  HttpRequestLog,
  NitroLoggerContext as NuxtLoggerContext,
  NuxtClientLogIngestionConfig,
  NuxtEventHandler,
  NuxtEventLike,
  NuxtLoggerPlugin,
};
