import type { DatabaseLogRow, PrismaDatabaseAdapterConfig } from '../../types/database';

interface PrismaDelegate {
  create: (args: { data: DatabaseLogRow }) => Promise<unknown>;
  createMany?: (args: { data: DatabaseLogRow[] }) => Promise<unknown>;
}

interface PrismaClientLike {
  $transaction?: (operations: Array<Promise<unknown>>) => Promise<unknown>;
  [key: string]: unknown;
}

export interface DatabaseRowWriter {
  insert: (rows: DatabaseLogRow[]) => Promise<void>;
}

function shouldFallbackFromCreateMany(error: unknown): boolean {
  const message = String(error ?? '');

  return (
    message.includes('createMany') ||
    message.includes('Unknown argument') ||
    message.includes('not supported') ||
    message.includes('is not a function')
  );
}

export function createPrismaDatabaseAdapter(config: {
  client: unknown;
  model?: string;
}): PrismaDatabaseAdapterConfig {
  return {
    type: 'prisma',
    client: config.client,
    model: config.model ?? 'blypLog',
  };
}

export function createPrismaRowWriter(
  adapter: PrismaDatabaseAdapterConfig
): DatabaseRowWriter {
  const client = adapter.client as PrismaClientLike;
  const model = adapter.model ?? 'blypLog';
  const delegateCandidate = client[model] as PrismaDelegate | undefined;

  if (!delegateCandidate || typeof delegateCandidate.create !== 'function') {
    throw new Error(
      `[Blyp] Prisma database adapter is missing the "${model}" delegate or its create method.`
    );
  }

  const delegate: PrismaDelegate = delegateCandidate;

  let useCreateMany = typeof delegate.createMany === 'function';

  async function fallbackInsert(rows: DatabaseLogRow[]): Promise<void> {
    if (typeof client.$transaction === 'function') {
      await client.$transaction(
        rows.map((row) => delegate.create({ data: row }))
      );
      return;
    }

    for (const row of rows) {
      await delegate.create({ data: row });
    }
  }

  return {
    async insert(rows: DatabaseLogRow[]): Promise<void> {
      if (rows.length === 0) {
        return;
      }

      if (rows.length === 1) {
        await delegate.create({ data: rows[0]! });
        return;
      }

      if (!useCreateMany || typeof delegate.createMany !== 'function') {
        await fallbackInsert(rows);
        return;
      }

      try {
        await delegate.createMany({ data: rows });
      } catch (error) {
        if (!shouldFallbackFromCreateMany(error)) {
          throw error;
        }

        useCreateMany = false;
        await fallbackInsert(rows);
      }
    },
  };
}
