/** Separate guardian97 successor. Frozen94/v2 and original SQL remain immutable. */
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { atomicMigrationSql, migrationEnvelope, reconciliationSql, reconciliationOutcome, statementSpans } from './supabase-migration-transaction.mjs';
import { buildOperation as predecessorOperation } from './atomic-edit-submission-bundle-operation.mjs';
import { assertSuccessorDatabaseTarget } from './review-media-sql-successor.mjs';
import { createThumbnailPsqlRunner } from './thumbnail-production-successor.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const CONTRACT_PATH = '.github/g014-guardian-auth-fk-install.v1.json';
export const CONTRACT_SHA256 = '2bb8b76cb1ed7d7ee5cee97aec278998463135cfdd0f5deee500b364abb5448b';
const SOURCE_PATH = 'backend/supabase/migrations/20261026140000_g014_guardian_auth_fk_lock_privilege.sql';
const SOURCE_SHA256 = 'd95a1a30f76c0f8e3beea405549b39de1fe0bbc76833851af48640bb29d8a9cf';
const VERSION = '20261026140000';
export const ORIGINAL_JOURNAL_PATH = resolve(homedir(), '.local/state/tzudong-unified-20261025/auth-p0/guardian-successor-original/original.json');
const SERIALIZER = "SET LOCAL lock_timeout='2s'; SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('tzudong:review-media-sql-successor:workflow:v1',0));\n";
const hash = value => createHash('sha256').update(value).digest('hex');
const quote = value => "'" + value.replaceAll("'", "''") + "'";
const fail = code => { throw Error('GUARDIAN_SUCCESSOR_' + code); };
const rawQuery = value => value.trim().replace(/;\s*$/, '');
const equal = isDeepStrictEqual;

function uniqueJson(raw) {
  const value=JSON.parse(raw); const stack=[];
  for (const match of raw.matchAll(/"(?:\\.|[^"\\])*"|[{}\[\],:]|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g)) {
    const token=match[0], top=stack.at(-1);
    if (token==='{') stack.push({keys:new Set(),key:true});
    else if (token==='[') stack.push({array:true});
    else if (token==='}' || token===']') stack.pop();
    else if (token===',' && top && !top.array) top.key=true;
    else if (token.startsWith('"') && top?.key && !top.array) {
      const key=JSON.parse(token); if (top.keys.has(key)) fail('DUPLICATE_JSON_KEY');
      top.keys.add(key); top.key=false;
    }
  }
  return value;
}

export function parseReadback(output) {
  if (typeof output !== 'string' || Buffer.byteLength(output) > 256 * 1024) fail('READBACK_INVALID');
  const lines = output.trim().split(/\r?\n/).filter(line => line.trim());
  if (lines.length !== 1) fail('READBACK_INVALID');
  try {
    const value = uniqueJson(lines[0]);
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('READBACK_INVALID');
    return value;
  } catch { fail('READBACK_INVALID'); }
}

export function buildOperation({ contractBytes = readFileSync(resolve(ROOT, CONTRACT_PATH)), sourceBytes = readFileSync(resolve(ROOT, SOURCE_PATH)) } = {}) {
  if (hash(contractBytes) !== CONTRACT_SHA256) fail('CONTRACT_DRIFT');
  if (hash(sourceBytes) !== SOURCE_SHA256) fail('SOURCE_DRIFT');
  const contract = JSON.parse(contractBytes);
  const predecessor = predecessorOperation();
  if (contract.schemaVersion !== 1 || contract.kind !== 'g014_guardian_auth_fk_installation'
    || contract.projectRef !== 'aqlcofblfxdrjhhdmarw' || contract.database !== 'postgres'
    || typeof contract.executionEnabled !== 'boolean'
    || contract.predecessorContractSha256 !== 'a3e6e14e5eb1518f53ec7359ce91b993fe50f1f7e2a3dfd16221ad74af521f4d'
    || contract.predecessorBundleSha256 !== predecessor.contract.bundleSha256
    || contract.migration.path !== SOURCE_PATH || contract.migration.sha256 !== SOURCE_SHA256
    || !equal(contract.migration.expectedPriorState.expected.predecessor, predecessor.contract.terminalReadback.expected)
    || contract.bindingEvidence.searchPath !== '') fail('CONTRACT_INVALID');
  const plan = migrationEnvelope(sourceBytes, contract.migration, contract.originalStatementVector);
  if (plan.version !== VERSION || plan.vectorSha256 !== contract.statementVectorSha256
    || contract.originalStatementVector.length !== 11 || plan.execution === sourceBytes.toString()) fail('VECTOR_DRIFT');
  return { contract, migration: contract.migration, plan, contractSha256: CONTRACT_SHA256 };
}

