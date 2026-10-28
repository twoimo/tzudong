#!/usr/bin/env node
/** One atomic two-migration sponsorship bundle. prepare is offline; preflight/reconcile are read only.
 * The common serializer is NOT authority. One fresh private scope receipt and one
 * permanent original journal bind source, preimage and the only possible send.
 * The DB-only source ships through develop -> data -> protected main first.
 * No feature-head ancestry is assumed; fresh external main readback binds apply.
 * No rollback rehearsal: GraphQL DDL cache sequences are nontransactional.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { constants, closeSync, existsSync, fstatSync, fsyncSync, lstatSync, openSync,
  readFileSync, realpathSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { migrationEnvelope, atomicMigrationSql } from './supabase-migration-transaction.mjs';
import { selectDirectDatabaseTransport, readOriginalStatementVector } from './apply-supabase-migration.mjs';
import { assertSuccessorDatabaseTarget } from './admin-record-sql-successor.mjs';
import { createThumbnailPsqlRunner } from './thumbnail-production-successor.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const MANIFEST_PATH = '.github/sponsorship-sql-successor.v1.json';
export const SCRIPT_PATH = 'apps/web/scripts/sponsorship-sql-successor.mjs';
export const MANIFEST_SHA256 = '4c6e9e290d54a596a4a36aa998dc394a9a0e825a57a38daf9e469564810ae2e1';
export const CUSTODY = join(homedir(), '.local/state/tzudong-sponsorship-sql-successor', 'aqlcofblfxdrjhhdmarw', MANIFEST_SHA256);
const MAX_BYTES = 256 * 1024;
const sha = value => createHash('sha256').update(value).digest('hex');
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
const json = value => `${quote(JSON.stringify(value))}::jsonb`;
const equal = isDeepStrictEqual;
const fail = code => { const error = new Error(code); error.code = code; throw error; };
const hashPattern = /^[a-f0-9]{64}$/;
const admissionKeys = ['kind', 'authority', 'operationId', 'projectRef', 'databaseName', 'manifestSha256',
  'bundleSha256', 'scopeSha256', 'sourceRevision', 'sourceTree', 'sourceFilesSha256',
  'issuedAt', 'expiresAt', 'fences', 'protectedMain'];
const protectedMainKeys = ['repository', 'branch', 'sha', 'protected', 'observedAt'];
function regular(path) {
  if (realpathSync(path) !== resolve(path) || !lstatSync(path).isFile()) fail('SPONSORSHIP_SOURCE_FILE_INVALID');
  return readFileSync(path);
}
export function loadRecord({ read = p => regular(resolve(ROOT, p)) } = {}) {
  const raw = read(MANIFEST_PATH);
  if (sha(raw) !== MANIFEST_SHA256) fail('SPONSORSHIP_MANIFEST_DRIFT');
  const manifest = JSON.parse(raw);
  const bytes = manifest.migrations.map(migration => read(migration.path));
  for (const [path, digest] of Object.entries(manifest.dependencies)) {
    if (sha(read(path)) !== digest) fail('SPONSORSHIP_DEPENDENCY_DRIFT');
  }
  const plans = manifest.migrations.map((migration, i) => {
    const plan = migrationEnvelope(bytes[i], migration, migration.originalStatementVector);
    if (!equal(readOriginalStatementVector(migration, bytes[i]), migration.originalStatementVector)) fail('SPONSORSHIP_VECTOR_DRIFT');
    return plan;
  });
  const record = { raw, bytes, manifest, plans };
  assertRecord(record);
  return record;
}
function assertRecord(record) {
  if (!record || sha(record.raw) !== MANIFEST_SHA256 || !equal(JSON.parse(record.raw), record.manifest)) fail('SPONSORSHIP_MANIFEST_DRIFT');
  const m = record.manifest;
  if (m.schemaVersion !== 2 || m.migrations.length !== 2 || record.bytes.length !== 2 || record.plans.length !== 2
    || sha(JSON.stringify(m.migrations.map(({ path, sha256, statementVectorSha256 }) => ({ path, sha256, statementVectorSha256 })))) !== m.bundleSha256) fail('SPONSORSHIP_VECTOR_DRIFT');
  for (const [i, migration] of m.migrations.entries()) {
    const plan = migrationEnvelope(record.bytes[i], migration, migration.originalStatementVector);
    if (!equal(plan, record.plans[i]) || plan.vectorSha256 !== migration.statementVectorSha256
      || plan.originalVector.length !== [5, 1][i]
      || plan.version !== ['20261028195647', '20261028225926'][i]) fail('SPONSORSHIP_VECTOR_DRIFT');
  }
}
function git(args) {
  const p = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', timeout: 15000 });
  if (p.error || p.status !== 0) fail('SPONSORSHIP_SOURCE_UNVERIFIED');
  return p.stdout.trim();
}
export function currentSource(record) {
  const paths = [MANIFEST_PATH, SCRIPT_PATH, ...record.manifest.migrations.map(m => m.path), ...Object.keys(record.manifest.dependencies)].sort();
  const files = paths.map(path => [path, sha(regular(resolve(ROOT, path)))]);
  const origin = git(['remote', 'get-url', 'origin']);
  return { revision: git(['rev-parse', 'HEAD']), tree: git(['rev-parse', 'HEAD^{tree}']),
    clean: git(['status', '--porcelain']) === '',
    repositoryMatched: ['https://github.com/twoimo/tzudong.git', 'git@github.com:twoimo/tzudong.git'].includes(origin),
    filesSha256: sha(JSON.stringify(files)) };
}
export function validateAdmission(record, admission, source, now, { reconcile = false } = {}) {
  assertRecord(record);
  const m = record.manifest;
  if (!admission || !equal(Object.keys(admission).sort(), [...admissionKeys].sort())
    || admission.kind !== 'sponsorship_scoped_admission_v2'
    || admission.authority !== 'authenticated-repository-owner-local-cli'
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(admission.operationId)
    || admission.projectRef !== m.projectRef || admission.databaseName !== m.databaseName
    || admission.manifestSha256 !== MANIFEST_SHA256 || admission.bundleSha256 !== m.bundleSha256
    || admission.scopeSha256 !== sha(JSON.stringify(m.scope))
    || !equal(admission.fences, m.fences) || source.clean !== true || source.repositoryMatched !== true
    || !/^[a-f0-9]{40}$/.test(source.revision) || !/^[a-f0-9]{40}$/.test(source.tree) || !hashPattern.test(source.filesSha256)
    || admission.sourceRevision !== source.revision || admission.sourceTree !== source.tree
    || admission.sourceFilesSha256 !== source.filesSha256) fail('SPONSORSHIP_ADMISSION_BINDING_INVALID');
  const issued = Date.parse(admission.issuedAt), expires = Date.parse(admission.expiresAt), at = now.getTime();
  if (![issued, expires, at].every(Number.isFinite) || issued >= expires || expires - issued > 600000
    || (!reconcile && (issued > at || at >= expires))) fail('SPONSORSHIP_ADMISSION_EXPIRED');
  const main = admission.protectedMain, observed = Date.parse(main?.observedAt);
  if (!main || !equal(Object.keys(main).sort(), [...protectedMainKeys].sort())
    || main.repository !== m.sourcePolicy.repository || main.branch !== m.sourcePolicy.branch
    || main.protected !== true || main.sha !== admission.sourceRevision || !Number.isFinite(observed)
    || observed > issued || issued - observed > m.sourcePolicy.receiptFreshnessSeconds * 1000) fail('SPONSORSHIP_PROTECTED_MAIN_RECEIPT_INVALID');
}
export function validateProtectedMain(record, admission, source, observation, now) {
  const observed = Date.parse(observation?.observedAt), at = now.getTime();
  if (!observation || !equal(Object.keys(observation).sort(), [...protectedMainKeys].sort())
    || observation.repository !== record.manifest.sourcePolicy.repository || observation.branch !== 'main'
    || observation.protected !== true || observation.sha !== admission.protectedMain.sha || observation.sha !== source.revision
    || !Number.isFinite(observed) || !Number.isFinite(at) || observed > at
    || at - observed > record.manifest.sourcePolicy.receiptFreshnessSeconds * 1000) fail('SPONSORSHIP_PROTECTED_MAIN_DRIFT');
}

// Only builtin projections are used in preflight. IDs and business values remain
// inside the server aggregate. The stable ledger hash excludes ONLY our version.
const candidate = `coalesce(jsonb_typeof(r.youtube_meta)='object'
 AND jsonb_typeof(r.youtube_meta->'title')='string' AND jsonb_typeof(r.youtube_meta->'publishedAt')='string'
 AND jsonb_typeof(r.youtube_meta->'is_shorts')='boolean' AND jsonb_typeof(r.youtube_meta->'duration')='number',false)
 AND NOT coalesce(jsonb_typeof(r.youtube_meta->'ads_info')='object'
 AND jsonb_typeof(r.youtube_meta#>'{ads_info,is_ads}')='boolean'
 AND jsonb_typeof(r.youtube_meta#>'{ads_info,what_ads}') IN ('string','null'),false)`;
const digestRows = expression => `encode(sha256(convert_to(coalesce(${expression},''),'UTF8')),'hex')`;
const dataExpression = `jsonb_build_object(
 'businessCount',(SELECT count(*) FROM public.restaurants),
 'businessHash',(SELECT ${digestRows("string_agg(to_jsonb(r)::text,E'\\n' ORDER BY r.id)")} FROM public.restaurants r),
 'cohortCount',(SELECT count(*) FROM public.restaurants r WHERE ${candidate}),
 'cohortHash',(SELECT ${digestRows("string_agg(r.id::text,E'\\n' ORDER BY r.id)")} FROM public.restaurants r WHERE ${candidate}),
 'indexCount',(SELECT count(*) FROM pipeline_control.admin_evaluation_read_index),
 'indexHash',(SELECT ${digestRows("string_agg(to_jsonb(i)::text,E'\\n' ORDER BY i.id)")} FROM pipeline_control.admin_evaluation_read_index i),
 'untouchedCount',(SELECT count(*) FROM pipeline_control.admin_evaluation_read_index i WHERE NOT EXISTS(SELECT 1 FROM public.restaurants r WHERE r.id=i.id AND ${candidate})),
 'untouchedHash',(SELECT ${digestRows("string_agg(to_jsonb(i)::text,E'\\n' ORDER BY i.id)")} FROM pipeline_control.admin_evaluation_read_index i WHERE NOT EXISTS(SELECT 1 FROM public.restaurants r WHERE r.id=i.id AND ${candidate})))`;
const identity = `current_database()='postgres' AND current_user='postgres' AND session_user='postgres'
 AND current_setting('server_version_num')='170006' AND current_setting('is_superuser')='off'
 AND (SELECT rolbypassrls AND NOT rolsuper FROM pg_roles WHERE rolname=current_user)`;
function ledgerExpression(record) {
  const targets = record.plans.map(p => `jsonb_build_object('version',${quote(p.version)},
 'present',EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version=${quote(p.version)}),
 'equal',EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version=${quote(p.version)} AND name=${quote(p.name)} AND statements IS NOT DISTINCT FROM ARRAY(SELECT jsonb_array_elements_text(${json(p.originalVector)}))))`);
  return `jsonb_build_object('count',(SELECT count(*) FROM supabase_migrations.schema_migrations),
 'priorHash',(SELECT encode(sha256(convert_to(jsonb_agg(jsonb_build_array(version,name,statements) ORDER BY version)::text,'UTF8')),'hex') FROM supabase_migrations.schema_migrations WHERE version NOT IN (${record.plans.map(p => quote(p.version)).join(',')})),
 'targets',jsonb_build_array(${targets.join(',')}))`;
}
const revisionExpression = `(SELECT jsonb_build_object('count',count(*),'singletonCount',count(*) FILTER (WHERE singleton),
 'value',min(revision)::text) FROM pipeline_control.admin_evaluation_catalog_revision)`;
function expectedLedger(record, applied) {
  return { count: record.manifest.priorLedger.count + applied, priorHash: record.manifest.priorLedger.sha256,
    targets: record.plans.map((p, i) => ({ version: p.version, present: i < applied, equal: i < applied })) };
}
export function priorQuery(record) {
  assertRecord(record);
  return `SELECT jsonb_build_object('identity',(${identity}),'catalog',(${record.manifest.catalogExpression}=${json(record.manifest.catalogBefore)}),
 'ledger',${ledgerExpression(record)},'revision',${revisionExpression},'data',${dataExpression}) AS state`;
}
const dataKeys = ['businessCount', 'businessHash', 'cohortCount', 'cohortHash', 'indexCount', 'indexHash', 'untouchedCount', 'untouchedHash'];
export function validatePrior(record, state) {
  if (!state || !equal(Object.keys(state).sort(), ['catalog', 'data', 'identity', 'ledger', 'revision'])
    || state.identity !== true || state.catalog !== true
    || !equal(state.ledger, expectedLedger(record, 0))
    || !state.revision || !equal(Object.keys(state.revision).sort(), ['count', 'singletonCount', 'value'])
    || state.revision.count !== 1 || state.revision.singletonCount !== 1
    || typeof state.revision.value !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(state.revision.value)
    || BigInt(state.revision.value) >= 9223372036854775807n
    || !state.data || !equal(Object.keys(state.data).sort(), [...dataKeys].sort())) fail('SPONSORSHIP_PRIOR_DRIFT');
  for (const k of dataKeys) {
    if (k.endsWith('Hash') ? typeof state.data[k] !== 'string' || !hashPattern.test(state.data[k]) : !Number.isSafeInteger(state.data[k]) || state.data[k] < 0) fail('SPONSORSHIP_PRIOR_DRIFT');
  }
  if (state.data.cohortCount > state.data.businessCount || state.data.untouchedCount > state.data.indexCount) fail('SPONSORSHIP_PRIOR_DRIFT');
}
export function terminalQuery(record, before) {
  validatePrior(record, before);
  const catalog = `(${record.manifest.catalogExpression}=${json(record.manifest.catalogAfter)})`;
  // No custom function can run on a drifted catalog. The pinned descriptor and
  // transitive helpers are IMMUTABLE; compose (VOLATILE) is NEVER invoked here.
  const cohortCorrect = `CASE WHEN ${catalog} THEN NOT EXISTS(
 SELECT 1 FROM public.restaurants r LEFT JOIN pipeline_control.admin_evaluation_read_index i ON i.id=r.id
 CROSS JOIN LATERAL (SELECT pipeline_control.admin_eval_descriptor(to_jsonb(r)||jsonb_build_object('name',r.approved_name)) AS d) expected
 WHERE (${candidate}) AND (i.id IS NULL OR i.descriptor IS DISTINCT FROM expected.d
 OR i.latest IS DISTINCT FROM (expected.d->>'latest')::numeric OR i.created IS DISTINCT FROM (expected.d->>'created')::numeric
 OR i.video IS DISTINCT FROM expected.d->>'video')) ELSE false END`;
  return `SELECT jsonb_build_object('identity',(${identity}),'catalog',${catalog},'ledger',${ledgerExpression(record)},
 'revision',${revisionExpression},
 'businessUnchanged',d->'businessHash'=${json(before.data.businessHash)} AND d->'businessCount'=${json(before.data.businessCount)},
 'cohortUnchanged',d->'cohortHash'=${json(before.data.cohortHash)} AND d->'cohortCount'=${json(before.data.cohortCount)},
 'untouchedUnchanged',d->'untouchedHash'=${json(before.data.untouchedHash)} AND d->'untouchedCount'=${json(before.data.untouchedCount)},
 'indexCountCorrect',(SELECT count(*) FROM pipeline_control.admin_evaluation_read_index)=${before.data.untouchedCount}+${before.data.cohortCount},
 'cohortCorrect',(${cohortCorrect})) AS state FROM (SELECT ${dataExpression} AS d) snapshot`;
}
export function expectedTerminal(record, before, applied = 2) {
  validatePrior(record, before);
  if (![1, 2].includes(applied)) fail('SPONSORSHIP_ARGUMENT_INVALID');
  return { identity: true, catalog: true,
    ledger: expectedLedger(record, applied),
    revision: { count: 1, singletonCount: 1, value: (BigInt(before.revision.value) + (applied === 2 ? 1n : 0n)).toString() },
    businessUnchanged: true, cohortUnchanged: true, untouchedUnchanged: true, indexCountCorrect: true, cohortCorrect: true };
}
const readOnly = query => `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='15s'; SET LOCAL lock_timeout='2s'; SET LOCAL search_path=pg_catalog;
SELECT jsonb_build_object('readOnly',current_setting('transaction_read_only'),'state',q.state) FROM (${query}) q;`;
export function preflightSql(record) { return readOnly(priorQuery(record)); }
export function reconcileSql(record, before) {
  return readOnly(`SELECT jsonb_build_object('prior',(SELECT state FROM (${priorQuery(record)}) a),'terminal',(SELECT state FROM (${terminalQuery(record, before)}) b)) AS state`);
}
function expiry(admission) {
  return `DO $sponsorship_expiry$ BEGIN IF clock_timestamp()<${quote(admission.issuedAt)}::timestamptz OR clock_timestamp()>=${quote(admission.expiresAt)}::timestamptz THEN RAISE EXCEPTION 'SPONSORSHIP_ADMISSION_EXPIRED'; END IF; END $sponsorship_expiry$;`;
}
export function applySql(record, admission, before) {
  assertRecord(record); validatePrior(record, before);
  const terminal = terminalQuery(record, before);
  const migrations = record.manifest.migrations.map((migration, i) => ({ ...migration,
    expectedPriorState: i === 0 ? { query: priorQuery(record), expected: before }
      : { query: terminal, expected: expectedTerminal(record, before, 1) },
    terminalReadback: { query: terminal, expected: expectedTerminal(record, before, i + 1) } }));
  return `SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
SET LOCAL search_path=pg_catalog; SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='120s';
SET LOCAL transaction_timeout='15s';
${expiry(admission)}
DO $sponsorship_serializer$ BEGIN PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(${quote(record.manifest.serializer)},0)); END $sponsorship_serializer$;
LOCK TABLE supabase_migrations.schema_migrations IN EXCLUSIVE MODE;
LOCK TABLE public.restaurants IN SHARE MODE;
LOCK TABLE pipeline_control.admin_evaluation_read_index IN SHARE ROW EXCLUSIVE MODE;
DO $sponsorship_revision_lock$ BEGIN
 PERFORM 1 FROM pipeline_control.admin_evaluation_catalog_revision WHERE singleton FOR UPDATE NOWAIT;
END $sponsorship_revision_lock$;
${expiry(admission)}
${record.plans.map((plan, i) => atomicMigrationSql(plan, migrations[i])).join('\n')}
${expiry(admission)}\n`;
}
function parse(output, ro) {
  if (typeof output !== 'string' || Buffer.byteLength(output) > MAX_BYTES) fail('SPONSORSHIP_READBACK_INVALID');
  let value; try { value = JSON.parse(output.trim()); } catch { fail('SPONSORSHIP_READBACK_INVALID'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('SPONSORSHIP_READBACK_INVALID');
  if (ro) {
    if (!equal(Object.keys(value).sort(), ['readOnly', 'state']) || value.readOnly !== 'on') fail('SPONSORSHIP_READONLY_UNCONFIRMED');
    return value.state;
  }
  return value;
}
function parseBundle(output, record, before) {
  if (typeof output !== 'string' || Buffer.byteLength(output) > MAX_BYTES) fail('SPONSORSHIP_READBACK_INVALID');
  const lines = output.trim().split(/\r?\n/);
  if (lines.length !== 2) fail('SPONSORSHIP_READBACK_INVALID');
  const terminals = lines.map(line => parse(line, false));
  if (!equal(terminals, [expectedTerminal(record, before, 1), expectedTerminal(record, before, 2)])) fail('SPONSORSHIP_TERMINAL_UNCONFIRMED');
  return terminals;
}
export function disposition(record, observed, before) {
  if (!observed || !equal(Object.keys(observed).sort(), ['prior', 'terminal']) || !observed.prior || !observed.terminal) return 'conflict_or_unconfirmed';
  const expected = expectedTerminal(record, before);
  if (equal(observed.terminal, expected)) return 'committed';
  const t = observed.terminal;
  if (t.identity === true && t.catalog === true && equal(t.ledger, expected.ledger)
    && equal(t.revision, expected.revision)) return 'committed_schema_ledger_postcommit_data_unverified';
  try {
    validatePrior(record, observed.prior);
    return equal(observed.prior, before) ? 'not_applied_no_retry' : 'conflict_or_unconfirmed';
  } catch { return 'conflict_or_unconfirmed'; }
}

function privateBytes(path) {
  if (realpathSync(path) !== resolve(path)) fail('SPONSORSHIP_CUSTODY_INVALID');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const s = fstatSync(fd);
    if (!s.isFile() || s.nlink !== 1 || s.uid !== process.getuid() || (s.mode & 0o777) !== 0o600 || s.size > MAX_BYTES) fail('SPONSORSHIP_CUSTODY_INVALID');
    return readFileSync(fd);
  } finally { closeSync(fd); }
}
export function parseAdmissionBytes(raw) {
  let value;
  try { value = JSON.parse(raw); } catch { fail('SPONSORSHIP_ADMISSION_INVALID'); }
  // One canonical line rejects duplicate keys and parser-dependent receipts.
  if (!Buffer.isBuffer(raw) || raw.length > MAX_BYTES || !raw.equals(Buffer.from(JSON.stringify(value) + '\n'))) fail('SPONSORSHIP_ADMISSION_INVALID');
  return value;
}
function privateDirectory(path) {
  const s = lstatSync(path);
  if (realpathSync(path) !== resolve(path) || !s.isDirectory() || s.isSymbolicLink() || s.uid !== process.getuid() || (s.mode & 0o777) !== 0o700) fail('SPONSORSHIP_CUSTODY_INVALID');
}
function writeAll(fd, value) {
  const bytes = Buffer.from(JSON.stringify(value) + '\n');
  for (let n = 0; n < bytes.length;) { const written = writeSync(fd, bytes, n, bytes.length - n); if (!written) fail('SPONSORSHIP_JOURNAL_UNCONFIRMED'); n += written; }
  fsyncSync(fd);
}
function syncDirectory(path) { const fd = openSync(path, constants.O_RDONLY); try { fsyncSync(fd); } finally { closeSync(fd); } }
export class OriginalJournal {
  // Library-only directory injection permits real filesystem recovery tests.
  // The CLI always uses the fixed project/manifest custody directory.
  constructor({ directory = CUSTODY } = {}) { privateDirectory(directory); this.directory = directory; this.path = join(directory, 'original.jsonl'); this.lock = join(directory, 'send.lock'); }
  read() {
    if (!existsSync(this.path)) return null;
    const raw = privateBytes(this.path).toString('utf8'), lines = raw.split('\n');
    const complete = lines.slice(0, -1); let events;
    try { events = complete.map(line => JSON.parse(line)); } catch { fail('SPONSORSHIP_JOURNAL_UNCONFIRMED'); }
    if (!events.length) fail('SPONSORSHIP_JOURNAL_UNCONFIRMED');
    return { first: events[0], spent: existsSync(this.lock) || events.length > 1 || lines.at(-1) !== '', partialTail: lines.at(-1) !== '' };
  }
  prepare(first) {
    const fd = openSync(this.path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { writeAll(fd, first); } finally { closeSync(fd); syncDirectory(this.directory); }
  }
  spend(first) {
    const current = this.read();
    if (!current || current.spent || !equal(current.first, first)) fail('SPONSORSHIP_RECONCILE_REQUIRED');
    const fd = openSync(this.lock, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { writeAll(fd, { identity: first.identity, event: 'send_reserved' }); } finally { closeSync(fd); syncDirectory(this.directory); }
    this.append({ identity: first.identity, event: 'send_intent', sqlSha256: first.sqlSha256 });
  }
  append(value) {
    privateBytes(this.path);
    const fd = openSync(this.path, constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW);
    try {
      const s = fstatSync(fd);
      if (!s.isFile() || s.nlink !== 1 || s.uid !== process.getuid() || (s.mode & 0o777) !== 0o600 || s.size > MAX_BYTES) fail('SPONSORSHIP_CUSTODY_INVALID');
      writeAll(fd, value);
    } finally { closeSync(fd); }
  }
}
export function identityFor(record, admission) {
  return { operationId: admission.operationId, admissionSha256: sha(JSON.stringify(admission)),
    manifestSha256: MANIFEST_SHA256, sourceRevision: admission.sourceRevision,
    protectedMainSha: admission.protectedMain.sha,
    sourceFilesSha256: admission.sourceFilesSha256, bundleSha256: record.manifest.bundleSha256,
    projectRef: record.manifest.projectRef };
}

/** Bound the actual psql child, including DNS/TLS and response waits. The common
 * runner takes three arguments, so a fourth per-call deadline is ineffective.
 * SIGKILL targets only this spawned client; an uncertain send stays spent.
 */
