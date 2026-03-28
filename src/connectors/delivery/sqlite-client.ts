import { Worker } from 'node:worker_threads';
import { buildSQLiteWorkerSource } from './sqlite-worker';
import type {
  ConnectorDeliveryStatusRecord,
  DeadLetterListResult,
  DurableConnectorDeadLetterRecord,
  DurableConnectorJobRecord,
  DurableQueueRescheduleInput,
} from './types';

type SQLiteWorkerResponse = {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: string;
};

export class SQLiteWorkerClient {
  private readonly worker: Worker;

  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  private nextId = 1;

  constructor(private readonly path: string) {
    this.worker = new Worker(buildSQLiteWorkerSource(), { eval: true });
    this.worker.on('message', (message: SQLiteWorkerResponse) => {
      const entry = this.pending.get(message.id);
      if (!entry) {
        return;
      }

      this.pending.delete(message.id);

      if (message.ok) {
        entry.resolve(message.result);
        return;
      }

      entry.reject(new Error(message.error ?? 'SQLite worker request failed.'));
    });

    this.worker.on('error', (error) => {
      for (const entry of this.pending.values()) {
        entry.reject(error instanceof Error ? error : new Error(String(error)));
      }
      this.pending.clear();
    });
  }

  private request<TResult>(type: string, payload: Record<string, unknown> = {}): Promise<TResult> {
    const id = this.nextId++;

    return new Promise<TResult>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.worker.postMessage({ id, type, payload });
    });
  }

  async init(): Promise<void> {
    await this.request('init', { path: this.path });
  }

  async insert(jobs: DurableConnectorJobRecord[]): Promise<void> {
    await this.request('insert', { jobs });
  }

  async claimDue(limit: number, now: number): Promise<DurableConnectorJobRecord[]> {
    return this.request('claimDue', { limit, now });
  }

  async ack(ids: string[]): Promise<void> {
    await this.request('ack', { ids });
  }

  async reschedule(items: DurableQueueRescheduleInput[], now: number): Promise<void> {
    await this.request('reschedule', { items, now });
  }

  async deadLetter(items: DurableConnectorDeadLetterRecord[]): Promise<void> {
    await this.request('deadLetter', { items });
  }

  async markSuccess(items: Array<{ connectorType: string; connectorTarget?: string; timestamp: number }>): Promise<void> {
    await this.request('markSuccess', { items });
  }

  async markFailure(
    items: Array<{ connectorType: string; connectorTarget?: string; timestamp: number; lastError?: string }>
  ): Promise<void> {
    await this.request('markFailure', { items });
  }

  async getStatusSummary(): Promise<ConnectorDeliveryStatusRecord[]> {
    return this.request('getStatusSummary');
  }

  async listDeadLetters(input: {
    limit: number;
    offset: number;
    connectorType?: string;
    connectorTarget?: string;
  }): Promise<DeadLetterListResult> {
    return this.request('listDeadLetters', input);
  }

  async retryDeadLetters(ids: string[], now: number): Promise<number> {
    return this.request('retryDeadLetters', { ids, now });
  }

  async clearDeadLetters(ids: string[]): Promise<number> {
    return this.request('clearDeadLetters', { ids });
  }

  async count(): Promise<number> {
    return this.request('count');
  }

  async shutdown(): Promise<void> {
    try {
      await this.request('shutdown');
    } finally {
      await this.worker.terminate();
    }
  }
}
