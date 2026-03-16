import type { DatabaseLogRow, PrismaDatabaseAdapterConfig } from '../../types/database';
export interface DatabaseRowWriter {
    insert: (rows: DatabaseLogRow[]) => Promise<void>;
}
export declare function createPrismaDatabaseAdapter(config: {
    client: unknown;
    model?: string;
}): PrismaDatabaseAdapterConfig;
export declare function createPrismaRowWriter(adapter: PrismaDatabaseAdapterConfig): DatabaseRowWriter;
