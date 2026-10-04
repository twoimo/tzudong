import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const backendRoot = fileURLToPath(new URL('../../', import.meta.url));

// Stage the actual callers with their local imports. Never load an operator's
// .env, start a browser, or contact a provider/database during these checks.
function stage(t, entry) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'node-dependency-compatibility-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const copied = new Set();
  function copy(relativePath) {
    if (copied.has(relativePath)) return;
    copied.add(relativePath);
    const source = fs.readFileSync(path.join(backendRoot, relativePath), 'utf8');
    const destination = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, source);
    for (const match of source.matchAll(/(?:from\s*|import\s*\()\s*['"](\.[^'"]+\.(?:mjs|js))['"]/g)) {
      copy(path.normalize(path.join(path.dirname(relativePath), match[1])));
    }
  }
  copy(entry);
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}\n');
  fs.symlinkSync(path.join(backendRoot, 'node_modules'), path.join(root, 'node_modules'), 'dir');
  fs.writeFileSync(path.join(root, '.env'), 'DEPENDENCY_FIXTURE_LOADED=yes\nDEPENDENCY_FIXTURE_KEEP=from-file\n');
  fs.mkdirSync(path.join(root, 'restaurant-crawling'), { recursive: true });
  fs.copyFileSync(path.join(root, '.env'), path.join(root, 'restaurant-crawling/.env'));
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'config/channels.yaml'), 'channels:\n  fixture:\n    name: dependency fixture\n');
  fs.mkdirSync(path.join(root, 'report'));
  fs.writeFileSync(path.join(root, 'report/review-queue.jsonl'), '');
  fs.writeFileSync(path.join(root, 'report/same-origin-known-coordinate-candidates.jsonl'), '\n');
  fs.writeFileSync(path.join(root, 'empty-evidence-bundles.jsonl'), '');
  if (copied.has('utils/verified-pg-client.mjs')) {
    fs.writeFileSync(path.join(root, 'utils/verified-pg-client.mjs'), `
      export async function createVerifiedPgClient() {
        return {
          async connect() {},
          async query(sql) {
            if (!/^\\s*select\\b/i.test(sql)) throw new Error('FIXTURE_REQUIRES_SELECT');
            return { rows: [] };
          },
          async end() {},
        };
      }
    `);
  }
  const guard = path.join(root, 'offline-guard.mjs');
  fs.writeFileSync(guard, `
    import net from 'node:net';
    import http from 'node:http';
    import https from 'node:https';
    import childProcess from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    let blocked = false;
    const deny = () => { blocked = true; throw new Error('DEPENDENCY_TEST_EXTERNAL_IO_FORBIDDEN'); };
    net.Socket.prototype.connect = deny;
    http.request = http.get = https.request = https.get = deny;
    for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) childProcess[name] = deny;
    globalThis.fetch = deny;
    syncBuiltinESMExports();
    process.on('exit', () => { if (blocked) process.exitCode = 99; });
  `);
  const env = { PATH: process.env.PATH, NODE_ENV: 'test', DEPENDENCY_FIXTURE_KEEP: 'from-process' };
  function run(args) {
    const result = spawnSync(process.execPath, ['--import', guard, ...args], {
      cwd: root, env, encoding: 'utf8', timeout: 15_000,
    });
    assert.equal(result.error, undefined, 'caller must finish within the local test deadline');
    assert.equal(result.status, 0, 'caller must succeed without external I/O');
    assert.equal(result.stderr, '', 'dotenv must preserve silent stderr');
    assert.doesNotMatch(result.stdout, /injected env|injecting env/);
    return result.stdout;
  }
  return { root, run, entry: path.join(root, entry) };
}

test('map crawler loads js-yaml named exports before the no-channel exit', (t) => {
  const fixture = stage(t, 'restaurant-crawling/scripts/05-map-url-crawling.js');
  assert.match(fixture.run([fixture.entry, '--channel', 'dependency-fixture']), /MAP_NO_ALLOWED_CHANNELS/);
});

test('transcript crawler loads YAML and dotenv without starting collection', (t) => {
  const fixture = stage(t, 'restaurant-crawling/scripts/03-collect-transcript.js');
  const stdout = fixture.run([fixture.entry, '--channel', 'dependency-fixture']);
  assert.match(stdout, /dependency-fixture/);
  assert.match(stdout, /자막 수집 완료/);
});