export function pendingFields(operation) {
  const { contract, migration } = operation;
  const pending = [...contract.bindingEvidence.pendingFields];
  for (const key of ['actualPG17SuccessorVerified', 'hostedExpectedVerified', 'officialParserVerified', 'priorManifestAfter96Verified']) {
    if (contract.bindingEvidence[key] !== true && !pending.includes(key)) pending.push(key);
  }
  if (!migration.terminalReadback.expected && !pending.includes('terminalReadback.expected')) pending.push('terminalReadback.expected');
  return pending;
}

export function assertBoundExpectations(operation) {
  const before=operation.migration.expectedPriorState.expected, after=operation.migration.terminalReadback.expected;
  const without=(value,keys)=>Object.fromEntries(Object.entries(value ?? {}).filter(([key])=>!keys.includes(key)));
  const digest=value=>typeof value==='string' && /^[0-9a-f]{64}$/.test(value);
  if (!after || before.predecessor?.legacy?.ledgerCount!==96 || after.predecessor?.legacy?.ledgerCount!==97
    || before.predecessorLedgersEqual!==true || after.predecessorLedgersEqual!==true
    || !equal(without(before.predecessor,['legacy']),without(after.predecessor,['legacy']))
    || !equal(without(before.predecessor.legacy,['ledgerCount','ledgerPrefix','oldRelations']),without(after.predecessor.legacy,['ledgerCount','ledgerPrefix','oldRelations']))
    || !digest(after.predecessor.legacy.ledgerPrefix) || !digest(after.predecessor.legacy.oldRelations)) fail('BOUND_EXPECTATIONS_INVALID');
  const manifestChanges=['manifestCount','manifestSha256','actualCount','targetCount','targetValues'];
  if (before.manifest.targetCount!==0 || after.manifest?.targetCount!==1
    || !equal(after.manifest.targetValues,[{grantable:false}])
    || after.manifest.manifestCount!==before.manifest.manifestCount+1
    || after.manifest.actualCount!==before.manifest.actualCount+1 || !digest(after.manifest.manifestSha256)
    || !equal(without(before.manifest,manifestChanges),without(after.manifest,manifestChanges))) fail('BOUND_EXPECTATIONS_INVALID');
  if (!Array.isArray(after.guardian) || after.guardian.length!==before.guardian.length) fail('BOUND_EXPECTATIONS_INVALID');
  for (const old of before.guardian) {
    const next=after.guardian.find(value=>value.name===old.name);
    if (old.name==='privacy_guardian_verifications') {
      if (old.ownerUpdate!==false || next?.ownerUpdate!==true || typeof next.acl!=='string' || next.acl===old.acl
        || !equal(without(old,['acl','ownerUpdate']),without(next,['acl','ownerUpdate']))) fail('BOUND_EXPECTATIONS_INVALID');
    } else if (!equal(old,next)) fail('BOUND_EXPECTATIONS_INVALID');
  }
}

