import type { BetterAuthClientPlugin } from 'better-auth';
import { createClientLogger } from '../frameworks/client';
import type {
  BetterAuthClientLoggerFactoryConfig,
  BlypBetterAuthClientPluginOptions,
} from '../types/better-auth';

const DEFAULT_BETTER_AUTH_CLIENT_LOG_PATH = '/blyp/log';

function resolveClientLogPath(path: string | undefined): string {
  if (!path) {
    return DEFAULT_BETTER_AUTH_CLIENT_LOG_PATH;
  }

  return path.startsWith('/') ? path : `/${path}`;
}

export function blypClient(
  options: BlypBetterAuthClientPluginOptions = {}
): BetterAuthClientPlugin {
  const endpoint = resolveClientLogPath(options.endpoint);

  return {
    id: 'blyp-client',
    getActions($fetch) {
      return {
        blyp: {
          createLogger(config: BetterAuthClientLoggerFactoryConfig = {}) {
            return createClientLogger({
              traceId: config.traceId,
              localConsole: config.localConsole,
              remoteSync: config.remoteSync,
              metadata: config.metadata,
              delivery: config.delivery,
              connector: config.connector,
              endpoint,
              transport: async (payload) => {
                try {
                  const result = await $fetch(endpoint, {
                    method: 'POST',
                    body: payload,
                    headers: {
                      'content-type': 'application/json',
                    },
                  });

                  if (result && typeof result === 'object' && 'error' in result && result.error) {
                    const error = result.error as {
                      status?: number;
                      statusText?: string;
                      message?: string;
                    };

                    return {
                      outcome:
                        error.status === 429 || (typeof error.status === 'number' && error.status >= 500)
                          ? 'retry'
                          : 'failure',
                      reason: 'response_status',
                      ...(typeof error.status === 'number' ? { status: error.status } : {}),
                      ...(typeof error.message === 'string' ? { error: error.message } : {}),
                    };
                  }

                  return {
                    outcome: 'success',
                    transport: 'fetch',
                    status: 204,
                  };
                } catch (error) {
                  return {
                    outcome: 'retry',
                    reason: 'network_error',
                    error: error instanceof Error ? error.message : String(error),
                  };
                }
              },
            });
          },
        },
      };
    },
  };
}
