import { afterAll, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INSTALLATION_MANIFEST_PATH, INSTALLATION_MANIFEST_SHA256, boundedInstallationError,
  loadInstallationManifest, main } from '../scripts/restaurant-evidence-recovery-installation.mjs';
import { readOriginalStatementVector } from '../scripts/apply-supabase-migration.mjs';
import { atomicMigrationSql, migrationEnvelope } from '../scripts/supabase-migration-transaction.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const record = loadInstallationManifest();
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const project = 'aqlcofblfxdrjhhdmarw';
const revision = 'a'.repeat(40), tree = 'b'.repeat(40);
const directories: string[] = [];
// Operating admission requires POSIX ownership/modes; Windows stays fail-closed.
const posixTest = process.platform === 'win32' ? test.skip : test;
afterAll(() => { for (const path of directories) rmSync(path, { force: true, recursive: true }); });
const context = () => ({ repository: 'twoimo/tzudong', operator: 'twoimo', protected: true, clean: true,
  mainSha: revision, headSha: revision, remoteSha: revision, treeSha: tree,
  remoteUrl: 'https://github.com/twoimo/tzudong.git', freezeName: 'G037_WRITE_FREEZE', freezeValue: 'active' });
// Entirely synthetic transport credentials: never connect to this endpoint.
const environment = { SUPABASE_DB_URL: `postgresql://postgres:synthetic@db.${project}.supabase.co/postgres?sslmode=require` };
function fixture(update: any = {}) {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'recovery-install-test-')); directories.push(directory); chmodSync(directory, 0o700);
  const journal = join(directory, 'intent.jsonl'), admission = join(directory, 'admission.json');
  const value = { schemaVersion: 1, operator: 'twoimo', operationId: '11111111-1111-4111-8111-111111111111',
    projectRef: project, manifestSha256: record.manifestSha256, sqlSha256: record.migration.sha256,
    protectedMainSha: revision, treeSha: tree, issuedAt: new Date(Date.now() - 1000).toISOString(),
    expiresAt: new Date(Date.now() + 300000).toISOString(), journalPathSha256: sha(journal),
    freezeException: { variable: 'G037_WRITE_FREEZE', value: 'active', approvalRef: 'synthetic-unit-test-only' }, ...update };
  writeFileSync(admission, JSON.stringify(value), { mode: 0o600 });
  return { directory, admission, journal, value, args: ['--apply', '--admission', admission, '--journal', journal] };
}
function rejected(args: string[], code: string, overrides: any = {}) {
  let databaseCalls = 0, contextCalls = 0;
  expect(() => main(args, { environment, readLiveContext: () => { contextCalls++; return context(); },
    runPsqlImpl: () => { databaseCalls++; throw Error('synthetic-private-uri-must-not-escape'); }, ...overrides })).toThrow(code);
  expect(databaseCalls).toBe(0);
  return contextCalls;
}
const prior = JSON.stringify(record.migration.expectedPriorState.expected);
const terminal = JSON.stringify(record.migration.terminalReadback.expected);

