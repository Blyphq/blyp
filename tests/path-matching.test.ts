import { describe, expect, it } from 'bun:test';
import { shouldIgnorePath } from '../src/core/helpers';

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
