import type { BlypLogger } from '../core/logger';
import type { AuthLogContext } from '../auth';

export interface BlypRequestContextStore {
  requestScopedLoggerActive: boolean;
  structuredCollectorActive: boolean;
  structuredLogEmitted: boolean;
  mixedLoggerWarningShown: boolean;
  activeLogger?: BlypLogger;
  traceId?: string;
  auth?: AuthLogContext | null;
  authResolved?: boolean;
}
