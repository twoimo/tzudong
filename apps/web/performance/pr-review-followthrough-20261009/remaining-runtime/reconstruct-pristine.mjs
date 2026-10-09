// Prepare-only source. Executes exclusively against the admitted task-owned local clone.
import { readFileSync, writeFileSync, existsSync, lstatSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const base = '/Users/twoimo/.codex/runtime-cache/pipeline-recovery-20261007/pg17-refresh-20261009';
const input = `${base}/bound-snapshot-v3`;
const docker = '/opt/homebrew/bin/docker';
const context = 'colima-tzudong-catalog-20261007';
const containerName = 'tzudong-review-proof-20261009';
const owner = '01a0f860-10d0-71b0-bb2a-95c2b52e025e';
const manifestHash = 'ccd0373d1138301a586b75ab07f01ddcd061765d22e22da646e774cfc1e92563';
const key = 'TZUDONGOWNEDSNAPSHOT20261009';
const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const db = `tzudong_fresh_pg17_${suffix}`;
const resultPath = '/Users/twoimo/.codex/worktrees/pipeline-admin-integration-20261007/tzudong/apps/web/performance/pr-review-followthrough-20261009/remaining-runtime/pristine-reconstruction.json';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw new Error(code); };
const canonical = value => JSON.stringify(value, (_, v) => v && !Array.isArray(v) && typeof v === 'object'
  ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
const equal = (a, b, code) => { if (canonical(a) !== canonical(b)) fail(code); };
const literal = s => `'${String(s).replaceAll("'", "''")}'`;
const jsonLiteral = v => `${literal(JSON.stringify(v))}::jsonb`;
const assertionNames = ['assert_g014_workflow_owner_contract', 'assert_g014_public_rpc_allowlist',
  'assert_g014_definer_contract', 'assert_g014_catalog_contract'];
const expectedConstraintHash = '56d33b80dbab07f51d689705c3e11bc1a20730d7a3815a4435aade4deb538ce2';
const actualConstraintHash = '3ea7b4e9889fb9883ac563ee62dc6e6123d3e6edd56d02fc887dff7caf481a67';
const constraintName = 'tzuyang_address_evidence_admin_approval_receipt_signer_id_check';
let containerId, stage = 'input-admission';

function processResult(r, code) {
  if (r.error || r.status !== 0) fail(code);
  return r.stdout;
}
function localSql(name, sql, database = db) {
  stage = name;
  const r = spawnSync(docker, ['--context', context, 'exec', '-i', '-e', 'PGPASSWORD=fixture-only',
    containerId, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose',
    '-h', '127.0.0.1', '-U', 'supabase_admin', '-d', database],
  { input: sql, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
  if (r.error || r.status !== 0) {
    // Never print raw provider/database diagnostics or private snapshot content.
    const fixed = r.stderr?.match(/\b(?:FRESH_[A-Z0-9_]+)\b/)?.[0];
    console.error(JSON.stringify({ stage, sqlState: r.stderr?.match(/ERROR:\s+([A-Z0-9]{5})/)?.[1] ?? null,
      fixedCode: fixed ?? null, timeout: r.error?.code === 'ETIMEDOUT' }));
    fail(fixed ?? 'LOCAL_SQL_FAILED');
  }
  return r.stdout;
}
function readJsonResult(text) {
  const row = text.trim().split('\n').filter(s => s.startsWith('{')).at(-1);
  if (!row) fail('LOCAL_RESULT_MISSING');
  return JSON.parse(row);
}
function stringValues(line) {
  const values = [...line.matchAll(/'((?:[^']|'')*)'/g)].map(m => m[1].replaceAll("''", "'"));
  if (!line.includes(' VALUES (') || !line.endsWith(');')) fail('CONTRACT_INSERT_SHAPE');
  return values;
}
function andShape(expression) {
  const literals = expression.match(/'(?:[^']|'')*'/g) ?? [];
  const outside = expression.replace(/'(?:[^']|'')*'/g, 'LITERAL');
  if (/\b(?:OR|NOT)\b/i.test(outside) || (outside.match(/\bAND\b/gi) ?? []).length !== 2
      || !outside.includes('octet_length(signer_id)')) fail('CONSTRAINT_BOOLEAN_SHAPE');
  return { literals, skeleton: outside.replace(/[()\s]/g, '') };
}
function validateDumpMeta(sql) {
  const commands = sql.split('\n').filter(line => line.startsWith('\\'));
  equal(commands, [`\\restrict ${key}`, `\\unrestrict ${key}`], 'DUMP_META_COMMAND_DENIED');
}
function boolAnd(a, b) { return a === false || b === false ? false : a === null || b === null ? null : true; }

