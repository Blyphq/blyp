import type { BlypLogger } from '../core/logger';
import type { BetterAuthLogContext } from '../better-auth';
import type { WorkOsLogContext } from '../workos';

export type AuthLogContext = BetterAuthLogContext | WorkOsLogContext;

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
