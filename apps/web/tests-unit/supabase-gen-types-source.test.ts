import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from 'bun:test';

const SOURCE = readFileSync(
  path.resolve(import.meta.dir, '../scripts/supabase-gen-types.mjs'),
  'utf8',
);

test('classifyGenTypesFailure is module-scoped for the gen-types catch', () => {
  const fn = SOURCE.indexOf('function classifyGenTypesFailure(error)');
  const mainCall = SOURCE.indexOf('main().catch((error) => {');
  expect(fn).toBeGreaterThan(-1);
  expect(mainCall).toBeGreaterThan(fn);
  expect(SOURCE.includes('failure_class=${classifyGenTypesFailure(error)}')).toBe(true);
});

test('local typegen prefers loopback postgres-meta over a Docker pg-meta sidecar', () => {
  expect(SOURCE).toContain("parsed.hostname !== '127.0.0.1'");
  expect(SOURCE).toContain('/generators/typescript?included_schemas=');
  expect(SOURCE).toContain('family: 4');
  expect(SOURCE).not.toContain('host.docker.internal');
});
