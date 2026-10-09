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
const imageId = 'sha256:fbe6c858a2ea9616aead3c39e132afcc0660decc5cb7dc656208ed145f5331ab';
const nativeBin = '/Users/twoimo/.codex/runtime-cache/tzudong-postgresql-17.6/installed/bin';
const nonce = randomBytes(12).toString('hex');
const name = `tzudong-five-forward-amendment-${nonce}`;
const owner = `five-forward-amendment-${nonce}`;
const volume = name;
const tempRoot = `/tmp/${name}`;
const nativeRoot = `/tmp/${name}-native`;
const bootstrapSource = resolve(repo, 'apps/web/performance/record-review-fixes-20261009/bootstrap-snapshot-roles-final.mjs');
const reconstructionSource = resolve(repo, 'apps/web/performance/record-review-fixes-20261009/reconstruct-pristine-final.mjs');
const bootstrapResult = resolve(out, 'role-bootstrap.json');
const reconstructionResult = resolve(out, 'pristine-reconstruction.json');
const replayResult = resolve(out, 'proof.json');
const nativeResult = resolve(out, 'native-admission.json');
const receiptPath = resolve(out, 'ownership-receipt.json');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const requiredExtensions = ['btree_gin', 'fuzzystrmatch', 'hypopg', 'index_advisor', 'pg_stat_statements', 'pg_trgm', 'pgcrypto', 'plpgsql', 'supabase_vault', 'uuid-ossp', 'vector'];
const privilegedExtensions = 'address_standardizer, address_standardizer_data_us, amcheck, autoinc, bloom, btree_gin, btree_gist, citext, cube, dblink, dict_int, dict_xsyn, earthdistance, fuzzystrmatch, hstore, http, hypopg, index_advisor, insert_username, intarray, isn, ltree, moddatetime, orioledb, pg_buffercache, pg_cron, pg_graphql, pg_hashids, pg_jsonschema, pg_net, pg_prewarm, pg_repack, pg_stat_monitor, pg_stat_statements, pg_tle, pg_trgm, pg_walinspect, pgaudit, pgcrypto, pgjwt, pgroonga, pgroonga_database, pgrouting, pgrowlocks, pgsodium, pgstattuple, pgtap, plcoffee, pljava, plls, plpgsql_check, plv8, postgis, postgis_raster, postgis_sfcgal, postgis_tiger_geocoder, postgis_topology, postgres_fdw, refint, rum, seg, sslinfo, supabase_vault, supautils, tablefunc, tcn, timescaledb, tsm_system_rows, tsm_system_time, unaccent, uuid-ossp, vector, wrappers';

