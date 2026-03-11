import { AsyncLocalStorage } from 'async_hooks';
import type { BlypLogger } from '../../core/logger';

export interface BlypRequestContextStore {
  requestScopedLoggerActive: boolean;
  structuredCollectorActive: boolean;
  structuredLogEmitted: boolean;
  mixedLoggerWarningShown: boolean;
  activeLogger?: BlypLogger;
}

const requestContextStorage = new AsyncLocalStorage<BlypRequestContextStore>();

function createStore(): BlypRequestContextStore {
  return {
    requestScopedLoggerActive: true,
    structuredCollectorActive: false,
    structuredLogEmitted: false,
    mixedLoggerWarningShown: false,
  };
}

export function runWithRequestContext<T>(callback: () => T): T {
  return requestContextStorage.run(createStore(), callback);
}

export function enterRequestContext(): BlypRequestContextStore {
  const store = createStore();
  requestContextStorage.enterWith(store);
  return store;
}

export function getRequestContextStore(): BlypRequestContextStore | undefined {
  return requestContextStorage.getStore();
}

export function setActiveRequestLogger(logger: BlypLogger): void {
  const store = getRequestContextStore();
  if (store) {
    store.activeLogger = logger;
  }
}

export function getActiveRequestLogger(): BlypLogger | undefined {
  return getRequestContextStore()?.activeLogger;
}

export function markStructuredCollectorActive(): void {
  const store = getRequestContextStore();
  if (store) {
    store.structuredCollectorActive = true;
  }
}

export function markStructuredLogEmitted(): void {
  const store = getRequestContextStore();
  if (store) {
    store.structuredLogEmitted = true;
  }
}

export function hasStructuredLogBeenEmitted(): boolean {
  return getRequestContextStore()?.structuredLogEmitted === true;
}

export function shouldDropRootLogWrite(): boolean {
  const store = getRequestContextStore();
  if (!store || !store.requestScopedLoggerActive || !store.structuredCollectorActive) {
    return false;
  }

  if (!store.mixedLoggerWarningShown) {
    store.mixedLoggerWarningShown = true;
    console.warn(
      '[Blyp] Warning: Mixed logger usage detected for this request. ' +
      'The root logger call was ignored because a request-scoped structured logger is active.'
    );
  }

  return true;
}
