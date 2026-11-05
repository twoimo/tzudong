import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

// GHSA-mrhx-c7xc-m3w5: rejecting an oversized collection must not first
// parse every element. Keep the fixture small; the visit count is the oracle.
const cases = [
  ['array.max', (item: z.ZodNumber) => z.array(item).max(1), (size: number) => Array.from({ length: size }, (_, i) => i)],
  ['array.length', (item: z.ZodNumber) => z.array(item).length(1), (size: number) => Array.from({ length: size }, (_, i) => i)],
  ['set.max', (item: z.ZodNumber) => z.set(item).max(1), (size: number) => new Set(Array.from({ length: size }, (_, i) => i))],
  ['set.size', (item: z.ZodNumber) => z.set(item).size(1), (size: number) => new Set(Array.from({ length: size }, (_, i) => i))],
  ['map.max', (item: z.ZodNumber) => z.map(z.string(), item).max(1), (size: number) => new Map(Array.from({ length: size }, (_, i) => [String(i), i]))],
  ['map.size', (item: z.ZodNumber) => z.map(z.string(), item).size(1), (size: number) => new Map(Array.from({ length: size }, (_, i) => [String(i), i]))],
] as const;

describe('collection size admission before element validation', () => {
  for (const [name, schema, input] of cases) {
    test(`${name} rejects oversize without visiting elements`, () => {
      let visited = 0;
      const item = z.number().superRefine(() => { visited += 1; });
      const result = schema(item).safeParse(input(101));

      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.code).toBe('too_big');
      expect(visited).toBe(0);
    });

    test(`${name} still parses a collection within its limit`, () => {
      let visited = 0;
      const item = z.number().superRefine(() => { visited += 1; });
      const result = schema(item).safeParse(input(1));

      expect(result.success).toBe(true);
      expect(visited).toBe(1);
    });
  }
});
