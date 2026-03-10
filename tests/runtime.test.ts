import { describe, expect, it } from 'bun:test';
import { runtime } from '../index';

describe('Runtime Detection', () => {
  it('detects the current runtime', () => {
    expect(runtime.type).toBeOneOf(['bun', 'node']);
    expect(typeof runtime.isBun).toBe('boolean');
    expect(typeof runtime.isNode).toBe('boolean');
    expect(runtime.isBun).not.toBe(runtime.isNode);
  });

  it('exposes working path operations', () => {
    const result = runtime.path.join('a', 'b', 'c');
    expect(result).toBe(process.platform === 'win32' ? 'a\\b\\c' : 'a/b/c');
  });

  it('exposes environment lookups', () => {
    const nodeEnv = runtime.env.get('NODE_ENV');
    expect(typeof nodeEnv).toBeOneOf(['string', 'undefined']);
  });
});
