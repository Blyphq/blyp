export interface FlushOptions { timeoutMs?: number }
export interface ConnectorFlushResult {
  status: 'delivered' | 'failed' | 'timed_out';
  pending: number;
  error?: string;
}
export interface TelemetryFlushResult {
  status: 'delivered' | 'failed' | 'timed_out';
  destinations: Record<string, ConnectorFlushResult>;
}

/** Bounds the wait; settlement handlers stay attached after timeout. */
export async function boundedFlush(
  work: () => Promise<void>, options: FlushOptions = {}, pending: () => number = () => 0
): Promise<ConnectorFlushResult> {
  const timeoutMs = options.timeoutMs ?? 5000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) throw new RangeError('timeoutMs must be finite and non-negative');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(work).then(
        (): ConnectorFlushResult => ({ status: 'delivered', pending: 0 }),
        (error): ConnectorFlushResult => ({ status: 'failed', pending: pending(), error: String(error) })
      ),
      new Promise<ConnectorFlushResult>((resolve) => {
        timer = setTimeout(() => resolve({ status: 'timed_out', pending: Math.max(1, pending()) }), timeoutMs);
      }),
    ]);
  } finally { clearTimeout(timer); }
}
