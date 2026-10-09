import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = dirname(fileURLToPath(import.meta.url));
const repo = resolve(out, '../../../../..');
const docker = '/opt/homebrew/bin/docker';
const context = 'colima-tzudong-catalog-20261007';
const image = 'supabase/postgres@sha256:fbe6c858a2ea9616aead3c39e132afcc0660decc5cb7dc656208ed145f5331ab';
const nonce = randomBytes(12).toString('hex');
const name = `tzudong-actual-bundle-${nonce}`;
const owner = `actual-bundle-${nonce}`;
const volume = name;
const bootstrapSource = resolve(repo, 'apps/web/performance/record-review-fixes-20261009/bootstrap-snapshot-roles-final.mjs');
const reconstructionSource = resolve(repo, 'apps/web/performance/record-review-fixes-20261009/reconstruct-pristine-final.mjs');
const bootstrapResult = resolve(out, 'role-bootstrap.json');
const reconstructionResult = resolve(out, 'pristine-reconstruction.json');
const replayResult = resolve(out, 'proof.json');
const tempRoot = `/tmp/${name}`;
const receiptPath = resolve(out, 'ownership-receipt.json');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const privilegedExtensions = 'address_standardizer, address_standardizer_data_us, amcheck, autoinc, bloom, btree_gin, btree_gist, citext, cube, dblink, dict_int, dict_xsyn, earthdistance, fuzzystrmatch, hstore, http, hypopg, index_advisor, insert_username, intarray, isn, ltree, moddatetime, orioledb, pg_buffercache, pg_cron, pg_graphql, pg_hashids, pg_jsonschema, pg_net, pg_prewarm, pg_repack, pg_stat_monitor, pg_stat_statements, pg_tle, pg_trgm, pg_walinspect, pgaudit, pgcrypto, pgjwt, pgroonga, pgroonga_database, pgrouting, pgrowlocks, pgsodium, pgstattuple, pgtap, plcoffee, pljava, plls, plpgsql_check, plv8, postgis, postgis_raster, postgis_sfcgal, postgis_tiger_geocoder, postgis_topology, postgres_fdw, refint, rum, seg, sslinfo, supabase_vault, supautils, tablefunc, tcn, timescaledb, tsm_system_rows, tsm_system_time, unaccent, uuid-ossp, vector, wrappers';
const result = {
  kind: 'actual-four-bundle-owned-cluster',
  status: 'unconfirmed',
  nonce,
  container: name,
  volume,
  image,
  owner,
  network: 'none',
  publishedPorts: 0,
  operatingWrites: false,
  hostedWrites: false,
  cleanup: { containerRemoved: false, volumeRemoved: false, temporaryScriptsRemoved: false },
};

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function run(executable, args, { timeout = 60000, input } = {}) {
  const child = spawnSync(executable, args, {
    cwd: repo,
    encoding: 'utf8',
    input,
    timeout,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (child.error || child.status !== 0) {
    const error = new Error('OWNED_COMMAND_FAILED');
    error.code = child.error?.code === 'ETIMEDOUT' ? 'OWNED_COMMAND_TIMEOUT' : 'OWNED_COMMAND_FAILED';
    error.exitCode = child.status;
    error.fixedCode = (child.stderr ?? '').match(/\b[A-Z][A-Z0-9_]{3,96}\b/)?.[0] ?? null;
    throw error;
  }
  return child.stdout ?? '';
}

function patchedSource(path, resultPath) {
  let source = readFileSync(path, 'utf8');
  source = source.replace("container='tzudong-record-fixes-20261009-final'", `container='${name}'`);
  source = source.replace("const containerName = 'tzudong-record-fixes-20261009-final';", `const containerName = '${name}';`);
  source = source.replace("'01a0f860-10d0-71b0-bb2a-95c2b52e025e'", `'${owner}'`);
  source = source.replace("const owner = '01a0f860-10d0-71b0-bb2a-95c2b52e025e';", `const owner = '${owner}';`);
  source = source.replace(/writeFileSync\('.*?role-bootstrap-final\.json'/, `writeFileSync('${resultPath}'`);
  source = source.replace(/const resultPath = '.*?pristine-reconstruction-final\.json';/, `const resultPath = '${resultPath}';`);
  if (!source.includes(name) || !source.includes(resultPath)) fail('PATCH_BINDING_FAILED');
  return source;
}

function containerArguments(extensionSetting) {
  return ['-d', '--name', name, '--network', 'none',
    '--label', `tzudong.record-owner=${owner}`, '--label', `tzudong.actual-bundle=${nonce}`,
    '-e', 'POSTGRES_PASSWORD=fixture-only', '-e', 'POSTGRES_USER=supabase_admin', '-e', 'POSTGRES_DB=postgres',
    '-e', 'PGPASSWORD=fixture-only', '-e', 'POSTGRES_HOST=/var/run/postgresql',
    '-e', 'POSTGRES_INITDB_ARGS=--allow-group-access --locale-provider=icu --encoding=UTF-8 --icu-locale=en_US.UTF-8',
    '-v', `${volume}:/var/lib/postgresql/data:Z`, image,
    'postgres', '-D', '/etc/postgresql',
    '-c', 'supautils.privileged_role=supabase_privileged_role',
    '-c', 'supautils.superuser=supabase_admin',
    '-c', 'supautils.privileged_extensions_superuser=supabase_admin',
    '-c', `supautils.privileged_extensions=${extensionSetting}`];
}

function waitReady() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const probe = spawnSync(docker, ['--context', context, 'exec', '-e', 'PGPASSWORD=fixture-only', name,
      'pg_isready', '-h', '127.0.0.1', '-U', 'supabase_admin', '-d', 'postgres'], { encoding: 'utf8', timeout: 5000 });
    if (probe.status === 0) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  }
  fail('OWNED_CLUSTER_NOT_READY');
}

mkdirSync(out, { recursive: true });
mkdirSync(tempRoot, { recursive: true });
if ([bootstrapResult, reconstructionResult, replayResult, receiptPath].some(existsSync)) fail('RESULT_ALREADY_EXISTS');
writeFileSync(receiptPath, `${JSON.stringify({ ...result, observedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600, flag: 'wx' });

try {
  run(docker, ['--context', context, 'run', ...containerArguments('')], { timeout: 30000 });
  waitReady();

  const bootstrapTemp = resolve(tempRoot, 'bootstrap.mjs');
  const reconstructionTemp = resolve(tempRoot, 'reconstruct.mjs');
  writeFileSync(bootstrapTemp, patchedSource(bootstrapSource, bootstrapResult), { mode: 0o600 });
  writeFileSync(reconstructionTemp, patchedSource(reconstructionSource, reconstructionResult), { mode: 0o600 });
  run(process.execPath, [bootstrapTemp], { timeout: 120000 });
  run(process.execPath, [reconstructionTemp], { timeout: 180000 });
  const reconstruction = JSON.parse(readFileSync(reconstructionResult, 'utf8'));
  if (reconstruction.status !== 'passed' || !/^tzudong_fresh_pg17_[a-f0-9]{12}$/.test(reconstruction.database)) {
    fail('RECONSTRUCTION_RECEIPT_INVALID');
  }
  run(docker, ['--context', context, 'stop', '--time', '20', name], { timeout: 30000 });
  run(docker, ['--context', context, 'rm', name], { timeout: 30000 });
  run(docker, ['--context', context, 'run', ...containerArguments(privilegedExtensions)], { timeout: 30000 });
  waitReady();
  run(process.execPath, [resolve(out, 'replay.mjs'), '--container', name, '--source-database', reconstruction.database,
    '--nonce', nonce, '--output', replayResult], { timeout: 360000 });
  const proof = JSON.parse(readFileSync(replayResult, 'utf8'));
  if (proof.status !== 'passed') fail('REPLAY_RECEIPT_INVALID');
  result.status = 'passed';
  result.serverVersion = proof.serverVersion;
  result.snapshotManifestSha256 = reconstruction.snapshotManifestSha256;
  result.sourceHead = proof.sourceHead;
  result.replaySha256 = sha256(readFileSync(replayResult));
} catch (error) {
  result.failure = {
    code: /^[A-Z0-9_]+$/.test(error.code ?? error.message) ? (error.code ?? error.message) : 'OWNED_REPLAY_UNCONFIRMED',
    fixedCode: /^[A-Z0-9_]+$/.test(error.fixedCode ?? '') ? error.fixedCode : null,
    exitCode: Number.isInteger(error.exitCode) ? error.exitCode : null,
  };
} finally {
  const removed = spawnSync(docker, ['--context', context, 'rm', '-f', name], { encoding: 'utf8', timeout: 30000 });
  result.cleanup.containerRemoved = removed.status === 0;
  const volumeRemoved = spawnSync(docker, ['--context', context, 'volume', 'rm', volume], { encoding: 'utf8', timeout: 30000 });
  result.cleanup.volumeRemoved = volumeRemoved.status === 0;
  rmSync(tempRoot, { recursive: true, force: true });
  result.cleanup.temporaryScriptsRemoved = !existsSync(tempRoot);
  result.completedAt = new Date().toISOString();
  writeFileSync(receiptPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ status: result.status, cleanup: result.cleanup, failure: result.failure ?? null }));
}

if (result.status !== 'passed' || Object.values(result.cleanup).some(value => !value)) process.exitCode = 1;
