/** Application-owned coordination by object identity, never by message text. */
export function createErrorCaptureRegistry(options: { ttlMs?: number } = {}) {
  const ttlMs = options.ttlMs ?? 60_000;
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new RangeError('ttlMs must be positive and finite');
  type State = { status: 'pending' | 'delivered'; expires: number };
  const objects = new WeakMap<object, Map<string, State>>();
  const current = (error: object, destination: string) => {
    const states = objects.get(error);
    const state = states?.get(destination);
    if (state && state.expires <= Date.now()) { states?.delete(destination); return undefined; }
    return state;
  };
  return {
    /** undefined means this exact object already has a live claim at this destination. */
    claim(error: object, destination: 'posthog' | 'sentry') {
      if (current(error, destination)) return undefined;
      const states = objects.get(error) ?? new Map<string, State>();
      const state: State = { status: 'pending', expires: Date.now() + ttlMs };
      states.set(destination, state);
      objects.set(error, states);
      return {
        /** Only mark delivered after a successful connector barrier. Failure releases ownership. */
        settle(status: 'delivered' | 'failed' | 'timed_out') {
          if (states.get(destination) !== state) return;
          if (status === 'delivered') state.status = 'delivered';
          else states.delete(destination);
        },
      };
    },
    shouldSuppress(error: object, destination: 'posthog' | 'sentry', options: { includePending?: boolean } = {}) {
      const state = current(error, destination);
      return state?.status === 'delivered' || (options.includePending === true && state?.status === 'pending');
    },
  };
}
