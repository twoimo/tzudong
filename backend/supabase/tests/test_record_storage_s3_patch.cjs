'use strict';

// Execute the actual pinned method bodies with protocol responses, without
// network calls. Source inputs must be the retained, hashed publisher files.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { patchBundle, digest, PREIMAGE } = require('./record_storage_s3_patch.cjs');
const sourceDir = process.env.TZUDONG_STORAGE_PATCH_SOURCE_DIR;
const compilerPath = process.env.TZUDONG_STORAGE_PATCH_TYPESCRIPT;
if (!sourceDir || !compilerPath) throw new Error('HASHED_SOURCE_AND_PINNED_COMPILER_REQUIRED');
const ts = require(compilerPath);
assert.equal(ts.version, '6.0.2', 'Use the pinned project compatibility compiler');
const pins = {
  'v1.33.0-s3-adapter.js': PREIMAGE,
  'v1.33.0-s3-adapter.ts': 'f3f3194c52212ba4ae966ca399e5b855d9d54f4479ca12ba06898e92b30f92cc',
  'src-storage-backend-s3-adapter.ts': '9b7c719444fdddfc0e92884f8b3354698c4f4fb648462d31b685cbb2a33747db',
};
function read(name) {
  const bytes = fs.readFileSync(path.join(sourceDir, name));
  assert.equal(digest(bytes), pins[name]);
  return bytes;
}
function patchedSource(version, name) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'record-storage-source-'));
  try {
    const target = path.join(directory, 'src/storage/backend/s3');
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'adapter.ts'), read(name));
    const result = spawnSync('git', ['apply', '--no-index', '--whitespace=error',
      path.join(__dirname, 'storage-provider-patches', version + '-reject-partial-delete.patch')],
    { cwd: directory, encoding: 'utf8' });
    assert.equal(result.status, 0, 'Publisher source patch must apply exactly');
    return fs.readFileSync(path.join(target, 'adapter.ts'), 'utf8');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
function method(source, anchor) {
  const start = source.indexOf(anchor);
  const end = source.indexOf('\n  /**', start + anchor.length);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}
function candidate(source, latest = false) {
  const body = method(source, '  async deleteObjects(') +
    (latest ? method(source, '  private async deleteObjectBatches(') : '');
  const compiled = ts.transpileModule('class Candidate {\n' + body + '\n}\nCandidate;', {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    reportDiagnostics: true,
  });
  assert.equal(compiled.diagnostics.length, 0);
  const ErrorBoundary = { fromError: (error) => error };
  class Command { constructor(input) { this.input = input; } }
  const Constructor = vm.runInNewContext(compiled.outputText, {
    StorageBackendError: ErrorBoundary, import_errors: { StorageBackendError: ErrorBoundary },
    DeleteObjectsCommand: Command, import_client_s3: { DeleteObjectsCommand: Command },
    MAX_KEYS_PER_S3_DELETE: 1000,
  });
  return new Constructor();
}
const oldBytes = read('v1.33.0-s3-adapter.js');
const oldPatched = patchBundle(oldBytes).toString();
const currentSource = patchedSource('v1.80.1', 'src-storage-backend-s3-adapter.ts');
const oldTs = patchedSource('v1.33.0', 'v1.33.0-s3-adapter.ts');

test('original pinned bundle reproduces discarded per-key Errors', async () => {
  const c = candidate(oldBytes.toString());
  c.client = { send: async () => ({ Errors: [{ Code: 'AccessDenied' }] }) };
  await c.deleteObjects('synthetic', ['synthetic-private-key']);
});
test('unknown source bytes are never patched', () => {
  assert.throws(() => patchBundle(Buffer.concat([oldBytes, Buffer.from('\n')])),
    /FIXTURE_PATCH_PREIMAGE_MISMATCH/);
});
for (const [version, source, latest] of [
  ['v1.33.0 bundle', oldPatched, false], ['v1.33.0 source', oldTs, false],
  ['v1.80.1 source', currentSource, true],
]) {
  for (const [label, response, failure] of [
    ['ordinary success', { Deleted: [{ Key: 'synthetic-private-key' }] }, false],
    ['empty Errors', { Errors: [] }, false],
    ['mixed success and error', { Deleted: [{ Key: 'synthetic-private-key' }],
      Errors: [{ Key: 'synthetic-private-key', Message: 'synthetic-private-message' }] }, true],
    ['Key-less error', { Deleted: [{ Key: 'synthetic-private-key' }], Errors: [{ Code: 'AccessDenied' }] }, true],
    ['malformed Errors', { Errors: { Key: 'synthetic-private-key' } }, true],
  ]) {
    test(version + ': ' + label, async () => {
      const c = candidate(source, latest); let calls = 0;
      c.client = { send: async () => { calls++; return response; } };
      if (failure) await assert.rejects(c.deleteObjects('synthetic', ['synthetic-private-key']),
        (error) => error.message === 'S3_DELETE_PARTIAL_FAILURE' &&
          !String(error).includes('synthetic-private'));
      else await c.deleteObjects('synthetic', ['synthetic-private-key']);
      assert.equal(calls, 1, 'No automatic resend');
    });
  }
  test(version + ': request rejection remains failure', async () => {
    const c = candidate(source, latest); let calls = 0;
    c.client = { send: async () => { calls++; throw new Error('SYNTHETIC_TRANSPORT_FAILURE'); } };
    await assert.rejects(c.deleteObjects('synthetic', ['synthetic-private-key']), /SYNTHETIC_TRANSPORT_FAILURE/);
    assert.equal(calls, 1);
  });
  test(version + ': empty input retains version-specific behavior', async () => {
    const c = candidate(source, latest); let calls = 0;
    c.client = { send: async () => { calls++; return {}; } };
    await c.deleteObjects('synthetic', []);
    assert.equal(calls, latest ? 0 : 1);
  });
}
for (const [label, responses] of [
  ['first success, last partial', [{}, { Errors: [{ Code: 'AccessDenied' }] }]],
  ['first partial, last success', [{ Errors: [{}] }, {}]],
  ['rejection and partial', [new Error('SYNTHETIC_TRANSPORT_FAILURE'), { Errors: [{}] }]],
]) {
  test('v1.80.1: settles all chunks, ' + label, async () => {
    const c = candidate(currentSource, true); let calls = 0; let settled = 0;
    c.client = { send: () => {
      const index = calls++;
      return new Promise((resolve, reject) => setTimeout(() => {
        settled++; const result = responses[index];
        result instanceof Error ? reject(result) : resolve(result);
      }, index ? 10 : 1));
    } };
    await assert.rejects(c.deleteObjects('synthetic', Array.from({ length: 1001 }, (_, i) => 'synthetic-' + i)));
    assert.equal(calls, 2); assert.equal(settled, 2);
  });
}
