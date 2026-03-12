import type { BlypErrorLike } from '../shared/errors';

export interface ResolveCtx {
  set?: { status?: number | string };
  error?: Pick<BlypErrorLike, 'status' | 'statusCode' | 'code'>;
  code?: string;
}