export function successorReconciliationSql(operation) {
  // Branch before planning the frozen96 projection: its relations do not exist at93.
  const inner = reconciliationSql(operation.plan, {
    ...operation.migration,
    // The compiler requires a nonempty expected object even for read generation.
    terminalReadback: { ...operation.migration.terminalReadback, expected: operation.migration.terminalReadback.expected ?? { unknown: true } },
  });
  const prologue="SET TRANSACTION READ ONLY; SET LOCAL standard_conforming_strings=on; SET LOCAL statement_timeout='15s';\n";
  if (!inner.startsWith(prologue)) fail('COMPILER_READBACK_DRIFT');
  return `SET LOCAL search_path=''; ${prologue}
SELECT (SELECT count(*)=3 FROM supabase_migrations.schema_migrations WHERE version IN ('20261025063810','20261026120000','20261026130000')) AS predecessor_ready \\gset
\\if :predecessor_ready
${inner.slice(prologue.length)}
\\else
SELECT jsonb_build_object('state','predecessor_not_ready');
\\endif
`;
}

export function disposition(value, operation) {
  if (!operation.migration.terminalReadback.expected) return 'unbound';
  // Exact envelope keys also reject side-channel/partial JSON fields.
  if (!value || !equal(Object.keys(value).sort(), ['ledger_equal','ledger_exists','prior','terminal'])) return 'drift';
  return ({ committed: 'committed', not_applied: 'not_applied' })[reconciliationOutcome(value, operation.migration)] ?? 'drift';
}

function bodyGuard(operation) {
  const expected = operation.contract.projections.functionBodyPins;
  const rows = expected.map(p => `(${quote(p.signature)},${quote(p.bodySha256)},${p.securityDefiner ? 'true' : 'false'},${quote(p.acl)},${quote(JSON.stringify(p.config))}::jsonb)`).join(',');
  return `IF EXISTS(SELECT 1 FROM (VALUES ${rows}) e(signature,body_sha,definer,acl,config)
 LEFT JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(e.signature)
 WHERE p.oid IS NULL OR p.proowner<>'privacy_workflow_owner'::regrole OR p.prosecdef IS DISTINCT FROM e.definer
 OR p.proacl::text IS DISTINCT FROM e.acl OR to_jsonb(p.proconfig) IS DISTINCT FROM e.config
 OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>e.body_sha) THEN
 RAISE EXCEPTION 'GUARDIAN_SUCCESSOR_ASSERTION_SOURCE_DRIFT'; END IF;`;
}

