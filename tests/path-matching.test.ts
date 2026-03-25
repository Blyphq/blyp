import { describe, expect, it } from 'bun:test';
import { shouldIgnorePath } from '../src/core/helpers';
import { isIncludedPath, shouldSkipPath } from '../src/frameworks/shared/logger';

describe('ignorePaths Matcher', () => {
  it('matches exact paths and slash variants', () => {
    expect(shouldIgnorePath('/health', ['/health'])).toBe(true);
    expect(shouldIgnorePath('/health/', ['/health'])).toBe(true);
    expect(shouldIgnorePath('health', ['/health'])).toBe(true);
    expect(shouldIgnorePath('/health', ['/metrics'])).toBe(false);
  });

  it('matches single-segment wildcards', () => {
    expect(shouldIgnorePath('/api/users/123', ['/api/users/*'])).toBe(true);
    expect(shouldIgnorePath('/api/users', ['/api/users/*'])).toBe(false);
    expect(shouldIgnorePath('/api/users/123/profile', ['/api/users/*'])).toBe(false);
  });

  it('matches recursive wildcards', () => {
    expect(shouldIgnorePath('/metrics', ['/metrics/**'])).toBe(true);
    expect(shouldIgnorePath('/metrics/cpu/usage', ['/metrics/**'])).toBe(true);
    expect(shouldIgnorePath('/metric', ['/metrics/**'])).toBe(false);
  });

  it('handles edge cases', () => {
    expect(shouldIgnorePath('/test', ['/test?foo=bar'])).toBe(true);
    expect(shouldIgnorePath('/用户', ['/用户'])).toBe(true);
    expect(shouldIgnorePath('/', ['/**'])).toBe(true);
    expect(shouldIgnorePath('/anything', undefined)).toBe(false);
  });
});

describe('includePaths Matcher', () => {
  it('matches exact included paths and suppresses non-included paths', () => {
    expect(isIncludedPath('/health', ['/health'])).toBe(true);
    expect(isIncludedPath('/metrics', ['/health'])).toBe(false);
  });

  it('matches wildcard include patterns', () => {
    expect(isIncludedPath('/api/users/1', ['/api/**'])).toBe(true);
    expect(isIncludedPath('/health', ['/api/**'])).toBe(false);
  });

  it('normalizes slash and query variants for includes', () => {
    expect(isIncludedPath('/health/', ['health'])).toBe(true);
    expect(isIncludedPath('/search?q=test', ['/search'])).toBe(true);
  });

  it('treats empty includes as a no-op', () => {
    expect(isIncludedPath('/anything', undefined)).toBe(true);
    expect(isIncludedPath('/anything', [])).toBe(true);
  });

  it('applies includePaths before ignorePaths', () => {
    expect(shouldSkipPath('/api/public/users', ['/api/**'], ['/api/internal/**'])).toBe(false);
    expect(shouldSkipPath('/api/internal/stats', ['/api/**'], ['/api/internal/**'])).toBe(true);
    expect(shouldSkipPath('/health', ['/api/**'], ['/api/internal/**'])).toBe(true);
  });
});
