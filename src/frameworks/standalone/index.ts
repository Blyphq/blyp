export {
  configureDefaultStandaloneLogger,
  createStandaloneLogger,
  logger,
} from './logger';
export type { StandaloneLogger } from './logger';
export * from '../../types/frameworks/standalone';

export { createErrorCaptureRegistry } from '../../core/error-capture-registry';
export type { FlushOptions, ConnectorFlushResult, TelemetryFlushResult } from '../../connectors/flush';
export type { ExceptionContext, SerializedException } from '../../connectors/exception';
