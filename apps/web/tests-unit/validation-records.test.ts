import { describe, expect, test } from 'bun:test';
import {
  getResponseErrorMessage,
  hasExactKeys,
  isNonNullObject,
  isPlainRecord,
  isRecord,
  parseValidatedRows,
} from '@/lib/validation/records';

class Point {
  x = 1;
}

const throwingPrototypeProxy = new Proxy({}, {
  getPrototypeOf() {
    throw new Error('trap');
  },
});

const throwingKeysProxy = new Proxy({}, {
  ownKeys() {
    throw new Error('trap');
  },
});

describe('record guards', () => {
  test.each([
    ['null', null, false, false, false],
    ['undefined', undefined, false, false, false],
    ['number', 0, false, false, false],
    ['string', 'x', false, false, false],
    ['function', () => undefined, false, false, false],
    ['array', [], false, true, false],
    ['object literal', { a: 1 }, true, true, true],
    ['null-prototype object', Object.create(null), true, true, true],
    ['class instance', new Point(), true, true, false],
    ['date', new Date(0), true, true, false],
    ['proxy whose getPrototypeOf throws', throwingPrototypeProxy, true, true, false],
  ])('%s', (_label, value, record, nonNullObject, plainRecord) => {
    expect(isRecord(value)).toBe(record);
    expect(isNonNullObject(value)).toBe(nonNullObject);
    expect(isPlainRecord(value)).toBe(plainRecord);
  });
});

describe('hasExactKeys', () => {
  test('matches the same own data keys in any order', () => {
    expect(hasExactKeys({ b: 1, a: 2 }, ['a', 'b'])).toBe(true);
    expect(hasExactKeys(Object.assign(Object.create(null), { a: 1 }), ['a'])).toBe(true);
  });

  test('rejects missing, extra, and duplicated expected keys', () => {
    expect(hasExactKeys({ a: 1 }, ['a', 'b'])).toBe(false);
    expect(hasExactKeys({ a: 1, b: 2 }, ['a'])).toBe(false);
    expect(hasExactKeys({ a: 1 }, ['a', 'a'])).toBe(false);
  });

  test('counts non-enumerable keys, ignores symbol keys and inherited keys', () => {
    const hidden = { a: 1 };
    Object.defineProperty(hidden, 'b', { value: 2, enumerable: false });
    expect(hasExactKeys(hidden, ['a'])).toBe(false);
    expect(hasExactKeys(hidden, ['a', 'b'])).toBe(true);

    expect(hasExactKeys({ a: 1, [Symbol('s')]: 2 }, ['a'])).toBe(true);
    expect(hasExactKeys(Object.assign(Object.create({ inherited: 1 }), { a: 1 }), ['a'])).toBe(true);
  });

  test('rejects accessor properties and objects whose keys cannot be read', () => {
    expect(hasExactKeys(Object.defineProperty({}, 'a', { get: () => 1, enumerable: true }), ['a'])).toBe(false);
    expect(hasExactKeys(throwingKeysProxy, [])).toBe(false);
  });
});

describe('parseValidatedRows', () => {
  const isNumber = (value: unknown): value is number => typeof value === 'number';

  test('keeps only rows the guard accepts, in order', () => {
    expect(parseValidatedRows([3, 'x', null, 1, { n: 2 }], isNumber)).toEqual([3, 1]);
    expect(parseValidatedRows([], isNumber)).toEqual([]);
  });

  test('offers array holes to the guard as undefined', () => {
    const isUndefined = (value: unknown): value is undefined => value === undefined;
    const sparse: unknown[] = [];
    sparse[2] = 'x';
    expect(parseValidatedRows(sparse, isUndefined)).toEqual([undefined, undefined]);
  });
});

describe('getResponseErrorMessage', () => {
  test('reads a string error from a non-array object payload', () => {
    expect(getResponseErrorMessage({ error: 'denied' })).toBe('denied');
    expect(getResponseErrorMessage({ error: '' })).toBe('');
  });

  test.each([
    ['null', null],
    ['string payload', 'denied'],
    ['non-string error', { error: 404 }],
    ['missing error', { message: 'denied' }],
    ['array carrying an error field', Object.assign([], { error: 'denied' })],
  ])('returns null for %s', (_label, value) => {
    expect(getResponseErrorMessage(value)).toBeNull();
  });
});
