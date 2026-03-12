export type ConsoleOnceLogger = (key: string, message: string, error?: unknown) => void;

export type ConsoleMethod = 'warn' | 'error';
