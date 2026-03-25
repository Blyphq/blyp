import { describe, expect, it } from 'bun:test';
import { computeConnectorRetryDelay } from '../src/connectors/delivery/backoff';

describe('Connector Backoff', () => {
  it('computes deterministic exponential backoff when jitter is disabled', () => {
    const config = {
      maxAttempts: 8,
      initialBackoffMs: 500,
      maxBackoffMs: 30_000,
      multiplier: 2,
      jitter: false,
    };

    expect(computeConnectorRetryDelay(1, config)).toBe(500);
    expect(computeConnectorRetryDelay(2, config)).toBe(1000);
    expect(computeConnectorRetryDelay(3, config)).toBe(2000);
    expect(computeConnectorRetryDelay(10, config)).toBe(30_000);
  });
});
