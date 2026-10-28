import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { readPredecessorCustody, validatePredecessorPolicy, assertPredecessorBeforeImage } from '../sponsorship-predecessor-custody.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const line = value => `${JSON.stringify(value)}\n`;
const copy = value => structuredClone(value);
const fileNames = ['admission.json', 'original.jsonl', 'send.lock'];
const fail = /SPONSORSHIP_PREDECESSOR_/;
function fixture(t) {
  const directory = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), 'sponsorship-predecessor-'));
  fs.chmodSync(directory, 0o700);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const admission = {
    kind: 'sponsorship_scoped_admission_v2', authority: 'authenticated-repository-owner-local-cli',
    operationId: '11111111-1111-4111-8111-111111111111', projectRef: 'aqlcofblfxdrjhhdmarw', databaseName: 'postgres',
    manifestSha256: 'a'.repeat(64), bundleSha256: 'b'.repeat(64), scopeSha256: 'c'.repeat(64),
    sourceRevision: 'd'.repeat(40), sourceTree: 'e'.repeat(40), sourceFilesSha256: 'f'.repeat(64),
    issuedAt: '2020-01-01T00:00:00.000Z', expiresAt: '2020-01-01T00:10:00.000Z',
    fences: { generalFreeze: 'active', githubProducer: 'disabled_manually',
      privilegedCatalogWriters: 'common_serializer_no_out_of_band', directIndexWriters: 'common_serializer_no_out_of_band',
      producerRuntimeSettings: 'preserve' },
    protectedMain: { repository: 'twoimo/tzudong', branch: 'main', sha: 'd'.repeat(40), protected: true,
      observedAt: '2020-01-01T00:00:00.000Z' },
  };
  const identity = { operationId: admission.operationId, admissionSha256: sha(JSON.stringify(admission)),
    manifestSha256: admission.manifestSha256, sourceRevision: admission.sourceRevision,
    protectedMainSha: admission.protectedMain.sha, sourceFilesSha256: admission.sourceFilesSha256,
    bundleSha256: admission.bundleSha256, projectRef: admission.projectRef };
  const before = { identity: true, catalog: true,
    ledger: { count: 97, priorHash: '1'.repeat(64), targets: ['20261028195647', '20261028225926']
      .map(version => ({ version, present: false, equal: false })) },
    revision: { count: 1, singletonCount: 1, value: '38' },
    data: { businessCount: 1668, businessHash: '2'.repeat(64), cohortCount: 417, cohortHash: '3'.repeat(64),
      indexCount: 1668, indexHash: '4'.repeat(64), untouchedCount: 1251, untouchedHash: '5'.repeat(64) } };
  const sqlSha256 = '6'.repeat(64);
  const events = [{ event: 'prepared', identity: copy(identity), before, sqlSha256 },
    { identity: copy(identity), event: 'send_intent', sqlSha256 },
    { event: 'unconfirmed_reconcile_original', identity: copy(identity) }];
  const reservation = { identity: copy(identity), event: 'send_reserved' };
  const policy = { schemaVersion: 1, kind: 'spent_original_source_correction', projectRef: admission.projectRef,
    operationId: admission.operationId, sourceRevision: admission.sourceRevision, manifestSha256: admission.manifestSha256,
    admissionValueSha256: identity.admissionSha256, sendSqlSha256: sqlSha256, expectedFileHashes: {},
    requireFreshBeforeImage: true, replayAllowed: false };
  function write(name, bytes, repin = true) {
    fs.writeFileSync(join(directory, name), bytes, { mode: 0o600 });
    if (repin) policy.expectedFileHashes[name] = sha(bytes);
  }
  write('admission.json', line(admission)); write('original.jsonl', events.map(line).join(''));
  write('send.lock', line(reservation));
  return { directory, admission, identity, before, events, reservation, policy, write,
    read: () => readPredecessorCustody(policy, { directory }) };
}
function snapshot(directory) {
  return fs.readdirSync(directory).sort().map(name => {
    const path = join(directory, name), s = fs.lstatSync(path, { bigint: true });
    return { name, hash: sha(fs.readFileSync(path)), inode: s.ino, size: s.size,
      mode: s.mode, uid: s.uid, nlink: s.nlink, modified: s.mtimeNs, changed: s.ctimeNs };
  });
}