export function guardianGuards(operation) {
  const signatures = operation.contract.projections.functionBodyPins.map(p => `pg_catalog.to_regprocedure(${quote(p.signature)})`).join(',');
  const key = "jsonb_build_object('schema','privacy_retention','relation','privacy_guardian_verifications','grantee','privacy_workflow_owner','grantor','privacy_workflow_owner','privilege','UPDATE')";
  const memberQuery = "(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor),'[]') FROM pg_catalog.pg_auth_members m)";
  const functionQuery = `(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_catalog.pg_proc p WHERE p.oid=ANY(ARRAY[${signatures}]::oid[]))`;
  const registryQuery = "jsonb_build_object('public',(SELECT jsonb_agg(to_jsonb(r) ORDER BY source_signature,grantee) FROM privacy_retention.g014_public_rpc_allowlist r),'nested',(SELECT jsonb_agg(to_jsonb(r) ORDER BY source_signature) FROM privacy_retention.g014_nested_helper_allowlist r))";
  const before = `DO $guardian97_pre$
BEGIN
 IF current_user<>'postgres' OR session_user<>'postgres' OR current_setting('is_superuser')<>'off'
 OR current_database()<>'postgres' OR current_setting('server_version_num')<>'170006'
 OR current_setting('transaction_read_only')<>'off' OR current_setting('transaction_isolation')<>'read committed'
 OR NOT has_table_privilege(current_user,'privacy_retention.g014_catalog_contract_manifest','SELECT')
 OR row_security_active('privacy_retention.g014_catalog_contract_manifest'::regclass)
 THEN RAISE EXCEPTION 'GUARDIAN_SUCCESSOR_EXECUTOR_DENIED'; END IF;
 ${bodyGuard(operation)}
 IF pg_has_role('postgres','privacy_workflow_owner','SET') OR pg_has_role('postgres','privacy_workflow_owner','USAGE')
 OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='privacy_workflow_owner'::regrole AND member='postgres'::regrole AND grantor='postgres'::regrole)
 THEN RAISE EXCEPTION 'GUARDIAN_SUCCESSOR_MEMBERSHIP_CONFLICT'; END IF;
 CREATE TEMP TABLE pg_temp.guardian97_before(members jsonb,functions jsonb,manifest jsonb,registry jsonb,guardian jsonb) ON COMMIT DROP;
 INSERT INTO pg_temp.guardian97_before SELECT ${memberQuery},${functionQuery},
 (SELECT jsonb_agg(to_jsonb(m) ORDER BY manifest_kind,manifest_key) FROM privacy_retention.g014_catalog_contract_manifest m),
 ${registryQuery},(SELECT to_jsonb(c)-'relacl' FROM pg_class c WHERE oid='privacy_retention.privacy_guardian_verifications'::regclass);
 GRANT privacy_workflow_owner TO postgres WITH ADMIN FALSE,INHERIT FALSE,SET TRUE GRANTED BY postgres;
 SET LOCAL ROLE privacy_workflow_owner;
 CREATE FUNCTION pg_temp.guardian97_g014_check(p_phase text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $check$
 BEGIN
  IF session_user<>'postgres' OR current_user<>'privacy_workflow_owner' OR p_phase IS NULL OR p_phase NOT IN ('pre','post') THEN
   RAISE EXCEPTION 'GUARDIAN_SUCCESSOR_CHECK_CALLER_DENIED'; END IF;
  PERFORM privacy_retention.assert_g014_workflow_owner_contract();
  PERFORM privacy_retention.assert_g014_public_rpc_allowlist();
  PERFORM privacy_retention.assert_g014_definer_contract();
  PERFORM privacy_retention.assert_g014_catalog_contract();
  IF p_phase='post' THEN DROP FUNCTION pg_temp.guardian97_g014_check(text); END IF;
 END $check$;
 REVOKE ALL ON FUNCTION pg_temp.guardian97_g014_check(text) FROM PUBLIC,anon,authenticated,service_role;
 GRANT EXECUTE ON FUNCTION pg_temp.guardian97_g014_check(text) TO postgres;
 SET LOCAL ROLE postgres;
 REVOKE privacy_workflow_owner FROM postgres GRANTED BY postgres;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('pg_temp.guardian97_g014_check(text)')
 AND p.proowner='privacy_workflow_owner'::regrole AND p.prosecdef AND p.proconfig=ARRAY['search_path=""']::text[]
 AND (SELECT count(*)=2 AND bool_and(a.privilege_type='EXECUTE' AND NOT a.is_grantable
 AND a.grantee IN ('postgres'::regrole,'privacy_workflow_owner'::regrole)
 AND a.grantor='privacy_workflow_owner'::regrole) FROM aclexplode(p.proacl) a))
 THEN RAISE EXCEPTION 'GUARDIAN_SUCCESSOR_BRIDGE_ACL_DRIFT'; END IF;
 IF (SELECT members FROM pg_temp.guardian97_before) IS DISTINCT FROM ${memberQuery} THEN
  RAISE EXCEPTION 'GUARDIAN_SUCCESSOR_MEMBERSHIP_DRIFT'; END IF;
 PERFORM pg_temp.guardian97_g014_check('pre');
END $guardian97_pre$;`;
  const after = `DO $guardian97_post$
DECLARE b record;
BEGIN
 PERFORM pg_temp.guardian97_g014_check('post');
 SELECT * INTO STRICT b FROM pg_temp.guardian97_before;
 IF b.members IS DISTINCT FROM ${memberQuery} OR b.functions IS DISTINCT FROM ${functionQuery}
 OR b.registry IS DISTINCT FROM ${registryQuery}
 OR b.guardian IS DISTINCT FROM (SELECT to_jsonb(c)-'relacl' FROM pg_class c WHERE oid='privacy_retention.privacy_guardian_verifications'::regclass)
 THEN RAISE EXCEPTION 'GUARDIAN_SUCCESSOR_PRESERVATION_DRIFT'; END IF;
 IF (SELECT count(*) FROM privacy_retention.g014_catalog_contract_manifest WHERE manifest_kind='grant' AND manifest_key=${key} AND manifest_value='{"grantable":false}'::jsonb)<>1
 OR EXISTS(SELECT 1 FROM (
 (SELECT to_jsonb(m) AS row FROM privacy_retention.g014_catalog_contract_manifest m EXCEPT SELECT value FROM jsonb_array_elements(b.manifest || jsonb_build_array(jsonb_build_object('manifest_kind','grant','manifest_key',${key},'manifest_value','{"grantable":false}'::jsonb))))
 UNION ALL
 (SELECT value FROM jsonb_array_elements(b.manifest || jsonb_build_array(jsonb_build_object('manifest_kind','grant','manifest_key',${key},'manifest_value','{"grantable":false}'::jsonb))) EXCEPT SELECT to_jsonb(m) FROM privacy_retention.g014_catalog_contract_manifest m)
 ) exact_delta)
 THEN RAISE EXCEPTION 'GUARDIAN_SUCCESSOR_MANIFEST_DELTA_DRIFT'; END IF;
 ${bodyGuard(operation)}
END $guardian97_post$;`;
  return { before, after };
}

