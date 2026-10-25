/**
 * Read existing local gh authority; never log in, refresh scopes or read tokens.
 * The result confirms an identity observation, not permission to apply SQL or
 * proof of stopped writers. Native UID/HOME checks are local custody routing
 * checks, not cryptographic hardware identity.
 */
import { spawnSync } from 'node:child_process';
import { homedir, userInfo } from 'node:os';

const GH = '/opt/homebrew/bin/gh';
const REPOSITORY = 'twoimo/tzudong';
const OWNER = 'twoimo';
const LIMIT = 64 * 1024;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{40}$/;
const OVERRIDES = [
  'GH_TOKEN', 'GITHUB_TOKEN', 'GH_CONFIG_DIR', 'GH_HOST',
  'GITHUB_ENTERPRISE_TOKEN', 'GH_ENTERPRISE_TOKEN',
];
const QUERIES = Object.freeze({
  user: '{login: .login, id: .id}',
  'repos/twoimo/tzudong': '{full_name: .full_name, owner: {login: .owner.login, id: .owner.id, type: .owner.type}, permissions: {admin: .permissions.admin}}',
  'repos/twoimo/tzudong/branches/main': '{name: .name, protected: .protected, commit: {sha: .commit.sha}}',
});
const fail = code => { throw Object.assign(new Error(code), { code }); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => object(value)
  && Object.keys(value).sort().join('\n') === [...keys].sort().join('\n');
const validId = value => Number.isSafeInteger(value) && value > 0;
const validDate = value => value instanceof Date && Number.isFinite(value.getTime());
const validUuid = value => typeof value === 'string' && UUID.test(value);
const validSha = value => typeof value === 'string' && SHA.test(value);

function assertLocalEnvironment(environment) {
  try {
    const native = userInfo();
    if (!object(environment) || environment.GITHUB_ACTIONS === 'true'
      || OVERRIDES.some(key => Object.hasOwn(environment, key))
      || typeof native.homedir !== 'string' || !native.homedir
      || environment.HOME !== native.homedir || homedir() !== native.homedir
      || typeof process.getuid !== 'function' || typeof process.geteuid !== 'function'
      || native.uid !== process.getuid() || native.uid !== process.geteuid()) {
      fail('THUMBNAIL_LOCAL_OWNER_ENVIRONMENT_INVALID');
    }
  } catch { fail('THUMBNAIL_LOCAL_OWNER_ENVIRONMENT_INVALID'); }
}

function githubGet(endpoint, environment) {
  if (!Object.hasOwn(QUERIES, endpoint)) fail('THUMBNAIL_LOCAL_OWNER_ARGUMENT_INVALID');
  let result;
  try {
    result = spawnSync(GH, [
      'api', '--hostname', 'github.com', '--method', 'GET', endpoint, '--jq', QUERIES[endpoint],
    ], {
      shell: false, encoding: 'utf8', timeout: 15_000, maxBuffer: LIMIT, killSignal: 'SIGKILL',
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...environment, GH_PROMPT_DISABLED: '1', GH_PAGER: 'cat', PAGER: 'cat', NO_COLOR: '1' },
    });
  } catch { fail('THUMBNAIL_LOCAL_OWNER_TRANSPORT_FAILED'); }
  if (result.error || result.status !== 0 || result.signal) fail('THUMBNAIL_LOCAL_OWNER_TRANSPORT_FAILED');
  return result.stdout;
}

function readProjection(get, endpoint) {
  let raw;
  try { raw = get(endpoint); }
  catch { fail('THUMBNAIL_LOCAL_OWNER_TRANSPORT_FAILED'); }
  if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > LIMIT || !raw.trim()) {
    fail('THUMBNAIL_LOCAL_OWNER_READBACK_INVALID');
  }
  let value;
  try { value = JSON.parse(raw); }
  catch { fail('THUMBNAIL_LOCAL_OWNER_READBACK_INVALID'); }
  if (!object(value)) fail('THUMBNAIL_LOCAL_OWNER_READBACK_INVALID');
  return value;
}

