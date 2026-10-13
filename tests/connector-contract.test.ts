import { afterEach, describe, expect, it } from 'bun:test';
import { createPostHogSender, resetPostHogTestHooks, setPostHogTestHooks } from '../src/connectors/posthog/sender';
import { restoreException, recordException } from '../src/connectors/exception';
import { createErrorCaptureRegistry } from '../src/core/error-capture-registry';
import { normalizeLogValue } from '../src/shared/log-value';
import { boundedFlush } from '../src/connectors/flush';

afterEach(resetPostHogTestHooks);
const deferred = () => {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const config = { enabled: true, projectKey: 'local-test', errorTracking: { enableExceptionAutocapture: false } };
describe('connector delivery contracts', () => {
  it('snapshots exceptions at flush entry, accounts for SDK buffers, and allows simultaneous barriers', async () => {
    const first = deferred(); const later = deferred(); const sdk = deferred();
    let captures = 0;
    setPostHogTestHooks({ createTransport: () => ({ emit() {}, flush: async () => {} }),
      createExceptionClient: () => ({ captureException: () => ++captures === 1 ? first.promise : later.promise, flush: () => sdk.promise }) });
    const sender = createPostHogSender(config);
    sender.captureException(new Error('first'));
    let complete = false;
    const one = sender.flush().then(result => { complete = true; return result; });
    const two = sender.flush();
    sender.captureException(new Error('later'));
    await Promise.resolve(); expect(complete).toBe(false);
    first.resolve(); await Promise.resolve(); expect(complete).toBe(false);
    sdk.resolve();
    expect((await one)?.status).toBe('delivered'); expect((await two)?.status).toBe('delivered');
    later.resolve(); expect((await sender.flush())?.status).toBe('delivered');
  });
  it('returns timeout while pending, handles late rejection and preserves failure in later barriers', async () => {
    const capture = deferred();
    setPostHogTestHooks({ createTransport: () => ({ emit() {} }), createExceptionClient: () => ({ captureException: () => capture.promise }) });
    const sender = createPostHogSender(config);
    sender.captureException(new Error('timeout'));
    expect((await sender.flush({ timeoutMs: 5 }))?.status).toBe('timed_out');
    expect((await sender.shutdown?.({ timeoutMs: 5 }))?.status).toBe('timed_out');
    capture.reject(new Error('failed'));
    expect((await sender.flush())?.status).toBe('failed');
  });
  it('includes asynchronous emit promises and synchronous capture failures', async () => {
    const emit = deferred();
    setPostHogTestHooks({ createTransport: () => ({ emit: () => emit.promise }), createExceptionClient: () => ({ captureException() { throw new Error('sync failure'); } }) });
    const sender = createPostHogSender(config);
    sender.send({ timestamp: '', level: 'info', message: 'ordinary' });
    expect((await sender.flush({ timeoutMs: 5 }))?.status).toBe('timed_out');
    emit.resolve(); sender.captureException(new Error('fail'));
    expect((await sender.flush())?.status).toBe('failed');
  });
  it('bounds resource shutdown as well as the flush barrier', async () => {
    const close = deferred();
    setPostHogTestHooks({ createTransport: () => ({ emit() {}, shutdown: () => close.promise }) });
    const sender = createPostHogSender({ ...config, errorTracking: { enabled: false } });
    expect((await sender.shutdown?.({ timeoutMs: 5 }))?.status).toBe('timed_out');
    close.resolve();
  });
  it('restores transported stacks and nested causes without a synthetic connector stack', () => {
    const error = new Error('outer', { cause: new TypeError('inner') });
    const native = normalizeLogValue(error);
    const restored = restoreException(native)!;
    expect(restored.name).toBe(error.name); expect(restored.message).toBe(error.message); expect(restored.stack).toBe(error.stack);
    expect((restored.cause as Error).stack).toBe((error.cause as Error).stack);
    expect(restoreException({ message: 'no stack' })?.stack).toBeUndefined();
    expect(recordException({ timestamp: '', level: 'warning', message: 'ordinary', data: { message: 'metadata' } })).toBeUndefined();
    const cyclic = new Error('cycle'); cyclic.cause = cyclic;
    expect((normalizeLogValue(cyclic) as any).cause).toBe('[Circular]');
  });
  it('coordinates exact objects per destination, releases failures and expires bounded weak claims', async () => {
    const registry = createErrorCaptureRegistry({ ttlMs: 10 });
    const first = new Error('same'); const second = new Error('same');
    const receipt = registry.claim(first, 'sentry')!;
    expect(registry.claim(first, 'sentry')).toBeUndefined();
    expect(registry.claim(second, 'sentry')).toBeDefined();
    expect(registry.claim(first, 'posthog')).toBeDefined();
    expect(registry.shouldSuppress(first, 'sentry')).toBe(false);
    expect(registry.shouldSuppress(first, 'sentry', { includePending: true })).toBe(true);
    receipt.settle('failed'); expect(registry.shouldSuppress(first, 'sentry', { includePending: true })).toBe(false);
    registry.claim(first, 'sentry')!.settle('delivered'); expect(registry.shouldSuppress(first, 'sentry')).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 15)); expect(registry.shouldSuppress(first, 'sentry')).toBe(false);
  });
  it('rejects invalid timeout values', async () => {
    await expect(boundedFlush(async () => {}, { timeoutMs: -1 })).rejects.toThrow(RangeError);
  });
});
