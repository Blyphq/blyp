import type {
  ClientLogEvent,
  RemoteDeliveryConfig,
  RemoteDeliveryFailureReason,
  RemoteDeliveryRuntime,
  RemoteDeliveryTransport,
} from './client-log';

export type RetryReason = 'offline' | 'network_error' | 'response_status';

export interface QueueItem {
  event: ClientLogEvent;
  attempt: number;
  nextAttemptAt: number;
}

export interface DeliveryAttemptSuccess {
  outcome: 'success';
  transport: RemoteDeliveryTransport;
  status?: number;
}

export interface DeliveryAttemptRetry {
  outcome: 'retry';
  reason: RetryReason;
  status?: number;
  error?: string;
}

export interface DeliveryAttemptFailure {
  outcome: 'failure';
  reason: Exclude<RemoteDeliveryFailureReason, 'queue_overflow'>;
  status?: number;
  error?: string;
  suppressWarning?: boolean;
}

export type DeliveryAttemptResult =
  | DeliveryAttemptSuccess
  | DeliveryAttemptRetry
  | DeliveryAttemptFailure;

export interface RemoteDeliveryManagerOptions {
  runtime: RemoteDeliveryRuntime;
  delivery?: RemoteDeliveryConfig;
  send: (event: ClientLogEvent) => Promise<DeliveryAttemptResult>;
  subscribeToResume?: (resume: () => void) => (() => void) | void;
}
