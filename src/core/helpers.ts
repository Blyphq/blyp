import type { ResolveCtx } from '../types/core/helpers';

export type { ResolveCtx } from '../types/core/helpers';

export function resolveStatusCode(
  ctx: ResolveCtx,
  successCode: number = 200,
  errorCode: number = 500,
  isError: boolean = false
): number {
  if (isError && ctx.error) {
    if (ctx.error.status) {
      return ctx.error.status;
    }
    if (ctx.error.statusCode) {
      return ctx.error.statusCode;
    }
    if (ctx.code) {
      return parseInt(ctx.code, 10) || errorCode;
    }
    return errorCode;
  }

  if (ctx.set?.status) {
    const status = ctx.set.status;
    return typeof status === 'number' ? status : parseInt(status as string, 10) || successCode;
  }

  return successCode;
}

export function shouldLogTable(): boolean {
  return process.env.NODE_ENV !== 'production';
}

function normalizePath(path: string): string {
  const queryIndex = path.indexOf('?');
  let withoutQuery = queryIndex >= 0 ? path.substring(0, queryIndex) : path;
  if (withoutQuery.endsWith('/') && withoutQuery.length > 1) {
    withoutQuery = withoutQuery.slice(0, -1);
  }
  if (!withoutQuery.startsWith('/')) {
    withoutQuery = '/' + withoutQuery;
  }
  return withoutQuery;
}

function normalizePattern(pattern: string): string {
  const queryIndex = pattern.indexOf('?');
  let withoutQuery = queryIndex >= 0 ? pattern.substring(0, queryIndex) : pattern;
  if (withoutQuery.endsWith('/') && withoutQuery.length > 1) {
    withoutQuery = withoutQuery.slice(0, -1);
  }
  if (!withoutQuery.startsWith('/')) {
    withoutQuery = '/' + withoutQuery;
  }
  return withoutQuery;
}

export function shouldIgnorePath(path: string, ignorePaths?: string[]): boolean {
  if (!ignorePaths || ignorePaths.length === 0) {
    return false;
  }

  const normalizedPath = normalizePath(path);

  return ignorePaths.some((ignoredPattern) => {
    const normalizedPattern = normalizePattern(ignoredPattern);

    if (normalizedPattern === normalizedPath) {
      return true;
    }

    if (normalizedPattern === '/**' || normalizedPattern === '**') {
      return true;
    }

    if (normalizedPattern === '/*') {
      const segments = normalizedPath.split('/').filter(s => s.length > 0);
      return segments.length === 1;
    }

    if (normalizedPattern.endsWith('/*') && !normalizedPattern.includes('**')) {
      const prefix = normalizedPattern.slice(0, -1);
      if (normalizedPath.startsWith(prefix)) {
        const rest = normalizedPath.slice(prefix.length);
        const restSegments = rest.split('/').filter(s => s.length > 0);
        return restSegments.length === 1;
      }
      return false;
    }

    if (normalizedPattern.includes('**')) {
      if (normalizedPattern === '/**') {
        return true;
      }
      
      if (normalizedPattern.startsWith('/') && normalizedPattern.endsWith('**')) {
        let prefix = normalizedPattern.slice(0, -2);
        if (prefix.endsWith('/') && prefix.length > 1) {
          prefix = prefix.slice(0, -1);
        }
        if (prefix === normalizedPath) {
          return true;
        }
        return normalizedPath.startsWith(prefix + '/');
      }
      
      const starIndex = normalizedPattern.indexOf('**');
      let prefix = normalizedPattern.substring(0, starIndex);
      const suffix = normalizedPattern.substring(starIndex + 2);
      
      if (prefix.endsWith('/') && prefix.length > 1) {
        prefix = prefix.slice(0, -1);
      }
      
      if (prefix === '' && suffix === '') {
        return true;
      }
      
      if (prefix !== '' && suffix === '') {
        return normalizedPath.startsWith(prefix + '/');
      }
      
      if (prefix === '' && suffix !== '') {
        return normalizedPath.endsWith(suffix) || normalizedPath.includes(suffix + '/');
      }
      
      if (prefix !== '' && suffix !== '') {
        return normalizedPath.startsWith(prefix) && 
               (normalizedPath.endsWith(suffix) || normalizedPath.includes(suffix + '/'));
      }
      
      return false;
    }

    if (normalizedPattern.includes('*')) {
      const lastDotIndex = normalizedPattern.lastIndexOf('.');
      const lastStarIndex = normalizedPattern.lastIndexOf('*');
      
      if (lastDotIndex > lastStarIndex && lastStarIndex > 0) {
        const charBeforeStar = normalizedPattern[lastStarIndex - 1];
        if (charBeforeStar === '/') {
          const extPattern = normalizedPattern.slice(lastStarIndex);
          const filePart = normalizedPath.slice(normalizedPath.lastIndexOf('/') + 1);
          const extIndex = filePart.lastIndexOf('.');
          if (extIndex > 0) {
            const actualExt = filePart.slice(extIndex);
            return actualExt === extPattern;
          }
        }
      }
      
      const regexPattern = normalizedPattern
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '[^/]*');
      const regex = new RegExp('^' + regexPattern + '$');
      return regex.test(normalizedPath);
    }

    return false;
  });
}
