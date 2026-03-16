import type { DrizzleDatabaseAdapterConfig } from '../../types/database';
import type { DatabaseRowWriter } from './prisma';
export declare function createDrizzleDatabaseAdapter(config: {
    db: unknown;
    table: unknown;
}): DrizzleDatabaseAdapterConfig;
export declare function createDrizzleRowWriter(adapter: DrizzleDatabaseAdapterConfig): DatabaseRowWriter;
