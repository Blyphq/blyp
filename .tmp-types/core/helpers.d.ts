import type { ResolveCtx } from '../types/core/helpers';
export type { ResolveCtx } from '../types/core/helpers';
export declare function resolveStatusCode(ctx: ResolveCtx, successCode?: number, errorCode?: number, isError?: boolean): number;
export declare function shouldLogTable(): boolean;
export declare function shouldIgnorePath(path: string, ignorePaths?: string[]): boolean;