export function atomicSuccessorSql(operation) {
  if (pendingFields(operation).length) fail('HOSTED_EXPECTATIONS_UNKNOWN');
  assertBoundExpectations(operation);
  const compiled = atomicMigrationSql(operation.plan, operation.migration);
  const execution = operation.plan.execution;
  const offset = compiled.indexOf(execution);
  if (offset < 0 || compiled.indexOf(execution, offset + execution.length) !== -1) fail('COMPILER_EXECUTION_DRIFT');
  const { before, after } = guardianGuards(operation);
  return SERIALIZER + "SET LOCAL search_path='';\n" + compiled.slice(0, offset) + before + '\n' + execution + '\n' + after + '\n' + compiled.slice(offset + execution.length);
}

export function operationIdentity(operation, sourceSha, operationId) {
  if (!/^[0-9a-f]{40}$/.test(sourceSha ?? '') || typeof operationId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9/_.:-]{0,191}$/.test(operationId)) fail('IDENTITY_INVALID');
  return { operationId, sourceSha, projectRef: operation.contract.projectRef, migrationVersion: VERSION,
    contractSha256: operation.contractSha256, migrationSha256: operation.plan.sourceSha256, statementVectorSha256: operation.plan.vectorSha256 };
}

/** Pure state machine: injected transport/journal are mandatory; CLI owns real adapters. */
export function executeOperation(mode, operation, { sourceSha, operationId, confirmation, runner, journal } = {}) {
  if (!['observe','reconcile','apply'].includes(mode) || typeof runner !== 'function') fail('ARGUMENT_INVALID');
  const identity = operationIdentity(operation, sourceSha, operationId);
  const pending = pendingFields(operation);
  if (mode === 'apply' && (!operation.contract.executionEnabled || pending.length)) fail('EXECUTION_DISABLED_OR_UNBOUND');
  if (mode === 'apply' || mode === 'reconcile') {
    if (!journal) fail('ORIGINAL_JOURNAL_REQUIRED');
    journal.assertIdentity(identity);
    if (mode === 'apply') { assertBoundExpectations(operation); journal.assertAdmission(identity); }
    if (mode === 'apply' && confirmation !== `apply:${sourceSha}:${operation.plan.sourceSha256}`) fail('CONFIRMATION_INVALID');
  }
  const reconcile = () => parseReadback(runner(successorReconciliationSql(operation), true));
  const before = reconcile(); const state = disposition(before, operation);
  if (mode !== 'apply') return { ...identity, state: pending.length ? 'unbound' : state, custodyVerified: mode==='reconcile', pendingFields: pending, readback: before };
  if (state === 'committed') return { ...identity, state: 'already_committed', after: before.terminal };
  if (state !== 'not_applied') fail('PREIMAGE_DRIFT');
  journal.reserve(identity);
  try {
    const atomic = atomicSuccessorSql(operation);
    const rehearsal = parseReadback(runner(`BEGIN;\n${atomic}\nROLLBACK;`, false));
    if (!equal(rehearsal, operation.migration.terminalReadback.expected)) fail('REHEARSAL_INVALID');
    if (disposition(reconcile(), operation) !== 'not_applied') fail('REHEARSAL_ROLLBACK_INVALID');
    journal.spend(identity); // Durably recorded before the only operating send.
    journal.assertAdmission(identity);
    let transport = 'returned';
    try { runner(atomic, true); } catch { transport = 'unconfirmed'; }
    const after = reconcile();
    if (disposition(after, operation) !== 'committed') fail('APPLY_UNCONFIRMED');
    const result = { ...identity, state: 'committed', transport, rehearsal: 'rolled_back', after: after.terminal };
    journal.record(result); return result;
  } catch {
    journal.record({ ...identity, state: 'unconfirmed_reconcile_original' });
    fail('APPLY_UNCONFIRMED_RECONCILE_ORIGINAL');
  }
}

