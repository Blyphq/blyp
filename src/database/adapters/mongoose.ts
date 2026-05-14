import type { DatabaseLogRow, MongooseDatabaseAdapterConfig } from '../../types/database';
import type { DatabaseRowWriter } from './prisma';

interface NativeCollection {
  insertMany: (docs: Record<string, unknown>[]) => Promise<unknown>;
  insertOne: (doc: Record<string, unknown>) => Promise<unknown>;
}

interface NativeDb {
  collection: (name: string) => NativeCollection;
}

interface MongooseConnectionLike {
  db?: NativeDb;
  readyState: number;
}

interface MongooseLike {
  connection: MongooseConnectionLike;
  connect: (uri: string) => Promise<unknown>;
}

function toMongoDocument(row: DatabaseLogRow): Record<string, unknown> {
  const { id, ...rest } = row;
  return { _id: id, ...rest };
}

export function createMongooseDatabaseAdapter(config: {
  mongoose?: unknown;
  mongoUrl?: string;
  connection?: unknown;
  collection?: string;
}): MongooseDatabaseAdapterConfig {
  return {
    type: 'mongoose',
    mongoose: config.mongoose,
    mongoUrl: config.mongoUrl,
    connection: config.connection,
    collection: config.collection ?? 'blyp_logs',
  };
}

export function createMongooseRowWriter(
  adapter: MongooseDatabaseAdapterConfig
): DatabaseRowWriter {
  const collectionName = adapter.collection ?? 'blyp_logs';

  let resolvedConnection: MongooseConnectionLike | null = null;
  let connectingPromise: Promise<void> | null = null;

  async function ensureConnection(): Promise<NativeCollection> {
    if (resolvedConnection && resolvedConnection.readyState === 1 && resolvedConnection.db) {
      return resolvedConnection.db.collection(collectionName);
    }

    if (adapter.connection) {
      const conn = adapter.connection as MongooseConnectionLike;
      if (!conn.db) {
        throw new Error(
          '[Blyp] Provided Mongoose connection has no db instance. Ensure the connection is open.'
        );
      }
      resolvedConnection = conn;
      return conn.db.collection(collectionName);
    }

    if (adapter.mongoose) {
      const mg = adapter.mongoose as MongooseLike;

      if (mg.connection.readyState !== 1 && adapter.mongoUrl) {
        if (!connectingPromise) {
          connectingPromise = (async () => {
            await mg.connect(adapter.mongoUrl!);
            resolvedConnection = mg.connection;
          })();
        }
        await connectingPromise;
      } else {
        resolvedConnection = mg.connection;
      }

      if (!resolvedConnection?.db) {
        throw new Error(
          '[Blyp] Mongoose connection has no db instance. Ensure mongoose is connected or provide a mongoUrl.'
        );
      }
      return resolvedConnection.db.collection(collectionName);
    }

    throw new Error(
      '[Blyp] Mongoose adapter requires either a mongoose instance or an existing connection.'
    );
  }

  return {
    async insert(rows: DatabaseLogRow[]): Promise<void> {
      if (rows.length === 0) {
        return;
      }

      const collection = await ensureConnection();
      const docs = rows.map(toMongoDocument);

      if (docs.length === 1) {
        await collection.insertOne(docs[0]!);
        return;
      }

      await collection.insertMany(docs);
    },
  };
}
