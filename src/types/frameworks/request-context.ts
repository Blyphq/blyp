import type { BlypLogger } from '../core/logger';

export interface BlypRequestContextStore {
  requestScopedLoggerActive: boolean;
  structuredCollectorActive: boolean;
  structuredLogEmitted: boolean;
  mixedLoggerWarningShown: boolean;
  activeLogger?: BlypLogger;
}