test('real private spent custody returns immutable original binding without writes or a remote claim', t => {
  const f = fixture(t), saved = snapshot(f.directory), binding = f.read();
  assert.deepEqual(binding.identity, f.identity); assert.deepEqual(binding.before, f.before);
  assert.deepEqual(binding.fileHashes, f.policy.expectedFileHashes);
  assert.equal(binding.sqlSha256, f.events[0].sqlSha256);
  assert.equal(binding.replayAllowed, false); assert.equal(binding.remoteStateVerified, false);
  for (const value of [binding, binding.identity, binding.before, binding.before.data,
    binding.before.ledger.targets[0], binding.fileHashes, binding.policy.expectedFileHashes]) assert.ok(Object.isFrozen(value));
  assert.throws(() => { binding.before.revision.value = '39'; }, TypeError);
  f.policy.expectedFileHashes['send.lock'] = '0'.repeat(64);
  assert.notEqual(binding.policy.expectedFileHashes['send.lock'], f.policy.expectedFileHashes['send.lock']);
  assert.deepEqual(snapshot(f.directory), saved);
});

test('policy is exact, typed, non-extensible authority with no accessors or override adapters', t => {
  const f = fixture(t);
  for (const mutate of [p => { p.extra = true; }, p => { delete p.operationId; },
    p => { p.schemaVersion = 2; }, p => { p.kind = 'retry'; }, p => { p.projectRef = 'other'; },
    p => { p.operationId = 'invalid'; }, p => { p.sourceRevision = 'a'.repeat(39); },
    p => { p.manifestSha256 = 'A'.repeat(64); }, p => { p.admissionValueSha256 = null; },
    p => { p.sendSqlSha256 = ''; }, p => { p.replayAllowed = true; }, p => { p.requireFreshBeforeImage = false; },
    p => { delete p.expectedFileHashes['send.lock']; }, p => { p.expectedFileHashes.extra = 'a'.repeat(64); },
    p => { p.expectedFileHashes['admission.json'] = 'b'.repeat(63); },
    p => { p[Symbol('extra')] = true; },
    p => Object.defineProperty(p, 'operationId', { get() { assert.fail('getter must not run'); }, enumerable: true }),
  ]) { const p = copy(f.policy); mutate(p); assert.throws(() => validatePredecessorPolicy(p), /POLICY_INVALID/); }
  assert.throws(() => readPredecessorCustody(f.policy, { directory: f.directory, read: () => null }), /ARGUMENT_INVALID/);
});

test('each expected file digest and the separate canonical admission value digest are enforced', t => {
  const f = fixture(t);
  for (const name of fileNames) {
    const p = copy(f.policy); p.expectedFileHashes[name] = '0'.repeat(64);
    assert.throws(() => readPredecessorCustody(p, { directory: f.directory }), /HASH_MISMATCH/);
  }
  const p = copy(f.policy); p.admissionValueSha256 = p.expectedFileHashes['admission.json'];
  assert.throws(() => readPredecessorCustody(p, { directory: f.directory }), /BINDING_INVALID/);
});

test('valid-looking but different policy operation, project, source, manifest and send SQL fail', t => {
  const f = fixture(t);
  for (const [key, value] of Object.entries({ operationId: '22222222-2222-4222-8222-222222222222',
    projectRef: 'b'.repeat(20), sourceRevision: '0'.repeat(40), manifestSha256: '0'.repeat(64), sendSqlSha256: '0'.repeat(64) })) {
    const p = { ...copy(f.policy), [key]: value };
    assert.throws(() => readPredecessorCustody(p, { directory: f.directory }), /BINDING_INVALID/);
  }
});

