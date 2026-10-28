import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  appendFileSync, chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync,
  readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  OriginalJournal, executeSponsorship, expectedTerminal, identityFor,
  loadRecord, MANIFEST_SHA256,
} from '../scripts/sponsorship-sql-successor.mjs';

const posixCustodySuite = {
  skip: process.platform === 'win32'
    ? 'Requires POSIX UID and 0700/0600 mode enforcement; process.getuid() is unavailable on Windows.'
    : false,
};
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const line = (value: unknown) => JSON.stringify(value) + '\n';
const operationId = '12345678-1234-4234-8234-123456789abc';
const first = () => ({ event: 'prepared', identity: { operationId },
  before: { fixture: 'synthetic preimage' }, sqlSha256: hash('synthetic SQL') });

function withPrivateDirectory(run: (directory: string) => void) {
  // macOS tmpdir may traverse /var -> /private/var; custody requires a real path.
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'tzudong-sponsorship-journal-'));
  try {
    chmodSync(directory, 0o700);
    assert.equal(statSync(directory).mode & 0o777, 0o700);
    run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

class FailingAppendJournal extends OriginalJournal {
  append(_value: unknown) { throw new Error('synthetic journal append failure'); }
}

describe('sponsorship original journal durable reservation', posixCustodySuite, () => {
  it('reopens an unspent preflight, reserves once, and retains identity and intent after reopening', () => {
    withPrivateDirectory(directory => {
      const prepared = first();
      const journal = new OriginalJournal({ directory });
      assert.equal(journal.read(), null);
      journal.prepare(prepared);
      const reopened = new OriginalJournal({ directory });
      assert.deepEqual(reopened.read(), { first: prepared, spent: false, partialTail: false });
      assert.throws(() => reopened.prepare(prepared), { code: 'EEXIST' });
      reopened.spend(prepared);

      const recovered = new OriginalJournal({ directory });
      assert.deepEqual(recovered.read(), { first: prepared, spent: true, partialTail: false });
      assert.deepEqual(JSON.parse(readFileSync(recovered.lock, 'utf8')), {
        identity: prepared.identity, event: 'send_reserved',
      });
      const events = readFileSync(recovered.path, 'utf8').trimEnd().split('\n').map(value => JSON.parse(value));
      assert.deepEqual(events, [prepared, { identity: prepared.identity,
        event: 'send_intent', sqlSha256: prepared.sqlSha256 }]);
      assert.equal(statSync(recovered.path).mode & 0o777, 0o600);
      assert.equal(statSync(recovered.lock).mode & 0o777, 0o600);
      assert.throws(() => recovered.spend(prepared), /SPONSORSHIP_RECONCILE_REQUIRED/);
    });
  });

  it('retains a durable reservation without send_intent when append fails, including after reopening', () => {
    withPrivateDirectory(directory => {
      const prepared = first();
      const journal = new FailingAppendJournal({ directory });
      journal.prepare(prepared);
      assert.throws(() => journal.spend(prepared), /synthetic journal append failure/);
      assert.equal(readFileSync(journal.path, 'utf8'), line(prepared));

      const recovered = new OriginalJournal({ directory });
      assert.deepEqual(recovered.read(), { first: prepared, spent: true, partialTail: false });
      assert.deepEqual(JSON.parse(readFileSync(recovered.lock, 'utf8')).identity, prepared.identity);
      assert.throws(() => recovered.spend(prepared), /SPONSORSHIP_RECONCILE_REQUIRED/);
      assert.equal(readFileSync(recovered.path, 'utf8'), line(prepared));
    });
  });

  it('infers spent from a partial tail without a send.lock or a supplied spent boolean', () => {
    withPrivateDirectory(directory => {
      const journal = new OriginalJournal({ directory }), prepared = first();
      journal.prepare(prepared);
      appendFileSync(journal.path, '{"event":"send_int');
      assert.equal(existsSync(journal.lock), false);
      const recovered = new OriginalJournal({ directory });
      assert.deepEqual(recovered.read(), { first: prepared, spent: true, partialTail: true });
      assert.throws(() => recovered.spend(prepared), /SPONSORSHIP_RECONCILE_REQUIRED/);
      assert.equal(existsSync(journal.lock), false);
    });
  });

  it('treats multiple complete records as spent even without a send.lock', () => {
    withPrivateDirectory(directory => {
      const journal = new OriginalJournal({ directory }), prepared = first();
      journal.prepare(prepared);
      journal.append({ event: 'send_intent', identity: prepared.identity });
      const recovered = new OriginalJournal({ directory });
      assert.equal(existsSync(recovered.lock), false);
      assert.deepEqual(recovered.read(), { first: prepared, spent: true, partialTail: false });
      assert.throws(() => recovered.spend(prepared), /SPONSORSHIP_RECONCILE_REQUIRED/);
    });
  });

  it('uses O_EXCL to deny a contender that read before another instance reserved', () => {
    withPrivateDirectory(directory => {
      const prepared = first(), winner = new OriginalJournal({ directory });
      winner.prepare(prepared);
      // Deterministically interleave two real instances at the read/open race.
      // The contender returns the actual disk observation from before reservation.
      class InterleavedJournal extends OriginalJournal {
        read() {
          const observation = super.read();
          winner.spend(prepared);
          return observation;
        }
      }
      const contender = new InterleavedJournal({ directory });
      assert.throws(() => contender.spend(prepared), { code: 'EEXIST' });
      const recovered = new OriginalJournal({ directory });
      assert.deepEqual(recovered.read()?.first.identity, prepared.identity);
      assert.equal(recovered.read()?.spent, true);
      const events = readFileSync(recovered.path, 'utf8').trimEnd().split('\n').map(value => JSON.parse(value));
      assert.equal(events.filter(event => event.event === 'send_intent').length, 1);
      assert.throws(() => recovered.spend(prepared), /SPONSORSHIP_RECONCILE_REQUIRED/);
    });
  });
});

describe('sponsorship original journal invalid custody and records', posixCustodySuite, () => {
  for (const [name, contents] of [
    ['empty first record', ''],
    ['malformed complete first record', '{"event":}\n'],
    ['truncated first record', '{"event":"prepared"'],
    ['complete first JSON without its durable newline', JSON.stringify(first())],
    ['malformed complete later record', line(first()) + '{"event":}\n'],
  ]) {
    it(`fails closed for ${name}`, () => {
      withPrivateDirectory(directory => {
        const journal = new OriginalJournal({ directory });
        writeFileSync(journal.path, contents, { mode: 0o600, flag: 'wx' });
        const recovered = new OriginalJournal({ directory });
        assert.throws(() => recovered.read(), /SPONSORSHIP_JOURNAL_UNCONFIRMED/);
        assert.throws(() => recovered.spend(first()), /SPONSORSHIP_JOURNAL_UNCONFIRMED/);
        assert.equal(existsSync(recovered.lock), false);
      });
    });
  }

  for (const unsafe of ['oversized', 'public permissions', 'symlink', 'hardlink', 'directory']) {
    it(`rejects an ${unsafe} journal before reserving or appending`, () => {
      withPrivateDirectory(directory => {
        const journal = new OriginalJournal({ directory });
        if (unsafe === 'directory') {
          mkdirSync(journal.path, { mode: 0o700 });
        } else if (unsafe === 'symlink') {
          const target = join(directory, 'owned-target.jsonl');
          writeFileSync(target, line(first()), { mode: 0o600, flag: 'wx' });
          symlinkSync(target, journal.path);
        } else {
          writeFileSync(journal.path, unsafe === 'oversized' ? Buffer.alloc(256 * 1024 + 1) : line(first()),
            { mode: 0o600, flag: 'wx' });
          if (unsafe === 'public permissions') chmodSync(journal.path, 0o644);
          if (unsafe === 'hardlink') linkSync(journal.path, join(directory, 'owned-hardlink.jsonl'));
        }
        const recovered = new OriginalJournal({ directory });
        assert.throws(() => recovered.read(), /SPONSORSHIP_CUSTODY_INVALID/);
        assert.throws(() => recovered.spend(first()), /SPONSORSHIP_CUSTODY_INVALID/);
        assert.throws(() => recovered.append({ event: 'must_not_append' }), /SPONSORSHIP_CUSTODY_INVALID/);
        assert.equal(existsSync(recovered.lock), false);
      });
    });
  }

  it('rejects a public or symlinked custody directory', () => {
    withPrivateDirectory(directory => {
      const publicDirectory = join(directory, 'public');
      mkdirSync(publicDirectory, { mode: 0o700 });
      chmodSync(publicDirectory, 0o755);
      assert.throws(() => new OriginalJournal({ directory: publicDirectory }), /SPONSORSHIP_CUSTODY_INVALID/);
      const alias = join(directory, 'alias');
      symlinkSync(directory, alias);
      assert.throws(() => new OriginalJournal({ directory: alias }), /SPONSORSHIP_CUSTODY_INVALID/);
    });
  });
});

function integrationFixture(directory: string) {
  const record = loadRecord();
  const instant = new Date('2026-10-29T01:00:00Z');
  const source = { revision: 'a'.repeat(40), tree: 'b'.repeat(40), clean: true,
    repositoryMatched: true, filesSha256: 'c'.repeat(64) };
  const admission = {
    kind: 'sponsorship_scoped_admission_v1', authority: 'authenticated-repository-owner-local-cli',
    operationId, projectRef: record.manifest.projectRef, databaseName: 'postgres',
    manifestSha256: MANIFEST_SHA256, migrationSha256: record.manifest.migration.sha256,
    vectorSha256: record.manifest.statementVectorSha256, scopeSha256: hash(JSON.stringify(record.manifest.scope)),
    sourceRevision: source.revision, sourceTree: source.tree, sourceFilesSha256: source.filesSha256,
    issuedAt: instant.toISOString(), expiresAt: new Date(instant.getTime() + 300000).toISOString(),
    fences: structuredClone(record.manifest.fences), protectedMain: {
      repository: 'twoimo/tzudong', branch: 'main', sha: source.revision, protected: true,
      observedAt: instant.toISOString(),
    },
  };
  const prior = { identity: true, catalog: true,
    ledger: { count: 97, priorHash: record.manifest.priorLedger.sha256, targetPresent: false, targetEqual: false },
    data: { businessCount: 3, businessHash: hash('synthetic business rows'),
      cohortCount: 2, cohortHash: hash('synthetic selected keys'), indexCount: 3,
      indexHash: hash('synthetic derived values'), untouchedCount: 1, untouchedHash: hash('synthetic outside cohort') } };
  const replies: (string | Error)[] = [JSON.stringify({ readOnly: 'on', state: prior })];
  const calls: { sql: string; readOnly: boolean }[] = [];
  const databaseTarget = new URL(`postgres://db.${record.manifest.projectRef}.supabase.co:5432/postgres`);
  databaseTarget.username = 'postgres';
  databaseTarget.password = 'synthetic-fixture';
  const options = { record, admission,
    databaseUrl: databaseTarget.toString(),
    journal: new OriginalJournal({ directory }), now: () => instant,
    readSource: () => ({ ...source }), readAdmission: () => structuredClone(admission),
    readFences: () => ({ generalFreeze: 'active', githubProducer: 'disabled_manually' }),
    readProtectedMain: () => ({ ...admission.protectedMain }),
    transport: (_url: string, sql: string, singleTransaction: boolean) => {
      assert.equal(singleTransaction, true);
      calls.push({ sql, readOnly: sql.startsWith('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;') });
      const reply = replies.shift();
      if (reply instanceof Error) throw reply;
      assert.equal(typeof reply, 'string', 'unexpected extra transport call');
      return reply;
    },
  };
  return { options, record, admission, prior, replies, calls };
}

describe('sponsorship execution with a real private original journal', posixCustodySuite, () => {
  it('reconciles an uncertain send read-only after reopening and denies every second apply', () => {
    withPrivateDirectory(directory => {
      const f = integrationFixture(directory);
      const prepared = executeSponsorship('preflight', f.options);
      const identity = identityFor(f.record, f.admission);
      assert.deepEqual(prepared.identity, identity);
      f.options.journal = new OriginalJournal({ directory });
      f.replies.push(new Error('synthetic lost acknowledgement'));
      const uncertain = executeSponsorship('apply', f.options);
      assert.equal(uncertain.status, 'unconfirmed');
      assert.deepEqual(uncertain.identity, identity);
      assert.equal(uncertain.replayAllowed, false);

      f.options.journal = new OriginalJournal({ directory });
      assert.equal(f.options.journal.read()?.spent, true);
      assert.deepEqual(f.options.journal.read()?.first.identity, identity);
      assert.throws(() => executeSponsorship('apply', f.options), /SPONSORSHIP_RECONCILE_REQUIRED/);
      assert.equal(f.calls.length, 2);
      f.replies.push(JSON.stringify({ readOnly: 'on', state: {
        prior: { ...f.prior, catalog: false }, terminal: expectedTerminal(f.record),
      } }));
      const reconciled = executeSponsorship('reconcile', f.options);
      assert.equal(reconciled.status, 'reconciled');
      assert.equal(reconciled.disposition, 'committed');
      assert.deepEqual(reconciled.identity, identity);
      assert.equal(reconciled.replayAllowed, false);
      assert.equal(f.calls[2].readOnly, true);

      f.options.journal = new OriginalJournal({ directory });
      assert.throws(() => executeSponsorship('apply', f.options), /SPONSORSHIP_RECONCILE_REQUIRED/);
      assert.equal(f.calls.length, 3);
      assert.deepEqual(f.calls.map(call => call.readOnly), [true, false, true]);
      assert.deepEqual(f.options.journal.read()?.first.identity, identity);
      assert.deepEqual(JSON.parse(readFileSync(f.options.journal.lock, 'utf8')).identity, identity);
    });
  });

  it('keeps the original spent when acknowledgement and fallback appends both fail after send', () => {
    withPrivateDirectory(directory => {
      const f = integrationFixture(directory);
      executeSponsorship('preflight', f.options);
      class FailAfterIntentJournal extends OriginalJournal {
        append(value: { event: string }) {
          if (value.event !== 'send_intent') throw new Error('synthetic post-send append failure');
          super.append(value);
        }
      }
      f.options.journal = new FailAfterIntentJournal({ directory });
      f.replies.push(JSON.stringify(expectedTerminal(f.record)));
      assert.equal(executeSponsorship('apply', f.options).status, 'unconfirmed');
      f.options.journal = new OriginalJournal({ directory });
      assert.equal(f.options.journal.read()?.spent, true);
      assert.deepEqual(f.options.journal.read()?.first.identity, identityFor(f.record, f.admission));
      assert.throws(() => executeSponsorship('apply', f.options), /SPONSORSHIP_RECONCILE_REQUIRED/);
      assert.equal(f.calls.filter(call => !call.readOnly).length, 1);
      assert.equal(f.calls.length, 2);
    });
  });
});
