import type { BlypLogger } from '../core/logger';
import type { BetterAuthLogContext } from '../better-auth';

export interface BlypRequestContextStore {
  requestScopedLoggerActive: boolean;
  structuredCollectorActive: boolean;
  structuredLogEmitted: boolean;
  mixedLoggerWarningShown: boolean;
  activeLogger?: BlypLogger;
  traceId?: string;
  auth?: BetterAuthLogContext | null;
  authResolved?: boolean;
}