test('URL extractor import preserves JSON stdout and existing environment', (t) => {
  const fixture = stage(t, 'restaurant-crawling/scripts/url-extractor.js');
  const stdout = fixture.run(['--input-type=module', '-e', `
    const {findMapUrl} = await import(${JSON.stringify(pathToFileURL(fixture.entry).href)});
    console.log(JSON.stringify({
      result: findMapUrl('no map URL'),
      loaded: process.env.DEPENDENCY_FIXTURE_LOADED,
      kept: process.env.DEPENDENCY_FIXTURE_KEEP,
    }));
  `]);
  assert.deepEqual(JSON.parse(stdout), { result: null, loaded: 'yes', kept: 'from-process' });
});

for (const entry of [
  'bin/build_google_maps_browser_review_queue.mjs',
  'bin/build_supabase_address_consistency_guarded_plan.mjs',
  'bin/build_tzuyang_address_evidence_ledger.mjs',
]) {
  test(`${path.basename(entry)} emits one JSON document with a local empty DB double`, (t) => {
    const fixture = stage(t, entry);
    const args = [fixture.entry, '--json', '--out', path.join(fixture.root, 'output')];
    if (entry.includes('evidence_ledger')) args.push('--evidence-bundles', path.join(fixture.root, 'empty-evidence-bundles.jsonl'));
    const payload = JSON.parse(fixture.run(args));
    assert.equal(payload.db_write_performed, false);
    assert.equal(payload.total_rows ?? payload.total_ledger_rows, 0);
  });
}

for (const entry of [
  'bin/validate_supabase_review_queue_live.mjs',
  'bin/validate_supabase_same_origin_candidates.mjs',
]) {
  test(`${path.basename(entry)} preserves JSON stdout for an empty local queue`, (t) => {
    const fixture = stage(t, entry);
    const payload = JSON.parse(fixture.run([fixture.entry, '--report-dir', path.join(fixture.root, 'report')]));
    assert.equal(payload.db_write_performed, false);
    assert.deepEqual(payload.summary, {});
  });
}

test('apply ledger environment loader stays silent without executing apply', (t) => {
  const fixture = stage(t, 'bin/apply_tzuyang_address_evidence_ledger.mjs');
  // Expose only the copied private loader; the real apply path is never invoked.
  fs.appendFileSync(fixture.entry, '\nexport { loadRuntimeEnv };\n');
  const stdout = fixture.run(['--input-type=module', '-e', `
    const {loadRuntimeEnv} = await import(${JSON.stringify(pathToFileURL(fixture.entry).href)});
    await loadRuntimeEnv();
    console.log(JSON.stringify({loaded: process.env.DEPENDENCY_FIXTURE_LOADED, kept: process.env.DEPENDENCY_FIXTURE_KEEP}));
  `]);
  assert.deepEqual(JSON.parse(stdout), { loaded: 'yes', kept: 'from-process' });
});

test('GenAI caller imports and consumed SDK methods remain available offline', (t) => {
  const fixture = stage(t, 'restaurant-crawling/scripts/gemini_chunk_video_request.mjs');
  const stdout = fixture.run(['--input-type=module', '-e', `
    await import(${JSON.stringify(pathToFileURL(fixture.entry).href)});
    const {GoogleGenAI, FileState} = await import('@google/genai');
    const ai = new GoogleGenAI({apiKey: 'local-fixture-never-sent'});
    console.log(JSON.stringify({
      generate: typeof ai.models.generateContent,
      upload: typeof ai.files.upload,
      get: typeof ai.files.get,
      delete: typeof ai.files.delete,
      active: FileState.ACTIVE,
    }));
  `]);
  assert.deepEqual(JSON.parse(stdout), {
    generate: 'function', upload: 'function', get: 'function', delete: 'function', active: 'ACTIVE',
  });
});

for (const context of ['node_modules/minimatch/package.json', 'node_modules/gaxios/node_modules/minimatch/package.json']) {
  test(`brace expansion remains compatible and bounded through ${context}`, () => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import {createRequire} from 'node:module';
      const require = createRequire(${JSON.stringify(path.join(backendRoot, context))});
      const expand = require('brace-expansion');
      const matcher = require('./');
      const minimatch = matcher.minimatch || matcher;
      assert.deepEqual(expand('file.{js,mjs}'), ['file.js', 'file.mjs']);
      assert.equal(minimatch('file.mjs', 'file.{js,mjs}'), true);
      for (const payload of [
        '{' + '{a},'.repeat(7000) + 'b}',
        '{'.repeat(3200) + 'a,b' + '}'.repeat(3200),
        '{a}' + '}'.repeat(32000) + ',z}',
      ]) assert.ok(Array.isArray(expand(payload)));
    `], { cwd: backendRoot, env: { PATH: process.env.PATH }, encoding: 'utf8', timeout: 10_000 });
    assert.equal(result.error, undefined, 'advisory cases must complete within a bounded test deadline');
    assert.equal(result.status, 0, 'valid glob semantics and advisory cases must not throw');
  });
}