test('canonical JSON bytes reject duplicates, CRLF, BOM, partial, invalid UTF-8 and corrupt data even if repinned', t => {
  const f = fixture(t), original = line(f.admission);
  const variants = [original.trimEnd(), original.replaceAll('\n', '\r\n'), ` ${original}`, `\ufeff${original}`,
    original.replace('"kind":', '"kind":"ignored","kind":'), original.replace('"protected":true', '"protected":false,"protected":true'),
    Buffer.concat([Buffer.from('{"bad":"'), Buffer.from([0xff]), Buffer.from('"}\n')]), '{bad}\n', 'null\n'];
  for (const bytes of variants) { f.write('admission.json', bytes); assert.throws(f.read, fail); }
  f.write('admission.json', original);
  f.write('send.lock', line(f.reservation).replace('"event":', '"event":"ignored","event":'));
  assert.throws(f.read, /JSON_INVALID/);
  f.write('send.lock', line(f.reservation));
  f.write('original.jsonl', f.events.map(line).join('').replace('"event":', '"event":"ignored","event":'));
  assert.throws(f.read, /JSON_INVALID/);
});

test('admission structural, original authority, fences and protected source constraints survive repinning', t => {
  const f = fixture(t);
  for (const mutate of [a => { a.extra = true; }, a => { a.authority = 'caller'; }, a => { a.databaseName = 'other'; },
    a => { a.kind = 'successor'; }, a => { a.sourceTree = 'bad'; }, a => { a.sourceFilesSha256 = 'bad'; },
    a => { a.fences.generalFreeze = 'cleared'; }, a => { a.protectedMain.protected = false; },
    a => { a.protectedMain.branch = 'develop'; }, a => { a.protectedMain.sha = '0'.repeat(40); },
    a => { a.protectedMain.observedAt = '2020-01-01T00:00:01.000Z'; },
    a => { a.issuedAt = '2020-02-30T00:00:00.000Z'; }, a => { a.expiresAt = a.issuedAt; },
    a => { a.expiresAt = '2020-01-01T00:10:00.001Z'; },
  ]) {
    const a = copy(f.admission); mutate(a); f.write('admission.json', line(a));
    f.policy.admissionValueSha256 = sha(JSON.stringify(a));
    assert.throws(f.read, /BINDING_INVALID/);
  }
});

test('journal requires exactly the three original events: no reserved-only, acknowledgement, partial or extra events', t => {
  const f = fixture(t), serialized = f.events.map(line).join('');
  for (const bytes of [line(f.events[0]), f.events.slice(0, 2).map(line).join(''), serialized.trimEnd(),
    `${serialized}\n`, `${serialized}${line({ event: 'acknowledged', identity: f.identity })}`,
    `${serialized}{`, [f.events[1], f.events[0], f.events[2]].map(line).join(''),
    [f.events[0], f.events[1], { ...f.events[2], event: 'committed' }].map(line).join(''),
    [f.events[0], f.events[1], { ...f.events[2], sqlSha256: f.policy.sendSqlSha256 }].map(line).join(''),
  ]) { f.write('original.jsonl', bytes); assert.throws(f.read, fail); }
});

test('all journal and reservation identities and both emitted SQL hashes must match exactly', t => {
  const f = fixture(t);
  for (let i = 0; i < 3; i++) {
    for (const key of Object.keys(f.identity)) {
      const events = copy(f.events); events[i].identity[key] = 'different';
      f.write('original.jsonl', events.map(line).join('')); assert.throws(f.read, /BINDING_INVALID/);
    }
  }
  for (let i = 0; i < 2; i++) {
    const events = copy(f.events); events[i].sqlSha256 = '0'.repeat(64);
    f.write('original.jsonl', events.map(line).join('')); assert.throws(f.read, /BINDING_INVALID/);
  }
  f.write('original.jsonl', f.events.map(line).join(''));
  for (const reservation of [{ ...f.reservation, event: 'released' }, { ...f.reservation, extra: true },
    ...Object.keys(f.identity).map(key => ({ ...f.reservation, identity: { ...f.identity, [key]: 'different' } }))]) {
    f.write('send.lock', line(reservation)); assert.throws(f.read, /BINDING_INVALID/);
  }
});

