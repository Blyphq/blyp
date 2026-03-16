import type { DatabaseLogRow, DrizzleDatabaseAdapterConfig } from '../../types/database';
import type { DatabaseRowWriter } from './prisma';

interface DrizzleInsertBuilder {
  values: (rows: DatabaseLogRow | DatabaseLogRow[]) => Promise<unknown>;
}

interface DrizzleDatabaseLike {
  insert: (table: unknown) => DrizzleInsertBuilder;
}

export function createDrizzleDatabaseAdapter(config: {
  db: unknown;
  table: unknown;
}): DrizzleDatabaseAdapterConfig {
  return {
    type: 'drizzle',
    db: config.db,
    table: config.table,
  };
}

export function createDrizzleRowWriter(
  adapter: DrizzleDatabaseAdapterConfig
): DatabaseRowWriter {
  const db = adapter.db as DrizzleDatabaseLike;

  if (typeof db?.insert !== 'function' || adapter.table === undefined) {
    throw new Error(
      '[Blyp] Drizzle database adapter is missing a db.insert function or table reference.'
    );
  }

  return {
    async insert(rows: DatabaseLogRow[]): Promise<void> {
      if (rows.length === 0) {
        return;
      }

      await db.insert(adapter.table).values(rows);
    },
  };
}
