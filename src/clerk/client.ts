import { createClientLogger } from '../frameworks/client';
import type { ClerkClientLoggerOptions } from '../types/clerk';

const DEFAULT_CLERK_CLIENT_ENDPOINT = '/blyp/log';

export function createClerkClientLogger(
  options: ClerkClientLoggerOptions = {}
) {
  return createClientLogger({
    endpoint: options.endpoint ?? DEFAULT_CLERK_CLIENT_ENDPOINT,
    traceId: options.traceId,
    localConsole: options.localConsole,
    remoteSync: options.remoteSync,
    connector: options.connector,
    metadata: options.metadata,
    delivery: options.delivery,
  });
}