const result = {
  kind: 'five-plus-admin-user-rpc-forward-m5-pagination-amendment-owned-cluster',
  status: 'unconfirmed',
  nonce,
  container: name,
  volume,
  image,
  imageId,
  owner,
  network: 'none',
  publishedPorts: 0,
  operatingWrites: false,
  hostedWrites: false,
  cleanup: { nativeClusterRemoved: false, containerRemoved: false, volumeRemoved: false, temporaryScriptsRemoved: false },
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
    maxBuffer: 64 * 1024 * 1024,
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
    '--label', `tzudong.record-owner=${owner}`, '--label', `tzudong.five-forward-amendment=${nonce}`,
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

function nativeAdmission() {
  const data = resolve(nativeRoot, 'data');
  const socket = resolve(nativeRoot, 'socket');
  const port = 57000 + (Number.parseInt(nonce.slice(0, 6), 16) % 1000);
  const native = {
    kind: 'owned-native-pg17-admission',
    status: 'unconfirmed',
    binaryRoot: nativeBin,
    expectedVersion: '17.6',
    socket,
    port,
    networkListeners: 0,
    requiredExtensions,
    cleanup: { stopped: false, removed: false },
  };
  let started = false;
  mkdirSync(data, { recursive: true });
  mkdirSync(socket, { recursive: true });
  try {
    const binaryVersion = run(resolve(nativeBin, 'postgres'), ['--version']).trim();
    if (!/PostgreSQL\) 17\.6$/.test(binaryVersion)) fail('NATIVE_BINARY_VERSION_DRIFT');
    run(resolve(nativeBin, 'initdb'), ['-D', data, '--no-locale', '--encoding=UTF8', '--auth=trust']);
    run(resolve(nativeBin, 'pg_ctl'), ['-D', data, '-l', resolve(nativeRoot, 'server.log'), '-o', `-h '' -k ${socket} -p ${port}`, '-w', 'start'], { timeout: 30000 });
    started = true;
    const observation = JSON.parse(run(resolve(nativeBin, 'psql'), ['-X', '-qAt', '-h', socket, '-p', String(port), '-d', 'postgres', '-c',
      `SELECT json_build_object('version',current_setting('server_version'),'versionNum',current_setting('server_version_num')::int,'availableExtensions',coalesce((SELECT json_agg(name ORDER BY name) FROM pg_available_extensions WHERE name=ANY(ARRAY[${requiredExtensions.map(value => `'${value}'`).join(',')}])), '[]'::json))::text;`]).trim());
    if (observation.version !== '17.6' || observation.versionNum !== 170006) fail('NATIVE_SERVER_VERSION_DRIFT');
    const available = new Set(observation.availableExtensions);
    native.serverVersion = observation.version;
    native.serverVersionNum = observation.versionNum;
    native.availableRequiredExtensions = [...available].sort();
    native.missingRequiredExtensions = requiredExtensions.filter(value => !available.has(value));
    native.fullSchemaEligible = native.missingRequiredExtensions.length === 0;
    native.fullSchemaFallback = native.fullSchemaEligible ? null : 'cached-exact-17.6-supabase-image';
    native.status = 'passed';
  } catch (error) {
    native.failure = {
      code: /^[A-Z0-9_]+$/.test(error.code ?? error.message) ? (error.code ?? error.message) : 'NATIVE_ADMISSION_UNCONFIRMED',
      fixedCode: /^[A-Z0-9_]+$/.test(error.fixedCode ?? '') ? error.fixedCode : null,
    };
  } finally {
    if (started) {
      const stopped = spawnSync(resolve(nativeBin, 'pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop'], { encoding: 'utf8', timeout: 30000 });
      native.cleanup.stopped = stopped.status === 0;
    } else native.cleanup.stopped = true;
    rmSync(nativeRoot, { recursive: true, force: true });
    native.cleanup.removed = !existsSync(nativeRoot);
    native.completedAt = new Date().toISOString();
    writeFileSync(nativeResult, `${JSON.stringify(native, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  }
  if (native.status !== 'passed' || !native.cleanup.stopped || !native.cleanup.removed) fail('NATIVE_ADMISSION_FAILED');
  return native;
}

mkdirSync(out, { recursive: true });
mkdirSync(tempRoot, { recursive: true });
if ([bootstrapResult, reconstructionResult, replayResult, nativeResult, receiptPath].some(existsSync)) fail('RESULT_ALREADY_EXISTS');
writeFileSync(receiptPath, `${JSON.stringify({ ...result, observedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600, flag: 'wx' });

try {
  const native = nativeAdmission();
  result.nativeServerVersion = native.serverVersion;
  result.nativeServerVersionNum = native.serverVersionNum;
  result.nativeFullSchemaEligible = native.fullSchemaEligible;
  result.nativeMissingRequiredExtensions = native.missingRequiredExtensions;
  result.cleanup.nativeClusterRemoved = native.cleanup.stopped && native.cleanup.removed;

  const inspectedImage = JSON.parse(run(docker, ['--context', context, 'image', 'inspect', image], { timeout: 30000 }))[0];
  if (inspectedImage.Id !== imageId) fail('CACHED_IMAGE_ID_DRIFT');
  result.imageSource = 'local-cache-only';

  run(docker, ['--context', context, 'run', '--pull=never', ...containerArguments('')], { timeout: 30000 });
  waitReady();
  const bootstrapTemp = resolve(tempRoot, 'bootstrap.mjs');
  const reconstructionTemp = resolve(tempRoot, 'reconstruct.mjs');
  writeFileSync(bootstrapTemp, patchedSource(bootstrapSource, bootstrapResult), { mode: 0o600 });
  writeFileSync(reconstructionTemp, patchedSource(reconstructionSource, reconstructionResult), { mode: 0o600 });
  run(process.execPath, [bootstrapTemp], { timeout: 120000 });
  run(process.execPath, [reconstructionTemp], { timeout: 240000 });
  const reconstruction = JSON.parse(readFileSync(reconstructionResult, 'utf8'));
  if (reconstruction.status !== 'passed' || !/^tzudong_fresh_pg17_[a-f0-9]{12}$/.test(reconstruction.database)) {
    fail('RECONSTRUCTION_RECEIPT_INVALID');
  }

  run(docker, ['--context', context, 'stop', '--time', '20', name], { timeout: 30000 });
  run(docker, ['--context', context, 'rm', name], { timeout: 30000 });
  run(docker, ['--context', context, 'run', '--pull=never', ...containerArguments(privilegedExtensions)], { timeout: 30000 });
  waitReady();

  run(process.execPath, [resolve(out, 'replay.mjs'), '--container', name, '--source-database', reconstruction.database,
    '--nonce', nonce, '--output', replayResult], { timeout: 600000 });
  const proof = JSON.parse(readFileSync(replayResult, 'utf8'));
  if (proof.status !== 'passed') fail('REPLAY_RECEIPT_INVALID');
  result.status = 'passed';
  result.serverVersion = proof.serverVersion;
  result.serverVersionNum = proof.serverVersionNum;
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
  const containerAbsent = spawnSync(docker, ['--context', context, 'inspect', name], { encoding: 'utf8', timeout: 10000 });
  result.cleanup.containerRemoved = removed.status === 0 || containerAbsent.status !== 0;
  const volumeRemoved = spawnSync(docker, ['--context', context, 'volume', 'rm', volume], { encoding: 'utf8', timeout: 30000 });
  const volumeAbsent = spawnSync(docker, ['--context', context, 'volume', 'inspect', volume], { encoding: 'utf8', timeout: 10000 });
  result.cleanup.volumeRemoved = volumeRemoved.status === 0 || volumeAbsent.status !== 0;
  rmSync(tempRoot, { recursive: true, force: true });
  result.cleanup.temporaryScriptsRemoved = !existsSync(tempRoot);
  result.completedAt = new Date().toISOString();
  writeFileSync(receiptPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ status: result.status, cleanup: result.cleanup, failure: result.failure ?? null }));
}

if (result.status !== 'passed' || Object.values(result.cleanup).some(value => !value)) process.exitCode = 1;