export function observeThumbnailLocalOwner({ environment = process.env, clock = () => new Date(), operationId } = {}, { githubGetImpl } = {}) {
  if (!validUuid(operationId) || typeof clock !== 'function'
    || (githubGetImpl !== undefined && typeof githubGetImpl !== 'function')) fail('THUMBNAIL_LOCAL_OWNER_ARGUMENT_INVALID');
  assertLocalEnvironment(environment);
  let started;
  try { started = clock(); } catch { fail('THUMBNAIL_LOCAL_OWNER_ARGUMENT_INVALID'); }
  if (!validDate(started)) fail('THUMBNAIL_LOCAL_OWNER_ARGUMENT_INVALID');
  // Test DI replaces only these fixed GETs and returns projected JSON text.
  const get = githubGetImpl ?? (endpoint => githubGet(endpoint, environment));
  const actor = readProjection(get, 'user');
  if (!exactKeys(actor, ['login', 'id']) || actor.login !== OWNER || !validId(actor.id)) {
    fail('THUMBNAIL_LOCAL_OWNER_IDENTITY_INVALID');
  }
  const repository = readProjection(get, 'repos/twoimo/tzudong');
  if (!exactKeys(repository, ['full_name', 'owner', 'permissions'])
    || !exactKeys(repository.owner, ['login', 'id', 'type'])
    || !exactKeys(repository.permissions, ['admin'])
    || repository.full_name !== REPOSITORY || repository.owner.login !== OWNER
    || repository.owner.type !== 'User' || !validId(repository.owner.id)
    || repository.owner.id !== actor.id || repository.permissions.admin !== true) {
    fail('THUMBNAIL_LOCAL_OWNER_IDENTITY_INVALID');
  }
  const branch = readProjection(get, 'repos/twoimo/tzudong/branches/main');
  if (!exactKeys(branch, ['name', 'protected', 'commit']) || !exactKeys(branch.commit, ['sha'])
    || branch.name !== 'main' || branch.protected !== true || !validSha(branch.commit.sha)) {
    fail('THUMBNAIL_LOCAL_OWNER_IDENTITY_INVALID');
  }
  // Use the beginning of the GET sequence: slow later reads must not make the
  // earlier identity observation appear newer. Raw login/id never leave here.
  const observation = Object.freeze({
    kind: 'thumbnail-local-owner-observation-v1', authority: 'authenticated-repository-owner-local-cli',
    operationId, repository: REPOSITORY, principal: 'repository-owner', identityVerified: true,
    branch: 'main', protected: true, sourceRevision: branch.commit.sha, observedAt: started.toISOString(),
  });
  let finished;
  try { finished = clock(); } catch { fail('THUMBNAIL_LOCAL_OWNER_ARGUMENT_INVALID'); }
  assertLocalEnvironment(environment);
  return validateThumbnailLocalOwner(observation, { sourceRevision: branch.commit.sha, now: finished, operationId });
}

export function validateThumbnailLocalOwner(observation, { sourceRevision, now, operationId } = {}) {
  if (!validSha(sourceRevision) || !validUuid(operationId) || !validDate(now)) fail('THUMBNAIL_LOCAL_OWNER_ARGUMENT_INVALID');
  if (!exactKeys(observation, [
    'kind', 'authority', 'operationId', 'repository', 'principal', 'identityVerified',
    'branch', 'protected', 'sourceRevision', 'observedAt',
  ]) || observation.kind !== 'thumbnail-local-owner-observation-v1'
    || observation.authority !== 'authenticated-repository-owner-local-cli'
    || observation.repository !== REPOSITORY || observation.principal !== 'repository-owner'
    || observation.identityVerified !== true || observation.branch !== 'main' || observation.protected !== true
    || !validSha(observation.sourceRevision) || !validUuid(observation.operationId)
    || typeof observation.observedAt !== 'string') fail('THUMBNAIL_LOCAL_OWNER_OBSERVATION_INVALID');
  const observed = new Date(observation.observedAt);
  if (!validDate(observed) || observed.toISOString() !== observation.observedAt) fail('THUMBNAIL_LOCAL_OWNER_OBSERVATION_INVALID');
  if (observation.sourceRevision !== sourceRevision || observation.operationId !== operationId) fail('THUMBNAIL_LOCAL_OWNER_BINDING_MISMATCH');
  if (observed > now || now.getTime() - observed.getTime() > 60_000) fail('THUMBNAIL_LOCAL_OWNER_STALE');
  return Object.freeze({ ...observation });
}
