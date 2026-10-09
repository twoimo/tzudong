import { describe, expect, test } from 'bun:test';
import { isValidShortUrlCode, resolveShortUrlRead } from '../lib/share/short-url-read';
const allowed = (value: string) => value === '/?review=00000000-0000-4000-8000-000000000009';

describe('bounded short URL read outcomes', () => {
  test('accepts allocator codes and rejects malformed codes before lookup', () => {
    for (const code of ['ABC123', 'Zz00Qq']) expect(isValidShortUrlCode(code)).toBe(true);
    for (const code of [null, undefined, '', '12345', '1234567', '한글테스트코드', 'a/b?c#', 'abcdef\n']) expect(isValidShortUrlCode(code)).toBe(false);
  });
  test('separates missing rows from provider failures and invalid shapes', () => {
    expect(resolveShortUrlRead(null, null, allowed)).toEqual({ kind: 'not-found' });
    for (const error of [{ code: 'PGRST116', message: 'diagnostic' }, new Error('diagnostic')]) {
      expect(resolveShortUrlRead(null, error, allowed)).toEqual({ kind: 'unavailable' });
    }
    for (const value of [undefined, [], {}, { target_url: 3 }, { target_url: 'x'.repeat(2049) }]) {
      expect(resolveShortUrlRead(value, null, allowed)).toEqual({ kind: 'unavailable' });
    }
  });
  test('redirects only allowed targets and retains the safe home fallback', () => {
    const target = '/?review=00000000-0000-4000-8000-000000000009';
    expect(resolveShortUrlRead({ target_url: ` ${target} ` }, null, allowed)).toEqual({ kind: 'redirect', target });
    for (const value of ['https://external.invalid/', '//external.invalid/', 'javascript:alert(1)', '/admin', '']) {
      expect(resolveShortUrlRead({ target_url: value }, null, allowed)).toEqual({ kind: 'redirect', target: '/' });
    }
  });
  test('never passes provider diagnostics to the target validator or result', () => {
    let validated = false;
    const result = resolveShortUrlRead({ target_url: '/private' }, { message: 'private diagnostic' }, () => { validated = true; return true; });
    expect(result).toEqual({ kind: 'unavailable' });
    expect(validated).toBe(false);
    expect(JSON.stringify(result)).not.toContain('private');
  });
});