const REAL_IO = { closeSync, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, writeFileSync };

export function validateAdmission(admission, identity, now = new Date()) {
  const observed=Date.parse(admission?.observedAt), expires=Date.parse(admission?.expiresAt);
  if (admission?.authority !== 'authenticated-repository-owner-local-cli'
    || admission.sourceSha !== identity.sourceSha || admission.operationId !== identity.operationId
    || !equal(admission.protectedMain,{repository:'twoimo/tzudong',sha:identity.sourceSha,protected:true,ownerVerified:true})
    || !equal(admission.fences,{githubDisabled:true,githubDrained:true,macIdle:true,generalFreeze:'active',dataPlaneApproved:'1'})
    || !Number.isFinite(now.getTime()) || !Number.isFinite(observed) || !Number.isFinite(expires) || observed>now.getTime() || now.getTime()>=expires || observed>=expires) fail('OWNER_ADMISSION_INVALID_OR_EXPIRED');
}

function verifyLocalSource(identity) {
  const git=(args)=>{
    const environment=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_')));
    const result=spawnSync('/usr/bin/git',args,{cwd:ROOT,env:environment,encoding:'utf8',timeout:15000,maxBuffer:1024*1024});
    if(result.error || result.status!==0) fail('SOURCE_UNCONFIRMED');
    return result.stdout.trim();
  };
  if(git(['rev-parse','--verify','HEAD'])!==identity.sourceSha || git(['status','--porcelain','--untracked-files=all'])!=='') fail('SOURCE_DRIFT');
}

function privateJson(path, io = REAL_IO) {
  if (io.realpathSync(path) !== resolve(path)) fail('JOURNAL_CUSTODY_INVALID');
  const fd = io.openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = io.fstatSync(fd);
    if (!info.isFile() || info.nlink !== 1 || info.size > 128 * 1024 || info.uid !== process.getuid() || (info.mode & 0o777) !== 0o600) fail('JOURNAL_CUSTODY_INVALID');
    return uniqueJson(io.readFileSync(fd,'utf8'));
  } finally { io.closeSync(fd); }
}

