import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { verifyEvidence } from '../verify-overseas-map-startup-evidence.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const sourceEvidence = path.join(repo, 'apps/web/performance/overseas-map-startup-20261021-v1');
const snapshotRelative = 'fixture-inputs/package-manifest.snapshot';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'overseas-evidence-'));
  const evidenceDir = path.join(temp, 'evidence');
  fs.cpSync(sourceEvidence, evidenceDir, { recursive: true, dereference: false });
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  return { temp, evidenceDir, run: () => verifyEvidence({ evidenceDir, repositoryRoot: repo }) };
}

test('original detached evidence and package bytes verify; current source drift is reported separately', t => {
  const f = fixture(t), originalBytes = fs.readFileSync(path.join(sourceEvidence, snapshotRelative));
  const result = f.run();
  assert.equal(result.verified, true);
  assert.equal(result.artifacts, 56);
  assert.equal(sha(fs.readFileSync(path.join(f.evidenceDir, snapshotRelative))), sha(originalBytes));
  assert.equal(result.sourceBindings.checked, 12);
  assert.ok(Array.isArray(result.sourceBindings.mismatches));
});

test('tampered artifact bytes and wrong expected byte hash are rejected', t => {
  const f = fixture(t), target = path.join(f.evidenceDir, snapshotRelative);
  const bytes = fs.readFileSync(target); bytes[0] ^= 1; fs.writeFileSync(target, bytes);
  assert.throws(f.run, /ARTIFACT_HASH_MISMATCH/);
});

test('missing snapshot is rejected', t => {
  const f = fixture(t); fs.unlinkSync(path.join(f.evidenceDir, snapshotRelative));
  assert.throws(f.run, /ARTIFACT_MISSING/);
});

test('reintroduced executable package manifest is rejected', t => {
  const f = fixture(t);
  fs.copyFileSync(path.join(f.evidenceDir, snapshotRelative), path.join(f.evidenceDir, 'fixture-inputs/package.json'));
  assert.throws(f.run, /ACTIVE_PACKAGE_REINTRODUCED/);
});

test('artifact path symlink escape is rejected even when the map bytes remain pinned', t => {
  const f = fixture(t), target = path.join(f.evidenceDir, snapshotRelative);
  fs.unlinkSync(target);
  fs.symlinkSync(path.join(f.temp, 'outside'), target);
  fs.writeFileSync(path.join(f.temp, 'outside'), fs.readFileSync(path.join(sourceEvidence, snapshotRelative)));
  assert.throws(f.run, /PATH_ESCAPE/);
});

test('wrong detached artifact-map hash is rejected', t => {
  const f = fixture(t); fs.appendFileSync(path.join(f.evidenceDir, 'artifact-map.json'), ' ');
  assert.throws(f.run, /ARTIFACT_MAP_HASH_MISMATCH/);
});
