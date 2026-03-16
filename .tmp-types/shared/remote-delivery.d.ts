import type { ClientLogEvent } from '../types/shared/client-log';
import type { RemoteDeliveryManagerOptions } from '../types/shared/remote-delivery';
export type { DeliveryAttemptFailure, DeliveryAttemptResult, DeliveryAttemptRetry, DeliveryAttemptSuccess } from '../types/shared/remote-delivery';
export declare function createRemoteDeliveryManager(options: RemoteDeliveryManagerOptions): {
    enqueue: (event: ClientLogEvent) => void;
};
