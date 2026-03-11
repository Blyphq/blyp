import {
  attachLoggerInternals,
  createLoggerWithSource,
  createStructuredLogForLogger,
  type BlypLogger,
} from '../../core/logger';
import type { StructuredLog } from '../../core/structured-log';
import {
  markStructuredCollectorActive,
  markStructuredLogEmitted,
  setActiveRequestLogger,
} from './request-context';
import type { RequestScopedLoggerOptions } from '../../types/frameworks/request-logger';

export type { RequestScopedLoggerOptions } from '../../types/frameworks/request-logger';

export function createRequestScopedLogger(
  logger: BlypLogger,
  options: RequestScopedLoggerOptions = {}
): BlypLogger {
  const scopedLogger = createLoggerWithSource(logger, 'request-scoped');
  const requestScopedLogger = attachLoggerInternals({
    ...scopedLogger,
    createStructuredLog: (
      groupId: string,
      initial?: Record<string, unknown>
    ): StructuredLog => {
      return createStructuredLogForLogger(requestScopedLogger, groupId, {
        initialFields: initial,
        resolveDefaultFields: options.resolveStructuredFields,
        onCreate: () => {
          markStructuredCollectorActive();
        },
        onEmit: () => {
          markStructuredLogEmitted();
          options.onStructuredEmit?.();
        },
      });
    },
    child(bindings) {
      return createRequestScopedLogger(scopedLogger.child(bindings), options);
    },
  }, scopedLogger);

  setActiveRequestLogger(requestScopedLogger);
  return requestScopedLogger;
}
