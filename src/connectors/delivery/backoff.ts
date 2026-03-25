import type { ResolvedConnectorRetryConfig } from '../../types/core/config';

export function computeConnectorRetryDelay(
  attempt: number,
  config: ResolvedConnectorRetryConfig
): number {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  const factor = Math.pow(config.multiplier, safeAttempt - 1);
  const capped = Math.min(
    Math.max(0, Math.floor(config.initialBackoffMs * factor)),
    Math.max(0, config.maxBackoffMs)
  );

  if (!config.jitter) {
    return capped;
  }

  return Math.floor(Math.random() * (capped + 1));
}
