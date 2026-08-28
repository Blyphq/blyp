import { AsyncLocalStorage } from 'node:async_hooks';
import type {
  ConvexFunctionKind,
  ConvexRuntimeStore,
} from '../../types/frameworks/convex';

export function createConvexRuntimeStorage(): AsyncLocalStorage<ConvexRuntimeStore> {
  return new AsyncLocalStorage<ConvexRuntimeStore>();
}

export function resolveConvexFunctionKind(ctx: unknown): ConvexFunctionKind {
  if (!ctx || typeof ctx !== 'object') {
    return 'unknown';
  }

  const record = ctx as Record<string, unknown>;
  if (typeof record.runQuery === 'function' && typeof record.runMutation === 'function') {
    return 'action';
  }

  if (record.scheduler !== null && typeof record.scheduler === 'object') {
    return 'mutation';
  }

  if (record.db !== null && typeof record.db === 'object') {
    return 'query';
  }

  return 'unknown';
}

export function createConvexRuntimeStore(ctx: unknown): ConvexRuntimeStore {
  return {
    ctx,
    kind: resolveConvexFunctionKind(ctx),
  };
}

export function canSendRemoteLogs(kind: ConvexFunctionKind): boolean {
  return kind === 'action';
}
