export declare function normalizeError(error: Error): Record<string, unknown>;
export declare function normalizeLogValue(value: unknown, seen?: WeakSet<object>): unknown;
export declare function serializeLogMessage(message: unknown): string;