try {
  if (existsSync(resultPath)) fail('RESULT_ALREADY_EXISTS');
  const manifestBytes = readFileSync(`${input}/bound-snapshot-manifest.json`);
  if (sha(manifestBytes) !== manifestHash) fail('BOUND_MANIFEST_DRIFT');
  const manifest = JSON.parse(manifestBytes);
  if (!manifest.singleExportedRepeatableReadSnapshot || !manifest.exporterHeldUntilAllReadsCompleted
      || manifest.projectRef !== 'aqlcofblfxdrjhhdmarw' || manifest.ledgerCount !== 80
      || manifest.operatingWrites || manifest.userRowsCopied !== 0 || manifest.ledgerRowsCopied !== 0) fail('BOUND_SNAPSHOT_DENIED');
  const required = ['pg17-hosted-schema-private.sql', 'pg17-hosted-contract-private.sql',
    'pg17-hosted-role-metadata-private.json', 'pg17-hosted-extensions-private.json',
    'pg17-hosted-attributes-private.json', 'pg17-hosted-boundary-private.json', 'pg17-hosted-platform-settings-private.json'];
  equal(Object.keys(manifest.artifacts).sort(), [...required].sort(), 'INPUT_SET_DRIFT');
  const files = {};
  for (const name of required) {
    const path = `${input}/${name}`, st = lstatSync(path), bytes = readFileSync(path), proof = manifest.artifacts[name];
    if (!st.isFile() || st.isSymbolicLink() || bytes.length !== proof.bytes || sha(bytes) !== proof.sha256) fail('SNAPSHOT_HASH_DRIFT');
    files[name] = bytes.toString('utf8');
  }
  const roles = JSON.parse(files[required[2]]), extensions = JSON.parse(files[required[3]]);
  const attributes = JSON.parse(files[required[4]]), boundary = JSON.parse(files[required[5]]);
  if (roles.roles.length !== 37 || roles.members.length !== 29 || boundary.ledgerCount !== 80
      || boundary.manifestRows !== 1963 || boundary.databaseOwner !== 'postgres' || boundary.readOnly !== 'on') fail('BOUNDARY_DRIFT');
  equal(attributes.filter(a => a.dropped).map(a => a.position), [9, 10], 'DROPPED_ATTRIBUTES_DRIFT');
  const liveAttrs = attributes.filter(a => !a.dropped);
  if (liveAttrs.length !== 15 || liveAttrs.filter(a => a.position > 10).length !== 7) fail('ATTRIBUTE_COUNT_DRIFT');
  const constraints = files[required[1]].split('\n').filter(l => l.startsWith('INSERT INTO privacy_retention.g014_catalog_contract_manifest ') && l.includes(constraintName));
  if (constraints.length !== 1) fail('CONSTRAINT_SOURCE_MISSING');
  const cValues = stringValues(constraints[0]);
  if (cValues.length !== 3 || cValues[0] !== 'constraint') fail('CONSTRAINT_SOURCE_SHAPE');
  const sourceConstraint = JSON.parse(cValues[2]);
  const sourceShape = andShape(sourceConstraint.definition);
  let booleanCases = 0;
  for (const a of [true, false, null]) for (const b of [true, false, null]) for (const c of [true, false, null]) {
    booleanCases++;
    if (boolAnd(boolAnd(a, b), c) !== boolAnd(a, boolAnd(b, c))) fail('BOOLEAN_TRUTH_DRIFT');
  }
  const allowedTables = manifest.dataTables;
  equal([...allowedTables].sort(), ['privacy_retention.g014_catalog_contract_manifest',
    'privacy_retention.g014_nested_helper_allowlist', 'privacy_retention.g014_public_rpc_allowlist'].sort(), 'DATA_TABLE_SET_DRIFT');
  for (const line of files[required[1]].split('\n')) if (line.startsWith('INSERT INTO ')) {
    if (!allowedTables.some(t => line.startsWith(`INSERT INTO ${t} (`))) fail('DATA_INSERT_TARGET_DENIED');
  }
  validateDumpMeta(files[required[0]]); validateDumpMeta(files[required[1]]);
  // Ownership is checked before even the first SELECT. Subsequent execs use immutable container ID.
  const inspected = JSON.parse(processResult(spawnSync(docker, ['--context', context, 'inspect', containerName],
    { encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 }), 'CONTAINER_INSPECT_FAILED'));
  if (inspected.length !== 1) fail('CONTAINER_IDENTITY_DENIED');
  const target = inspected[0];
  if (target.Name !== `/${containerName}` || !target.State?.Running
      || target.Config?.Labels?.['tzudong.record-owner'] !== owner
      || target.Config?.Image !== 'supabase/postgres@sha256:fbe6c858a2ea9616aead3c39e132afcc0660decc5cb7dc656208ed145f5331ab'
      || target.HostConfig?.NetworkMode !== 'none'
      || Object.keys(target.HostConfig?.PortBindings ?? {}).length
      || Object.values(target.NetworkSettings?.Ports ?? {}).some(v => v !== null && v.length)) fail('CONTAINER_OWNERSHIP_DENIED');
  containerId = target.Id;
  if (!/^sha256:[a-f0-9]{64}$/.test(target.Image)) fail('CONTAINER_IMAGE_ID_DENIED');

  const bootstrap = readJsonResult(localSql('role-bootstrap-admission', `SELECT jsonb_build_object(
    'version',current_setting('server_version'),
    'roles',(SELECT jsonb_agg(jsonb_build_object('name',rolname,'superuser',rolsuper,'inherit',rolinherit,'createRole',rolcreaterole,'createDb',rolcreatedb,'login',rolcanlogin,'bypassRls',rolbypassrls,'replication',rolreplication,'connectionLimit',rolconnlimit,'config',rolconfig) ORDER BY rolname) FROM pg_roles),
    'members',(SELECT jsonb_agg(jsonb_build_object('role',pg_get_userbyid(roleid),'member',pg_get_userbyid(member),'grantor',pg_get_userbyid(grantor),'admin',admin_option,'inherit',inherit_option,'set',set_option) ORDER BY pg_get_userbyid(roleid),pg_get_userbyid(member),pg_get_userbyid(grantor)) FROM pg_auth_members));`, 'postgres'));
  if (!/^17\.6(?:\D|$)/.test(bootstrap.version)) fail('PG_VERSION_DRIFT');
  const normalizeRoles = rows => rows.map(r => ({ ...r, config: r.config ?? null })).sort((a,b) => a.name.localeCompare(b.name));
  const normalizeMembers = rows => [...rows].sort((a,b) => canonical(a).localeCompare(canonical(b)));
  equal(normalizeRoles(bootstrap.roles), normalizeRoles(roles.roles), 'ROLE_BOOTSTRAP_DRIFT');
  equal(normalizeMembers(bootstrap.members), normalizeMembers(roles.members), 'MEMBERSHIP_BOOTSTRAP_DRIFT');
  if (bootstrap.roles.find(r => r.name === 'postgres')?.superuser !== false) fail('POSTGRES_BASELINE_SUPERUSER');
  const platform = readJsonResult(localSql('platform-settings-admission', `SELECT jsonb_build_object('privilegedExtensions',current_setting('supautils.privileged_extensions',true),'privilegedRole',current_setting('supautils.privileged_role',true),'superuser',current_setting('supautils.superuser',true),'privilegedExtensionsSuperuser',current_setting('supautils.privileged_extensions_superuser',true));`, 'postgres'));
  equal(platform, {...JSON.parse(files['pg17-hosted-platform-settings-private.json']),privilegedExtensions:''}, 'BOOTSTRAP_PLATFORM_SETTINGS_DRIFT');
  localSql('create-owned-database', `CREATE DATABASE ${db} TEMPLATE template0 OWNER postgres;`, 'postgres');
  const extSeen = new Set();
  const schema = files[required[0]].replace(/^CREATE EXTENSION IF NOT EXISTS ("[^"]+"|[^ ]+) .*?;$/gm, line => {
    const name = line.match(/^CREATE EXTENSION IF NOT EXISTS ("[^"]+"|[^ ]+)/)[1].replaceAll('"', '');
    const ext = extensions.find(e => e.extname === name);
    if (!ext || extSeen.has(name) || !['postgres', 'supabase_admin'].includes(ext.owner)) fail('EXTENSION_OWNER_DENIED');
    extSeen.add(name);
    return ext.owner === 'postgres' ? `SET ROLE postgres;\n${line}\nRESET ROLE;` : line;
  });
  // pg_dump omits the template's built-in plpgsql extension. Still verify its owner/version below.
  equal([...extSeen].sort(), extensions.filter(e => e.extname !== 'plpgsql').map(e => e.extname).sort(), 'EXTENSION_DUMP_SET_DRIFT');
  localSql('schema-restore', `BEGIN; ALTER ROLE postgres SUPERUSER;\n${schema}\nRESET ROLE; ALTER ROLE postgres NOSUPERUSER; SET row_security=on; COMMIT;`);
  const restored = readJsonResult(localSql('restored-schema-preimages', `SELECT jsonb_build_object(
    'postgresSuperuser',(SELECT rolsuper FROM pg_roles WHERE rolname='postgres'),
    'databaseOwner',(SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()),
    'extensions',(SELECT jsonb_agg(jsonb_build_object('extname',e.extname,'owner',pg_get_userbyid(e.extowner),'schema',n.nspname,'version',e.extversion) ORDER BY e.extname) FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace),
    'attributes',(SELECT jsonb_agg(jsonb_build_object('name',attname,'type',format_type(atttypid,atttypmod),'nullable',NOT attnotnull,'position',attnum,'dropped',attisdropped) ORDER BY attnum) FROM pg_attribute WHERE attrelid='privacy_retention.privacy_retention_work_items'::regclass AND attnum>0),
    'constraint',(SELECT manifest_value FROM privacy_retention.g014_catalog_manifest_rows() WHERE manifest_kind='constraint' AND manifest_key=${jsonLiteral(JSON.parse(cValues[1]))}),
    'assertions',(SELECT jsonb_agg(jsonb_build_object('name',p.proname,'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text[],'config',p.proconfig,'bodySha256',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')) ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='privacy_retention' AND p.proname=ANY(ARRAY[${assertionNames.map(literal).join(',')}]) AND p.pronargs=0));`));
  if (restored.postgresSuperuser || restored.databaseOwner !== 'postgres') fail('RESTORE_ROLE_STATE_DRIFT');
  equal(restored.extensions, [...extensions].sort((a,b) => a.extname.localeCompare(b.extname)), 'EXTENSION_RESTORE_DRIFT');
  equal(restored.attributes, liveAttrs.map(a => ({ ...a, position: a.position > 10 ? a.position - 2 : a.position })), 'CLONE_ATTRIBUTE_LAYOUT_DRIFT');
  const boundAssertions = boundary.assertions.filter(a => assertionNames.includes(a.name)).sort((a,b) => a.name.localeCompare(b.name));
  if (boundAssertions.length !== 4) fail('ASSERTION_SNAPSHOT_INCOMPLETE');
  equal(restored.assertions, boundAssertions, 'ASSERTION_RESTORE_PREIMAGE_DRIFT');
  if (!restored.constraint) fail('CONSTRAINT_CLONE_MISSING');
  equal(andShape(restored.constraint.definition), sourceShape, 'CONSTRAINT_LITERAL_STRUCTURE_DRIFT');
  equal(Object.fromEntries(Object.entries(restored.constraint).filter(([k]) => k !== 'definition')),
    Object.fromEntries(Object.entries(sourceConstraint).filter(([k]) => k !== 'definition')), 'CONSTRAINT_NONEXPRESSION_DRIFT');

  // Use shadow tables for all three metadata sets. No UPDATE of protected live metadata.
  let data = files[required[1]];
  for (const [source, shadow] of [['g014_catalog_contract_manifest','clone_manifest'],
    ['g014_public_rpc_allowlist','clone_allowlist'], ['g014_nested_helper_allowlist','clone_nested']]) {
    data = data.replaceAll(`INSERT INTO privacy_retention.${source}`, `INSERT INTO pg_temp.${shadow}`);
  }
  const assertionSnapshotSql = `SELECT p.oid,p.prosrc,p.proacl,p.proconfig,p.proowner FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='privacy_retention' AND p.proname=ANY(ARRAY[${assertionNames.map(literal).join(',')}]) AND p.pronargs=0`;
  const assertions = assertionNames.map(n => `SELECT privacy_retention.${n}();`).join('\n');
  const expectedAssertions = boundary.assertions.filter(a => assertionNames.includes(a.name));
  if (expectedAssertions.length !== 4) fail('ASSERTION_SNAPSHOT_INCOMPLETE');
  const metadata = localSql('shadow-projection-and-initial-insert', `BEGIN;
SET ROLE privacy_workflow_owner; CREATE TEMP TABLE clone_temp_anchor(value boolean); RESET ROLE;
CREATE TEMP TABLE clone_manifest (LIKE privacy_retention.g014_catalog_contract_manifest INCLUDING ALL);
CREATE TEMP TABLE clone_allowlist (LIKE privacy_retention.g014_public_rpc_allowlist INCLUDING ALL);
CREATE TEMP TABLE clone_nested (LIKE privacy_retention.g014_nested_helper_allowlist INCLUDING ALL);
CREATE TEMP TABLE clone_function_before AS ${assertionSnapshotSql};
${data}
SET row_security=on;
CREATE TEMP TABLE clone_allowlist_before AS TABLE clone_allowlist;
CREATE TEMP TABLE clone_manifest_before AS TABLE clone_manifest;
DO $fresh$ DECLARE n integer; BEGIN
 IF (SELECT count(*) FROM clone_manifest)<>1963 OR EXISTS(SELECT 1 FROM privacy_retention.g014_catalog_contract_manifest) OR EXISTS(SELECT 1 FROM privacy_retention.g014_public_rpc_allowlist) OR EXISTS(SELECT 1 FROM privacy_retention.g014_nested_helper_allowlist) THEN RAISE EXCEPTION 'FRESH_INITIAL_METADATA_DENIED'; END IF;
 IF (SELECT count(*) FROM clone_function_before)<>4 THEN RAISE EXCEPTION 'FRESH_ASSERTION_COUNT'; END IF;
 IF EXISTS(SELECT 1 FROM clone_allowlist a LEFT JOIN pg_proc p ON p.oid=to_regprocedure(a.source_signature) LEFT JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE p.oid IS NULL OR ns.nspname<>a.function_schema OR p.proname<>a.function_name OR to_regrole(a.grantee) IS NULL OR NOT has_function_privilege(a.grantee,p.oid,'EXECUTE')) THEN RAISE EXCEPTION 'FRESH_ALLOWLIST_IDENTITY_GRANTEE'; END IF;
 SELECT count(*) INTO n FROM clone_allowlist a JOIN pg_proc p ON p.oid=to_regprocedure(a.source_signature) WHERE a.identity_arguments<>p.proargtypes::text;
 IF n<>8 THEN RAISE EXCEPTION 'FRESH_OID_PROJECTION_COUNT'; END IF;
 UPDATE clone_allowlist a SET identity_arguments=p.proargtypes::text FROM pg_proc p WHERE p.oid=to_regprocedure(a.source_signature) AND a.identity_arguments<>p.proargtypes::text;
 IF EXISTS((SELECT function_schema,function_name,grantee,source_signature FROM clone_allowlist EXCEPT SELECT function_schema,function_name,grantee,source_signature FROM clone_allowlist_before) UNION ALL (SELECT function_schema,function_name,grantee,source_signature FROM clone_allowlist_before EXCEPT SELECT function_schema,function_name,grantee,source_signature FROM clone_allowlist)) THEN RAISE EXCEPTION 'FRESH_NONOID_ALLOWLIST_DRIFT'; END IF;
 UPDATE clone_manifest e SET manifest_value=jsonb_set(e.manifest_value,'{position}',a.manifest_value->'position') FROM privacy_retention.g014_catalog_manifest_rows() a WHERE e.manifest_kind='column' AND a.manifest_kind=e.manifest_kind AND a.manifest_key=e.manifest_key AND e.manifest_key->>'schema'='privacy_retention' AND e.manifest_key->>'relation'='privacy_retention_work_items' AND (e.manifest_value-'position')=(a.manifest_value-'position') AND (e.manifest_value->>'position')::integer=(a.manifest_value->>'position')::integer+2;
 GET DIAGNOSTICS n=ROW_COUNT; IF n<>7 THEN RAISE EXCEPTION 'FRESH_COLUMN_PROJECTION_COUNT'; END IF;
 UPDATE clone_manifest e SET manifest_value=a.manifest_value FROM privacy_retention.g014_catalog_manifest_rows() a WHERE e.manifest_kind='constraint' AND a.manifest_kind=e.manifest_kind AND a.manifest_key=e.manifest_key AND e.manifest_key=${jsonLiteral(JSON.parse(cValues[1]))} AND encode(sha256(convert_to(e.manifest_value::text,'UTF8')),'hex')=${literal(expectedConstraintHash)} AND encode(sha256(convert_to(a.manifest_value::text,'UTF8')),'hex')=${literal(actualConstraintHash)};
 GET DIAGNOSTICS n=ROW_COUNT; IF n<>1 THEN RAISE EXCEPTION 'FRESH_CONSTRAINT_PREIMAGE_DRIFT'; END IF;
 IF (SELECT count(*) FROM (SELECT b.* FROM clone_manifest_before b JOIN clone_manifest a USING(manifest_kind,manifest_key) WHERE b.manifest_value<>a.manifest_value) x)<>8 THEN RAISE EXCEPTION 'FRESH_MANIFEST_CHANGE_COUNT'; END IF;
 IF EXISTS(SELECT 1 FROM clone_manifest e FULL JOIN privacy_retention.g014_catalog_manifest_rows() a USING(manifest_kind,manifest_key) WHERE e.manifest_value IS DISTINCT FROM a.manifest_value) THEN RAISE EXCEPTION 'FRESH_PROJECTED_CATALOG_MISMATCH'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='privacy_retention.g014_catalog_contract_manifest'::regclass AND tgname='g014_catalog_manifest_immutable' AND tgenabled IN ('O','A') AND NOT tgisinternal) THEN RAISE EXCEPTION 'FRESH_IMMUTABLE_TRIGGER_DISABLED'; END IF;
END $fresh$;
INSERT INTO privacy_retention.g014_catalog_contract_manifest SELECT * FROM clone_manifest;
INSERT INTO privacy_retention.g014_public_rpc_allowlist SELECT * FROM clone_allowlist;
INSERT INTO privacy_retention.g014_nested_helper_allowlist SELECT * FROM clone_nested;
${assertions}
DO $fresh$ BEGIN
 IF EXISTS((${assertionSnapshotSql} EXCEPT SELECT * FROM clone_function_before) UNION ALL (SELECT * FROM clone_function_before EXCEPT ${assertionSnapshotSql})) THEN RAISE EXCEPTION 'FRESH_ASSERTION_CHANGED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='privacy_retention.g014_catalog_contract_manifest'::regclass AND tgname='g014_catalog_manifest_immutable' AND tgenabled IN ('O','A') AND NOT tgisinternal) THEN RAISE EXCEPTION 'FRESH_IMMUTABLE_TRIGGER_DISABLED'; END IF;
END $fresh$;
SELECT jsonb_build_object('manifestRows',(SELECT count(*) FROM privacy_retention.g014_catalog_contract_manifest),'allowlistRows',(SELECT count(*) FROM privacy_retention.g014_public_rpc_allowlist),'nestedRows',(SELECT count(*) FROM privacy_retention.g014_nested_helper_allowlist),'postgresSuperuser',(SELECT rolsuper FROM pg_roles WHERE rolname='postgres'),'ownerSet',pg_has_role('postgres','privacy_workflow_owner','SET'),'ownerUsage',pg_has_role('postgres','privacy_workflow_owner','USAGE'),'booleanCases',27,'booleanMismatches',(SELECT count(*) FROM (VALUES(true),(false),(null::boolean)) x(a) CROSS JOIN (VALUES(true),(false),(null::boolean)) y(b) CROSS JOIN (VALUES(true),(false),(null::boolean)) z(c) WHERE ((a AND b) AND c) IS DISTINCT FROM (a AND b AND c)),
'assertions',(SELECT jsonb_agg(jsonb_build_object('name',p.proname,'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text[],'config',p.proconfig,'bodySha256',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')) ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='privacy_retention' AND p.proname=ANY(ARRAY[${assertionNames.map(literal).join(',')}]) AND p.pronargs=0));
COMMIT;`);
  const summary = readJsonResult(metadata);
  equal(summary.assertions, expectedAssertions.sort((a,b) => a.name.localeCompare(b.name)), 'ASSERTION_BOUND_SNAPSHOT_DRIFT');
  if (summary.postgresSuperuser || summary.ownerSet || summary.ownerUsage || summary.booleanMismatches !== 0 || summary.booleanCases !== booleanCases) fail('FINAL_ROLE_OR_BOOLEAN_DRIFT');
  const afterMembers = readJsonResult(localSql('final-membership-admission', `SELECT jsonb_build_object('members',(SELECT jsonb_agg(jsonb_build_object('role',pg_get_userbyid(roleid),'member',pg_get_userbyid(member),'grantor',pg_get_userbyid(grantor),'admin',admin_option,'inherit',inherit_option,'set',set_option)) FROM pg_auth_members));`));
  equal(normalizeMembers(afterMembers.members), normalizeMembers(roles.members), 'FINAL_MEMBERSHIP_DRIFT');
  const result = { kind:'fresh-bound-pg17-schema-contract-reconstruction',status:'passed',observedAt:new Date().toISOString(),
    snapshotSourceCommit:manifest.sourceCommit,snapshotManifestSha256:manifestHash,inputs:manifest.artifacts,
    helperSha256:sha(readFileSync(new URL(import.meta.url))),container:{id:containerId,imageId:target.Image,name:containerName,owner,network:'none',ports:0},database:db,
    metadata:summary,assertionsPassed:4,bootstrapExtensionDelegationTemporarilyDisabled:true,requiresSourceRuntimeSettingsBeforeReplay:true,projections:{argumentOidRows:8,droppedColumnPositions:7,booleanAssociativityRows:1,cloneOnly:true},
    immutableTriggerDisabled:false,assertionCodeChanged:false,temporaryRestoreSuperuserReverted:true,
    hostedLedgerCountObserved:80,ledgerRowsCopied:0,userRowsCopied:0,operatingWrites:false,
    limitations:['Clone-only physical OID/attnum and proven Boolean regrouping projections.','No hosted application, deployment, user workflow, physical Storage deletion or performance proof.'] };
  writeFileSync(resultPath, JSON.stringify(result,null,2)+'\n',{mode:0o600,flag:'wx'});
  console.log(JSON.stringify({status:'passed',database:db,resultPath,snapshotManifestSha256:manifestHash,assertionsPassed:4}));
} catch (error) {
  console.error(JSON.stringify({status:'failed',stage,code:/^[A-Z0-9_]+$/.test(error.message)?error.message:'RECONSTRUCTION_UNCONFIRMED',database:db,
    note:'Do not retry against this database or claim pass; inspect the owned clone state first.'}));
  process.exitCode=2;
}
