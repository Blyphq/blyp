import fs from 'node:fs';
import type {
  ConnectorDeliveryStatusRecord,
  DeadLetterListResult,
} from './types';
import { getDefaultConnectorQueuePath } from './queue-path';
import { SQLiteWorkerClient } from './sqlite-client';

async function withClient<TResult>(
  callback: (client: SQLiteWorkerClient) => Promise<TResult>,
  queuePath = getDefaultConnectorQueuePath()
): Promise<TResult> {
  const client = new SQLiteWorkerClient(queuePath);

  try {
    await client.init();
    return await callback(client);
  } finally {
    await client.shutdown().catch(() => {});
  }
}

export function getConnectorQueuePath(): string {
  return getDefaultConnectorQueuePath();
}

export function connectorQueueExists(queuePath = getDefaultConnectorQueuePath()): boolean {
  return fs.existsSync(queuePath);
}

export async function getConnectorDeliveryStatusSummary(
  queuePath = getDefaultConnectorQueuePath()
): Promise<ConnectorDeliveryStatusRecord[]> {
  return withClient((client) => client.getStatusSummary(), queuePath);
}

export async function listConnectorDeadLetters(
  input: {
    limit?: number;
    offset?: number;
    connectorType?: string;
    connectorTarget?: string;
  } = {},
  queuePath = getDefaultConnectorQueuePath()
): Promise<DeadLetterListResult> {
  return withClient(
    (client) =>
      client.listDeadLetters({
        limit: input.limit ?? 100,
        offset: input.offset ?? 0,
        connectorType: input.connectorType,
        connectorTarget: input.connectorTarget,
      }),
    queuePath
  );
}

export async function retryConnectorDeadLetters(
  ids: string[],
  queuePath = getDefaultConnectorQueuePath()
): Promise<number> {
  return withClient((client) => client.retryDeadLetters(ids, Date.now()), queuePath);
}

export async function clearConnectorDeadLetters(
  ids: string[],
  queuePath = getDefaultConnectorQueuePath()
): Promise<number> {
  return withClient((client) => client.clearDeadLetters(ids), queuePath);
}