/** Opens ONLY the parent's fixed, pre-existing original journal. Never generates an ID. */
export class OriginalJournal {
  constructor(path = ORIGINAL_JOURNAL_PATH, { io = REAL_IO, now = () => new Date(), verifySource = verifyLocalSource } = {}) {
    this.io=io; this.now=now; this.verifySource=verifySource;
    if (resolve(path) !== ORIGINAL_JOURNAL_PATH) fail('JOURNAL_PATH_INVALID');
    this.path = path; this.directory = dirname(path); this.reserved = false;
    const info = io.lstatSync(this.directory);
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid() || (info.mode & 0o077) || io.realpathSync(this.directory) !== this.directory) fail('JOURNAL_CUSTODY_INVALID');
    this.value = privateJson(path,io);
  }
  assertIdentity(identity) {
    this.value = privateJson(this.path,this.io);
    if (this.value.schemaVersion !== 1 || this.value.kind !== 'g014_guardian_original_operation' || !equal(this.value.identity,identity)) fail('JOURNAL_IDENTITY_DRIFT');
  }
  assertAdmission(identity) {
    this.assertIdentity(identity); validateAdmission(this.value.admission,identity,this.now()); this.verifySource(identity); validateAdmission(this.value.admission,identity,this.now());
  }
  save() {
    const io=this.io;
    const temp = this.path + '.tmp';
    const payload=JSON.stringify(this.value)+'\n';
    if (Buffer.byteLength(payload)>128*1024) fail('JOURNAL_TOO_LARGE');
    const fd = io.openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { io.writeFileSync(fd,payload); io.fsyncSync(fd); } finally { io.closeSync(fd); }
    io.renameSync(temp,this.path);
    const directory = io.openSync(this.directory,constants.O_RDONLY);
    try { io.fsyncSync(directory); } finally { io.closeSync(directory); }
  }
  reserve(identity) {
    const io=this.io;
    this.assertIdentity(identity);
    if (this.value.phase !== 'prepared') fail('ORIGINAL_ATTEMPT_SPENT');
    // The permanent exclusive lock also covers a crash before the first journal save.
    const fd = io.openSync(this.path + '.apply.lock', constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { io.writeFileSync(fd,JSON.stringify(identity)+'\n'); io.fsyncSync(fd); } finally { io.closeSync(fd); }
    const directory = io.openSync(this.directory,constants.O_RDONLY);
    try { io.fsyncSync(directory); } finally { io.closeSync(directory); }
    this.reserved = true; this.value.phase='rehearsing'; this.save();
  }
  spend(identity) {
    this.assertAdmission(identity);
    if (!this.reserved || this.value.phase !== 'rehearsing') fail('ORIGINAL_ATTEMPT_SPENT');
    this.value.phase='send_spent'; this.save();
  }
  record(result) {
    this.assertIdentity(this.value.identity);
    if (!this.reserved || !Object.entries(this.value.identity).every(([key,value])=>equal(result[key],value))
      || !['committed','unconfirmed_reconcile_original'].includes(result.state)) fail('JOURNAL_IDENTITY_DRIFT');
    this.value.phase=result.state; this.value.result=result; this.save();
  }
}

export function runOperation(mode, { databaseUrl=process.env.SUPABASE_DB_URL, sourceSha=process.env.EXPECTED_SOURCE_SHA,
  operationId=process.env.ORIGINAL_OPERATION_ID, confirmation=process.env.APPLY_CONFIRMATION } = {}) {
  const operation = buildOperation();
  // Disabled/unbound apply never opens a journal or a DB transport.
  if (mode === 'apply' && (!operation.contract.executionEnabled || pendingFields(operation).length)) fail('EXECUTION_DISABLED_OR_UNBOUND');
  assertSuccessorDatabaseTarget(databaseUrl,{projectRef:operation.contract.projectRef,databaseName:operation.contract.database});
  const run = createThumbnailPsqlRunner(databaseUrl);
  return executeOperation(mode,operation,{sourceSha,operationId,confirmation,
    runner:(sql,single)=>run(databaseUrl,sql,single),journal:mode==='apply'||mode==='reconcile'?new OriginalJournal():undefined});
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(runOperation(process.argv[2]))); }
  catch (error) {
    console.error(/^GUARDIAN_SUCCESSOR_[A-Z_]+$/.test(error?.message ?? '') ? error.message : 'GUARDIAN_SUCCESSOR_OPERATION_FAILED');
    process.exitCode=1;
  }
}
