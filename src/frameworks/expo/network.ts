import type { ClientLogDeviceContext } from '../../shared/client-log';

interface ExpoNetworkModule {
  getNetworkStateAsync: () => Promise<{
    type?: unknown;
    isConnected?: unknown;
    isInternetReachable?: unknown;
  }>;
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
let expoNetworkSnapshotPromise: Promise<ClientLogDeviceContext['network'] | undefined> | undefined;

export function loadExpoNetworkModule(): Promise<ExpoNetworkModule | null> {
  if (!expoNetworkModulePromise) {
    expoNetworkModulePromise = expoNetworkLoader();
  }

  return expoNetworkModulePromise;
}

export function getExpoNetworkSnapshot(): Promise<ClientLogDeviceContext['network'] | undefined> {
  if (!expoNetworkSnapshotPromise) {
    expoNetworkSnapshotPromise = loadExpoNetworkModule()
      .then(async (module) => {
        if (!module) {
          return undefined;
        }

        try {
          const state = await module.getNetworkStateAsync();

          return {
            type: typeof state.type === 'string' ? state.type : undefined,
            isConnected: typeof state.isConnected === 'boolean' ? state.isConnected : undefined,
            isInternetReachable: typeof state.isInternetReachable === 'boolean'
              ? state.isInternetReachable
              : undefined,
          };
        } catch {
          return undefined;
        }
      });
  }

  return expoNetworkSnapshotPromise;
}

export function setExpoNetworkLoaderForTests(loader: ExpoNetworkLoader): void {
  expoNetworkLoader = loader;
  resetExpoNetworkStateForTests();
}

export function resetExpoNetworkStateForTests(): void {
  expoNetworkModulePromise = undefined;
  expoNetworkSnapshotPromise = undefined;
}
