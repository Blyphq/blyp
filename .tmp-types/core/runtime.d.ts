import type { RuntimeAdapter } from '../types/frameworks/standalone';
export declare function createRuntimeAdapter(): RuntimeAdapter;
export declare const runtime: RuntimeAdapter;
export declare function createLogDir(customPath?: string): string;
