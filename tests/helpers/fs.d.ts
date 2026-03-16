export declare function makeTempDir(prefix?: string): string;
export declare function readJsonLines(filePath: string): Array<Record<string, unknown>>;
export declare function waitForFileFlush(duration?: number): Promise<void>;
