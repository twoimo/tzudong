import { test, expect } from 'bun:test';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = dirname(fileURLToPath(import.meta.url));
const original = JSON.parse(await readFile(join(root, 'completion-manifest.json'), 'utf8'));
const run = file => spawnSync('/opt/homebrew/opt/node@24/bin/node',
  [join(root, 'verify-completion-manifest.mjs'), file], { encoding: 'utf8' });

test('current partial manifest validates its bytes without being declared complete', () => {
  const result = run(join(root, 'completion-manifest.json'));
  expect(result.status).toBe(0);
  const readback = JSON.parse(result.stdout);
  expect(readback.completionEligible).toBe(false);
  expect(readback.missingStages).toEqual(['antithesis', 'reverse']);
});

for (const [label, mutate, expectedCode] of [
  ['premature completion', x => { x.status = 'complete'; }, 'PREMATURE_COMPLETE'],
  ['report substitution', x => { x.reports[0].sha256 = '0'.repeat(64); }, 'REPORT_HASH_MISMATCH'],
  ['duplicate finding ID', x => { x.findings.push(x.findings[0]); }, 'DUPLICATE_OR_MISSING_FINDING_ID'],
  ['source bundle substitution', x => { x.source_bundle_sha256 = '0'.repeat(64); }, 'SOURCE_BUNDLE_HASH_MISMATCH'],
]) {
  test(`rejects ${label} through a real subprocess and filesystem readback`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tzudong-manifest-negative-'));
    try {
      const copy = structuredClone(original); mutate(copy);
      const file = join(dir, 'manifest.json');
      await writeFile(file, JSON.stringify(copy));
      const result = run(file);
      expect(result.status).toBe(1);
      expect(JSON.parse(result.stderr).code).toBe(expectedCode);
    } finally { await rm(dir, { recursive: true }); }
  });
}
