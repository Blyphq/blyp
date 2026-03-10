import type { ClientLogDeviceContext } from '../../shared/client-log';

interface ExpoNetworkSubscription {
  remove: () => void;
}

interface ExpoNetworkState {
  type?: unknown;
  isConnected?: unknown;
  isInternetReachable?: unknown;
}

interface ExpoNetworkModule {
  getNetworkStateAsync: () => Promise<ExpoNetworkState>;
  addNetworkStateListener?: (
    listener: (event: ExpoNetworkState) => void
  ) => ExpoNetworkSubscription;
}

type ExpoNetworkLoader = () => Promise<ExpoNetworkModule | null>;

let expoNetworkLoader: ExpoNetworkLoader = async () => {
  try {
    const module = await import('expo-network');
    if (typeof module.getNetworkStateAsync !== 'function') {
      return null;
    }

    return module as ExpoNetworkModule;
  } catch {
    return null;
  }
};

let expoNetworkModulePromise: Promise<ExpoNetworkModule | null> | undefined;
let lastKnownExpoNetworkState: ClientLogDeviceContext['network'] | undefined;

function normalizeNetworkState(
  state: ExpoNetworkState | undefined
): ClientLogDeviceContext['network'] | undefined {
  if (!state) {
    return undefined;
  }

  return {
    type: typeof state.type === 'string' ? state.type : undefined,
    isConnected: typeof state.isConnected === 'boolean' ? state.isConnected : undefined,
    isInternetReachable: typeof state.isInternetReachable === 'boolean'
      ? state.isInternetReachable
      : undefined,
  };
}

export function loadExpoNetworkModule(): Promise<ExpoNetworkModule | null> {
  if (!expoNetworkModulePromise) {
    expoNetworkModulePromise = expoNetworkLoader();
  }

  return expoNetworkModulePromise;
}

export async function getExpoNetworkSnapshot(): Promise<ClientLogDeviceContext['network'] | undefined> {
  const module = await loadExpoNetworkModule();
  if (!module) {
    return undefined;
  }

  try {
    const state = normalizeNetworkState(await module.getNetworkStateAsync());
    lastKnownExpoNetworkState = state;
    return state;
  } catch {
    return lastKnownExpoNetworkState;
  }
}

export function subscribeToExpoNetworkState(
  listener: (state: ClientLogDeviceContext['network'] | undefined) => void
): () => void {
  let isActive = true;
  let subscription: ExpoNetworkSubscription | undefined;

  void loadExpoNetworkModule().then((module) => {
    if (!isActive || !module || typeof module.addNetworkStateListener !== 'function') {
      return;
    }

    subscription = module.addNetworkStateListener((event) => {
      const state = normalizeNetworkState(event);
      lastKnownExpoNetworkState = state;
      listener(state);
    });
  });

  return () => {
    isActive = false;
    subscription?.remove();
  };
}

export function setExpoNetworkLoaderForTests(loader: ExpoNetworkLoader): void {
  expoNetworkLoader = loader;
  resetExpoNetworkStateForTests();
}

export function resetExpoNetworkStateForTests(): void {
  expoNetworkModulePromise = undefined;
  lastKnownExpoNetworkState = undefined;
}