test('prepared before-image rejects committed/partial ledgers and malformed state even with matching file hashes', t => {
  const f = fixture(t);
  for (const mutate of [b => { b.catalog = false; }, b => { b.identity = false; }, b => { b.extra = true; },
    b => { b.ledger.targets[0].present = true; }, b => { b.ledger.targets[1].equal = true; },
    b => { b.ledger.count = 97.5; }, b => { b.ledger.priorHash = 'bad'; }, b => { b.ledger.targets.reverse(); },
    b => { b.revision.value = '038'; }, b => { b.revision.value = '9223372036854775807'; },
    b => { b.revision.singletonCount = 0; }, b => { delete b.data.indexHash; },
    b => { b.data.businessCount = -1; }, b => { b.data.businessHash = 'bad'; },
    b => { b.data.cohortCount = 1669; }, b => { b.data.untouchedCount = 1669; },
  ]) {
    const events = copy(f.events); mutate(events[0].before);
    f.write('original.jsonl', events.map(line).join('')); assert.throws(f.read, /BEFORE_IMAGE_INVALID/);
  }
});

test('private directory and all three files must exist with exact modes, single links and regular types', t => {
  const f = fixture(t);
  fs.chmodSync(f.directory, 0o750); assert.throws(f.read, /CUSTODY_INVALID/); fs.chmodSync(f.directory, 0o700);
  fs.writeFileSync(join(f.directory, 'extra'), 'x'); assert.throws(f.read, fail); fs.unlinkSync(join(f.directory, 'extra'));
  for (const name of fileNames) {
    const path = join(f.directory, name), bytes = fs.readFileSync(path);
    for (const mode of [0o644, 0o400, 0o1600]) {
      fs.chmodSync(path, mode); assert.throws(f.read, /CUSTODY_INVALID/);
    }
    fs.chmodSync(path, 0o600); fs.unlinkSync(path); assert.throws(f.read, /CUSTODY_INVALID/);
    fs.mkdirSync(path, { mode: 0o600 }); assert.throws(f.read, /CUSTODY_INVALID/); fs.rmdirSync(path);
    fs.writeFileSync(path, bytes, { mode: 0o600 });
    const other = fixture(t), link = join(other.directory, 'link');
    fs.linkSync(path, link); assert.throws(f.read, /CUSTODY_INVALID/); fs.unlinkSync(link);
    fs.unlinkSync(path); fs.symlinkSync(join(other.directory, name), path); assert.throws(f.read, /CUSTODY_INVALID/);
    fs.unlinkSync(path); fs.writeFileSync(path, bytes, { mode: 0o600 });
  }
  assert.ok(f.read());
});

test('current owner, symlinked leaf/ancestor directories and bounded nonempty files are enforced', t => {
  const f = fixture(t), other = fixture(t), alias = join(other.directory, 'alias');
  fs.symlinkSync(f.directory, alias);
  assert.throws(() => readPredecessorCustody(f.policy, { directory: alias }), /CUSTODY_INVALID/);
  const child = join(f.directory, 'child'); fs.mkdirSync(child, { mode: 0o700 });
  assert.throws(() => readPredecessorCustody(f.policy, { directory: join(alias, 'child') }), /CUSTODY_INVALID/);
  fs.rmdirSync(child);
  const getuid = process.getuid;
  try { process.getuid = () => getuid() + 1; assert.throws(f.read, /CUSTODY_INVALID/); }
  finally { process.getuid = getuid; }
  for (const bytes of ['', Buffer.alloc(256 * 1024 + 1, 32)]) {
    f.write('admission.json', bytes); assert.throws(f.read, /CUSTODY_INVALID/);
  }
});