export function createSponsorshipPsqlRunner(databaseUrl, { environment = process.env, spawnImpl = spawnSync } = {}) {
  return createThumbnailPsqlRunner(databaseUrl, { environment,
    spawnImpl: (command, args, options) => spawnImpl(command, args, {
      ...options, timeout: 20000, killSignal: 'SIGKILL',
    }),
  });
}

/** Injected adapters are for tests/library use. CLI exposes no adapter/path overrides. */
export function executeSponsorship(mode, { record, admission, readSource, readAdmission, readFences, readProtectedMain,
  transport, databaseUrl, journal, now = () => new Date() }) {
  if (!['preflight', 'apply', 'reconcile'].includes(mode)) fail('SPONSORSHIP_ARGUMENT_INVALID');
  assertRecord(record);
  assertSuccessorDatabaseTarget(databaseUrl, { projectRef: record.manifest.projectRef, databaseName: 'postgres' });
  const revalidate = () => {
    if (!equal(readAdmission(), admission)) fail('SPONSORSHIP_ADMISSION_DRIFT');
    const source = readSource();
    validateAdmission(record, admission, source, now(), { reconcile: mode === 'reconcile' });
    if (mode !== 'reconcile') {
      if (typeof readProtectedMain !== 'function') fail('SPONSORSHIP_PROTECTED_MAIN_UNVERIFIED');
      validateProtectedMain(record, admission, source, readProtectedMain(), now());
      if (!equal(readFences(), { generalFreeze: 'active', githubProducer: 'disabled_manually' })) fail('SPONSORSHIP_FENCE_DRIFT');
    }
  };
  revalidate();
  const identity = identityFor(record, admission), original = journal.read();
  if (original && (!equal(original.first.identity, identity) || original.first.event !== 'prepared')) fail('SPONSORSHIP_JOURNAL_BINDING_INVALID');
  if (mode === 'preflight') {
    if (original) fail('SPONSORSHIP_ORIGINAL_ALREADY_EXISTS');
    const before = parse(transport(databaseUrl, preflightSql(record), true), true);
    validatePrior(record, before); revalidate();
    const first = { event: 'prepared', identity, before, sqlSha256: sha(applySql(record, admission, before)) };
    journal.prepare(first);
    return { status: 'prepared', identity, prior: before, replayAllowed: false };
  }
  if (!original) fail('SPONSORSHIP_ORIGINAL_REQUIRED');
  validatePrior(record, original.first.before);
  const sql = applySql(record, admission, original.first.before);
  if (sha(sql) !== original.first.sqlSha256) fail('SPONSORSHIP_SQL_BINDING_INVALID');
  if (mode === 'reconcile') {
    try {
      const observed = parse(transport(databaseUrl, reconcileSql(record, original.first.before), true), true);
      return { status: 'reconciled', identity, disposition: disposition(record, observed, original.first.before), replayAllowed: false,
        cacheSequenceRollbackClaimed: false };
    } catch { return { status: 'unconfirmed', identity, replayAllowed: false, cacheSequenceRollbackClaimed: false }; }
  }
  if (original.spent) fail('SPONSORSHIP_RECONCILE_REQUIRED');
  revalidate(); journal.spend(original.first);
  // After spend ANY failure is uncertain. Never infer rollback from a timeout,
  // parsed provider message, a cache sequence, or a missing acknowledgement.
  try {
    revalidate();
    const terminals = parseBundle(transport(databaseUrl, sql, true), record, original.first.before);
    journal.append({ event: 'commit_acknowledged', identity, terminals });
    return { status: 'committed', identity, terminals, replayAllowed: false, cacheSequenceRollbackClaimed: false };
  } catch {
    try { journal.append({ event: 'unconfirmed_reconcile_original', identity }); } catch { /* permanent send.lock still prohibits replay */ }
    return { status: 'unconfirmed', identity, replayAllowed: false, cacheSequenceRollbackClaimed: false };
  }
}
function observeFences() {
  const get = path => {
    const p = spawnSync('gh', ['api', path], { cwd: ROOT, encoding: 'utf8', timeout: 15000 });
    if (p.error || p.status !== 0) fail('SPONSORSHIP_FENCE_UNAVAILABLE');
    try { return JSON.parse(p.stdout); } catch { fail('SPONSORSHIP_FENCE_UNAVAILABLE'); }
  };
  return { generalFreeze: get('repos/twoimo/tzudong/actions/variables/G037_WRITE_FREEZE').value,
    githubProducer: get('repos/twoimo/tzudong/actions/workflows/daily-crawler.yml').state };
}
/** Read-only independent API protection + Git tip observations. No fetch/checkout. */
export function observeProtectedMain({ spawnImpl = spawnSync, clock = () => new Date() } = {}) {
  const branch = spawnImpl('gh', ['api', '--hostname', 'github.com', '--header', 'Cache-Control: no-cache',
    'repos/twoimo/tzudong/branches/main', '--jq', '{name: .name, protected: .protected, sha: .commit.sha}'],
  { cwd: ROOT, encoding: 'utf8', timeout: 15000 });
  if (branch.error || branch.status !== 0) fail('SPONSORSHIP_PROTECTED_MAIN_UNVERIFIED');
  let value; try { value = JSON.parse(branch.stdout); } catch { fail('SPONSORSHIP_PROTECTED_MAIN_UNVERIFIED'); }
  if (value?.name !== 'main' || value.protected !== true || !/^[a-f0-9]{40}$/.test(value.sha)) fail('SPONSORSHIP_PROTECTED_MAIN_UNVERIFIED');
  const remote = spawnImpl('git', ['ls-remote', '--exit-code', 'origin', 'refs/heads/main'],
    { cwd: ROOT, encoding: 'utf8', timeout: 15000 });
  const match = /^([a-f0-9]{40})\trefs\/heads\/main\s*$/.exec(remote.stdout ?? '');
  if (remote.error || remote.status !== 0 || !match || match[1] !== value.sha) fail('SPONSORSHIP_PROTECTED_MAIN_DRIFT');
  return { repository: 'twoimo/tzudong', branch: 'main', sha: value.sha, protected: true, observedAt: clock().toISOString() };
}
export function runSponsorship(mode = 'prepare', { environment = process.env } = {}) {
  if (Number(process.versions.node.split('.')[0]) !== 24 || process.versions.bun) fail('SPONSORSHIP_NODE_VERSION_INVALID');
  const record = loadRecord();
  if (mode === 'prepare') return { status: 'source_prepared_not_admitted', manifestSha256: MANIFEST_SHA256,
    bundleSha256: record.manifest.bundleSha256,
    migrations: record.manifest.migrations.map((m, i) => ({ path: m.path, sha256: m.sha256,
      vectorSha256: record.plans[i].vectorSha256, statementCount: record.plans[i].originalVector.length })),
    statementCount: record.plans.reduce((sum, p) => sum + p.originalVector.length, 0), scope: record.manifest.scope,
    source: currentSource(record), custody: CUSTODY, scopeSha256: sha(JSON.stringify(record.manifest.scope)),
    sourcePolicy: record.manifest.sourcePolicy, protectedMainReceiptFields: protectedMainKeys,
    requiredAdmissionFields: admissionKeys, admissionEncoding: 'JSON.stringify(receipt) + newline; private regular file mode 0600',
    admissionKind: 'sponsorship_scoped_admission_v2', authority: 'authenticated-repository-owner-local-cli',
    fences: record.manifest.fences, maxAdmissionWindowSeconds: 600, executionReady: false };
  if (!['preflight', 'apply', 'reconcile'].includes(mode)) fail('SPONSORSHIP_ARGUMENT_INVALID');
  privateDirectory(CUSTODY);
  const readAdmission = () => {
    try { return parseAdmissionBytes(privateBytes(join(CUSTODY, 'admission.json'))); } catch { fail('SPONSORSHIP_ADMISSION_INVALID'); }
  };
  const admission = readAdmission();
  validateAdmission(record, admission, currentSource(record), new Date(), { reconcile: mode === 'reconcile' });
  const { databaseUrl } = selectDirectDatabaseTransport(environment);
  const transport = createSponsorshipPsqlRunner(databaseUrl, { environment });
  return executeSponsorship(mode, { record, admission, readSource: () => { loadRecord(); return currentSource(record); },
    readAdmission, readFences: observeFences, readProtectedMain: observeProtectedMain, transport, databaseUrl, journal: new OriginalJournal() });
}
export function sponsorshipResultExitCode(result) {
  return ['source_prepared_not_admitted', 'prepared', 'committed'].includes(result?.status)
    || (result?.status === 'reconciled' && result.disposition === 'committed') ? 0 : 2;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length > 3) fail('SPONSORSHIP_ARGUMENT_INVALID');
    const result = runSponsorship(process.argv[2]);
    process.stdout.write(JSON.stringify(result) + '\n');
    process.exitCode = sponsorshipResultExitCode(result);
  } catch (error) {
    const code = /^SPONSORSHIP_[A-Z_]+$/.test(error?.code ?? '') ? error.code : 'SPONSORSHIP_FAILED';
    process.stderr.write(JSON.stringify({ code }) + '\n'); process.exitCode = 1;
  }
}
