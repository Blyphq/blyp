import type { ClientLogDeviceContext } from '../../shared/client-log';
import type { ExpoNetworkLoader, ExpoNetworkModule } from '../../types/frameworks/expo';
export declare function loadExpoNetworkModule(): Promise<ExpoNetworkModule | null>;
export declare function getExpoNetworkSnapshot(): Promise<ClientLogDeviceContext['network'] | undefined>;
export declare function subscribeToExpoNetworkState(listener: (state: ClientLogDeviceContext['network'] | undefined) => void): () => void;
export declare function setExpoNetworkLoaderForTests(loader: ExpoNetworkLoader): void;
export declare function resetExpoNetworkStateForTests(): void;
