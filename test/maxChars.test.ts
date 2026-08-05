import { describe, it, expect } from 'vitest';
import { NO_LIMIT, parseMaxChars, validateConfig } from '../src/index';

// These exercise the parser directly. The previous version of this file
// spawned a server and asserted inside a `close` handler, which resolved
// after the synchronous test had already passed - the assertions never
// failed anything.
describe('parseMaxChars', () => {
  it('imposes no limit when --maxChars is absent', () => {
    expect(parseMaxChars(undefined)).toBe(NO_LIMIT);
  });

  it('enforces a positive integer', () => {
    expect(parseMaxChars('50')).toBe(50);
    expect(parseMaxChars('1000')).toBe(1000);
    expect(parseMaxChars(' 4096 ')).toBe(4096);
  });

  it('treats "none" as an explicit no-limit', () => {
    expect(parseMaxChars('none')).toBe(NO_LIMIT);
    expect(parseMaxChars('NONE')).toBe(NO_LIMIT);
  });

  it('treats zero and negatives as an explicit no-limit', () => {
    expect(parseMaxChars('0')).toBe(NO_LIMIT);
    expect(parseMaxChars('-1')).toBe(NO_LIMIT);
  });

  it('rejects a value it cannot read rather than picking one', () => {
    expect(parseMaxChars('invalid')).toBeNull();
    expect(parseMaxChars('5000abc')).toBeNull();
    expect(parseMaxChars('1e4')).toBeNull();
    expect(parseMaxChars('')).toBeNull();
  });

  it('rejects a bare --maxChars flag carrying no value', () => {
    expect(parseMaxChars(null)).toBeNull();
  });
});

describe('validateConfig', () => {
  const base = { host: '127.0.0.1', user: 'test' };

  it('accepts a config with no --maxChars', () => {
    expect(() => validateConfig({ ...base })).not.toThrow();
  });

  it('accepts every valid --maxChars spelling', () => {
    for (const maxChars of ['50', 'none', '0', '-1']) {
      expect(() => validateConfig({ ...base, maxChars })).not.toThrow();
    }
  });

  it('fails to start on an unreadable --maxChars', () => {
    expect(() => validateConfig({ ...base, maxChars: 'invalid' })).toThrow(
      'Invalid --maxChars'
    );
    expect(() => validateConfig({ ...base, maxChars: null })).toThrow(
      'Invalid --maxChars'
    );
  });
});
