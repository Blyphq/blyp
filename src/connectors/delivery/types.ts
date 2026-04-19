import type { LogRecord } from '../../core/file-logger';

export const CONNECTOR_BATCH_DISPATCH = Symbol('blyp.connector.batch-dispatch');
export const CONNECTOR_DELIVERY_BINDER = Symbol('blyp.connector.delivery-binder');

export type QueuedConnectorType =
  | 'betterstack'
  | 'databuddy'
  | 'http'
  | 'posthog'
  | 'sentry'
  | 'otlp';

export interface ConnectorDispatchContext {
  source: 'server';
  target?: string;
}

export interface ConnectorDispatchSuccess {
  ok: true;
}

export interface ConnectorDispatchFailure {
  ok: false;
  retryable: boolean;
  status?: number;
  error?: string;
}

export type ConnectorDispatchResult =
  | ConnectorDispatchSuccess
  | ConnectorDispatchFailure;

export interface ConnectorBatchDispatcher {
  dispatchKey: string;
  dispatch(records: LogRecord[], context: ConnectorDispatchContext): Promise<ConnectorDispatchResult>;
}

export interface ConnectorDeliveryJob {
  id: string;
  connectorType: QueuedConnectorType;
  connectorTarget?: string;
  source: 'server';
  record: LogRecord;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: number;
  createdAt: number;
  dispatchKey: string;
  dispatcher: ConnectorBatchDispatcher;
}

export interface SerializedConnectorJobEnvelope {
  jobId: string;
  connectorType: QueuedConnectorType;
  connectorTarget?: string;
  source: 'server';
  record: LogRecord;
  createdAt: number;
}

export interface DurableConnectorJobRecord {
  id: string;
  connectorType: QueuedConnectorType;
  connectorTarget?: string;
  operation: 'send';
  payloadJson: string;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: number;
  state: 'pending' | 'claimed';
  lastError?: string;
  createdAt: number;
  updatedAt: number;
  claimedAt?: number;
}

export interface DurableQueueRescheduleInput {
  id: string;
  attemptCount: number;
  nextAttemptAt: number;
  lastError?: string;
}

export interface DurableConnectorDeadLetterRecord {
  id: string;
  connectorType: QueuedConnectorType;
  connectorTarget?: string;
  operation: 'send';
  payloadJson: string;
  attemptCount: number;
  maxAttempts: number;
  lastError?: string;
  firstEnqueuedAt: number;
  deadLetteredAt: number;
  lastAttemptAt: number;
}

export interface ConnectorDeliveryStatusRecord {
  connectorType: QueuedConnectorType;
  connectorTarget?: string;
  pendingCount: number;
  deadLetterCount: number;
  lastSuccessAt?: number;
  lastFailureAt?: number;
  lastError?: string;
  updatedAt?: number;
}

export interface DeadLetterListResult {
  items: DurableConnectorDeadLetterRecord[];
  total: number;
}

export interface ConnectorDeliveryBinder {
  enqueue(
    connectorType: QueuedConnectorType,
    record: LogRecord,
    dispatcher: ConnectorBatchDispatcher,
    target?: string
  ): void;
}

export type ConnectorBatchDispatchTarget = {
  [CONNECTOR_BATCH_DISPATCH]?: ConnectorBatchDispatcher;
  [CONNECTOR_DELIVERY_BINDER]?: (binder: ConnectorDeliveryBinder | null) => void;
};