// These intercept only the timing of a real OS read. All bytes, permissions,
// renames and inode changes below occur on real files; no helper IO adapter exists.
test('capture detects concurrent append, same-size rewrite, replacement, chmod and directory replacement', t => {
  for (const change of ['append', 'rewrite', 'replace', 'chmod', 'directory']) {
    const f = fixture(t), originalRead = fs.readSync, path = join(f.directory, 'original.jsonl');
    let changed = false;
    try {
      fs.readSync = (...args) => {
        const count = originalRead(...args);
        if (!changed) {
          changed = true;
          if (change === 'append') fs.appendFileSync(path, 'x');
          if (change === 'rewrite') { const bytes = fs.readFileSync(path); bytes[0] = 32; fs.writeFileSync(path, bytes); }
          if (change === 'replace') { const bytes = fs.readFileSync(path); fs.unlinkSync(path); fs.writeFileSync(path, bytes, { mode: 0o600 }); }
          if (change === 'chmod') fs.chmodSync(path, 0o400);
          if (change === 'directory') {
            const moved = `${f.directory}-moved`; fs.renameSync(f.directory, moved);
            t.after(() => fs.rmSync(moved, { recursive: true, force: true }));
            fs.mkdirSync(f.directory, { mode: 0o700 });
            for (const name of fileNames) fs.copyFileSync(join(moved, name), join(f.directory, name));
          }
        }
        return count;
      };
      assert.throws(f.read, /CUSTODY_CHANGED/);
    } finally { fs.readSync = originalRead; }
    assert.equal(changed, true);
  }
});

test('final sweep detects changing an already rechecked file during the second capture of another file', t => {
  const f = fixture(t), originalRead = fs.readSync, lockInode = fs.statSync(join(f.directory, 'send.lock')).ino;
  let lockReads = 0, changed = false;
  try {
    fs.readSync = (...args) => {
      const count = originalRead(...args);
      if (fs.fstatSync(args[0]).ino === lockInode && ++lockReads === 3) {
        changed = true; fs.chmodSync(join(f.directory, 'admission.json'), 0o400);
      }
      return count;
    };
    assert.throws(f.read, /CUSTODY_CHANGED/);
  } finally { fs.readSync = originalRead; }
  assert.equal(changed, true);
});

test('fresh state equality covers every counter, digest, revision, ledger target and shape, not a local reconcile label', t => {
  const f = fixture(t), binding = f.read();
  assert.equal(assertPredecessorBeforeImage(binding, copy(f.before)), true);
  const reordered = Object.fromEntries(Object.entries(copy(f.before)).reverse());
  assert.equal(assertPredecessorBeforeImage(binding, reordered), true);
  assert.throws(() => assertPredecessorBeforeImage(copy(binding), f.before), /BINDING_INVALID/);
  const mutations = [s => { s.catalog = false; }, s => { s.identity = false; }, s => { s.extra = true; },
    s => { s.ledger.count++; }, s => { s.ledger.priorHash = '0'.repeat(64); }, s => { s.ledger.targets[0].present = true; },
    s => { s.ledger.targets[1].equal = true; }, s => { s.ledger.targets[0].version = '20261028225926'; },
    s => { s.revision.count++; }, s => { s.revision.singletonCount = 0; }, s => { s.revision.value = '39'; },
    s => { delete s.data.indexHash; }, s => { s.data.extra = true; },
    ...Object.keys(f.before.data).map(key => s => { s.data[key] = key.endsWith('Hash') ? '0'.repeat(64) : s.data[key] + 1; })];
  for (const mutate of mutations) {
    const actual = copy(f.before); mutate(actual);
    assert.throws(() => assertPredecessorBeforeImage(binding, actual), /BEFORE_IMAGE_MISMATCH/);
  }
  for (const actual of [null, { status: 'reconciled', disposition: 'not_applied_no_retry' },
    { readOnly: 'on', state: f.before }, { businessCount: 1668, cohortCount: 417, revision: 38, ledgerCount: 97 }]) {
    assert.throws(() => assertPredecessorBeforeImage(binding, actual), /BEFORE_IMAGE_MISMATCH/);
  }
  assert.equal(binding.remoteStateVerified, false); // Even equality does not manufacture remote evidence.
});

test('direct invocation rejects every mode/override without reading or altering fixture custody', t => {
  const f = fixture(t), saved = snapshot(f.directory);
  const script = fileURLToPath(new URL('../sponsorship-predecessor-custody.mjs', import.meta.url));
  for (const args of [[], ['--directory', f.directory], ['apply'], ['reconcile'], ['--help']]) {
    const child = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 10000 });
    assert.equal(child.status, 2); assert.equal(child.stdout, '');
    assert.equal(child.stderr, 'SPONSORSHIP_PREDECESSOR_LIBRARY_ONLY\n');
  }
  assert.deepEqual(snapshot(f.directory), saved);
});
