import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from 'bun:test';

const SOURCE = readFileSync(
  path.resolve(import.meta.dir, '../scripts/supabase-gen-types.mjs'),
  'utf8',
);

test('classifyGenTypesFailure is module-scoped for the gen-types catch', () => {
  const fn = SOURCE.indexOf('function classifyGenTypesFailure(error)');
  const tryBlock = SOURCE.indexOf('\ntry {\n');
  const catchBlock = SOURCE.indexOf('} catch (error) {');
  expect(fn).toBeGreaterThan(-1);
  expect(tryBlock).toBeGreaterThan(fn);
  expect(catchBlock).toBeGreaterThan(tryBlock);
  expect(SOURCE.includes('failure_class=${classifyGenTypesFailure(error)}')).toBe(true);
});