test('dedicated manifest and original compiler bind exact SQL and frozen legacy bytes', () => {
  const document = JSON.parse(readFileSync(INSTALLATION_MANIFEST_PATH, 'utf8'));
  expect(sha(readFileSync(INSTALLATION_MANIFEST_PATH))).toBe(INSTALLATION_MANIFEST_SHA256);
  expect(document.migration).toEqual(record.migration);
  expect(record.migration.sha256).toBe('55e3c61f20d1c7c24dd7c5cd000d2a081ddf65c8ca3657621d4b222b6062acc4');
  expect(document.legacyManifest.sha256).toBe('515743d094b4b431a29df772a363837bdad8f7541aa3acf4a923efb79f460c0d');
  for (const item of [document.legacyManifest, ...document.helpers, document.migration]) {
    expect(sha(readFileSync(resolve(root, item.path)))).toBe(item.sha256);
  }
  const vector = readOriginalStatementVector(record.migration, Buffer.from(record.query));
  expect(vector.length).toBeGreaterThan(1);
  expect(atomicMigrationSql(migrationEnvelope(Buffer.from(record.query), record.migration, vector), record.migration)).toContain('BEGIN');
});
test('default dry-run needs no credentials, context read, or database transport', () => {
  let reads = 0;
  const value = main([], { environment: {}, readLiveContext: () => { reads++; throw Error(); }, runPsqlImpl: () => { reads++; throw Error(); } });
  expect(value.mode).toBe('dry-run'); expect(value.migrationApplied).toBe(false); expect(reads).toBe(0);
  expect(main(['--dry-run'], { environment: {} })).toEqual(value);
});
test('strict CLI accepts no query, path, digest override, duplicate mode or incomplete apply', () => {
  for (const args of [['--query', 'private'], ['--manifest', '/tmp/other'], ['--sha256', 'a'.repeat(64)],
    ['--apply'], ['--dry-run', '--apply'], ['--verify-terminal-state', '--journal', '/tmp/journal']]) {
    rejected(args, 'INSTALL_ARGUMENT_INVALID');
  }
});
test('missing admission rejects before any live context or database', () => {
  expect(rejected(['--apply', '--admission', '/absent/synthetic-admission', '--journal', '/absent/journal'], 'INSTALL_ADMISSION_INVALID')).toBe(0);
});
posixTest('every admission binding and scoped freeze exception is required before database', () => {
  for (const update of [{ projectRef: 'wrong' }, { operator: 'other' }, { operationId: 'not-uuid' },
    { manifestSha256: 'f'.repeat(64) }, { sqlSha256: 'f'.repeat(64) }, { protectedMainSha: 'bad' },
    { treeSha: 'bad' }, { journalPathSha256: 'f'.repeat(64) }, { unexpected: true },
    { freezeException: { variable: 'G037_WRITE_FREEZE', value: 'cleared', approvalRef: 'synthetic' } },
    { freezeException: { variable: 'G037_WRITE_FREEZE', value: 'active', approvalRef: '' } }]) {
    rejected(fixture(update).args, 'INSTALL_ADMISSION_INVALID');
  }
});
posixTest('expired, future or longer-than-15-minute admissions reject before database', () => {
  for (const update of [{ expiresAt: new Date(Date.now() - 1000).toISOString() },
    { issuedAt: new Date(Date.now() + 10000).toISOString() },
    { expiresAt: new Date(Date.now() + 901000).toISOString() }, { expiresAt: 'invalid' }]) {
    rejected(fixture(update).args, 'INSTALL_ADMISSION_EXPIRED');
  }
});
posixTest('admission symlink, non-private file and non-private journal directory reject', () => {
  const first = fixture(); const link = join(first.directory, 'linked.json'); symlinkSync(first.admission, link);
  rejected(['--apply', '--admission', link, '--journal', first.journal], 'INSTALL_ADMISSION_INVALID');
  chmodSync(first.admission, 0o644); rejected(first.args, 'INSTALL_ADMISSION_INVALID');
  const second = fixture(); chmodSync(second.directory, 0o755); rejected(second.args, 'INSTALL_JOURNAL_INVALID');
});
posixTest('live actor, protected main, local HEAD/tree, remote and unchanged active G037 all bind before database', () => {
  for (const update of [{ operator: 'other-account' }, { repository: 'other/repo' }, { protected: false }, { clean: false },
    { mainSha: 'c'.repeat(40) }, { headSha: 'c'.repeat(40) }, { treeSha: 'c'.repeat(40) },
    { remoteSha: 'c'.repeat(40) }, { remoteUrl: 'https://github.com/other/tzudong.git' },
    { freezeValue: 'cleared' }, { freezeName: 'other' }]) {
    rejected(fixture().args, 'INSTALL_CONTEXT_INVALID', { readLiveContext: () => ({ ...context(), ...update }) });
  }
});
posixTest('only exact direct project or project-bound session pooler usernames admit a database', () => {
  const f = fixture();
  const wrongProject = new URL(environment.SUPABASE_DB_URL);
  wrongProject.hostname = 'db.wrong.supabase.co';
  const wrongPoolerUser = new URL(environment.SUPABASE_DB_URL);
  wrongPoolerUser.hostname = 'aws-0-ap-northeast-2.pooler.supabase.com';
  wrongPoolerUser.username = 'postgres.wrong';
  for (const url of [wrongProject.toString(), wrongPoolerUser.toString(),
    environment.SUPABASE_DB_URL.replace('?sslmode=require', ''),
    environment.SUPABASE_DB_URL.replace('/postgres?', '/other?'),
    environment.SUPABASE_DB_URL.replace('.co/postgres', '.co:6543/postgres')]) {
    rejected(f.args, 'INSTALL_TARGET_INVALID', { environment: { SUPABASE_DB_URL: url } });
  }
});
test('verify-only uses an explicit READ ONLY transaction and cannot claim installation', () => {
  let calls = 0;
  const value = main(['--verify-terminal-state'], { environment, readLiveContext: () => { throw Error('no context needed'); },
    runPsqlImpl: (_url: string, sql: string, transaction: boolean) => {
      calls++; expect(sql.startsWith('BEGIN READ ONLY;')).toBe(true); expect(sql.endsWith('ROLLBACK;\n')).toBe(true);
      expect(sql).toContain(record.migration.terminalReadback.query); expect(transaction).toBe(false); return terminal;
    } });
  expect(calls).toBe(1); expect(value.migrationApplied).toBe(false);
});
posixTest('false or malformed prior precondition prevents journal creation and DDL', () => {
  for (const output of ['{}', 'private-invalid-json', '{"restaurant_evidence_recovery_absent":false}']) {
    const f = fixture(); let calls = 0;
    expect(() => main(f.args, { environment, readLiveContext: context, runPsqlImpl: () => { calls++; return output; } })).toThrow('INSTALL_PRIOR_MISMATCH');
    expect(calls).toBe(1); expect(existsSync(f.journal)).toBe(false);
  }
});
posixTest('fresh context and expiry are checked again after precondition, before durable DDL intent', () => {
  const f = fixture(); let contexts = 0, calls = 0;
  expect(() => main(f.args, { environment,
    readLiveContext: () => ({ ...context(), operator: ++contexts === 1 ? 'twoimo' : 'other' }),
    runPsqlImpl: () => { calls++; return prior; } })).toThrow('INSTALL_CONTEXT_INVALID');
  expect(calls).toBe(1); expect(existsSync(f.journal)).toBe(false);
});
posixTest('exclusive fsynced 0600 intent precedes one DDL, then fixed confirmed outcome', () => {
  const f = fixture(); let calls = 0;
  const value = main(f.args, { environment, readLiveContext: context, runPsqlImpl: (_url: string, sql: string, transaction: boolean) => {
    calls++; if (calls === 1) { expect(sql.startsWith('BEGIN READ ONLY;')).toBe(true); expect(existsSync(f.journal)).toBe(false); return prior; }
    expect(lstatSync(f.journal).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(f.journal, 'utf8')).stage).toBe('ddl_intent'); expect(transaction).toBe(true); return terminal;
  } });
  expect(calls).toBe(2); expect(value.migrationApplied).toBe(true);
  const journal = readFileSync(f.journal, 'utf8');
  expect(journal.trim().split('\n').map(line => JSON.parse(line).stage)).toEqual(['ddl_intent', 'confirmed']);
  expect(journal).not.toContain('synthetic'); expect(journal).not.toContain('postgresql:');
  rejected(f.args, 'INSTALL_JOURNAL_EXISTS');
});
posixTest('uncertain ACK reconciles exactly once, persists unconfirmed and never replays existing intent', () => {
  const f = fixture(); let calls = 0;
  expect(() => main(f.args, { environment, readLiveContext: context, runPsqlImpl: () => {
    calls++; if (calls === 1) return prior;
    if (calls === 2) throw Error('private-database-uri-and-payload-canary');
    return JSON.stringify({ ledger_exists: true, ledger_equal: true, prior: null, terminal: record.migration.terminalReadback.expected });
  } })).toThrow('INSTALL_OUTCOME_UNCONFIRMED');
  expect(calls).toBe(3);
  const journal = readFileSync(f.journal, 'utf8');
  expect(journal.trim().split('\n').map(line => JSON.parse(line).stage)).toEqual(['ddl_intent', 'unconfirmed']);
  expect(journal).not.toContain('canary'); rejected(f.args, 'INSTALL_JOURNAL_EXISTS');
});
posixTest('existing empty, truncated, symlink and uncertain journals all prohibit database dispatch', () => {
  for (const content of ['', '{truncated', '{"stage":"unconfirmed"}\n']) {
    const f = fixture(); writeFileSync(f.journal, content, { mode: 0o600 }); rejected(f.args, 'INSTALL_JOURNAL_EXISTS');
  }
  const f = fixture(); symlinkSync(join(f.directory, 'absent'), f.journal); rejected(f.args, 'INSTALL_JOURNAL_EXISTS');
});
posixTest('errors expose fixed codes even if a transport contains private diagnostics', () => {
  const f = fixture();
  expect(() => main(f.args, { environment, readLiveContext: context, runPsqlImpl: () => { throw Error('private-canary'); } })).toThrow('INSTALL_OUTCOME_UNCONFIRMED');
  expect(boundedInstallationError(Error('private-canary')).message).toBe('INSTALL_OUTCOME_UNCONFIRMED');
});
