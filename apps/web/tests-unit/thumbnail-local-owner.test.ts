import { homedir, userInfo } from 'node:os';
import { expect, test } from 'bun:test';
import { observeThumbnailLocalOwner, validateThumbnailLocalOwner } from '../scripts/thumbnail-local-owner.mjs';

const operationId = '01234567-89ab-4cde-8fab-0123456789ab';
const revision = 'a'.repeat(40);
const observedAt = '2026-10-24T12:00:00.000Z';
const now = () => new Date(observedAt);
const expected = () => ({
  kind: 'thumbnail-local-owner-observation-v1', authority: 'authenticated-repository-owner-local-cli',
  operationId, repository: 'twoimo/tzudong', principal: 'repository-owner', identityVerified: true,
  branch: 'main', protected: true, sourceRevision: revision, observedAt,
});
function fixture() {
  const environment: any = { HOME: userInfo().homedir };
  const responses: Record<string, any> = {
    user: { login: 'twoimo', id: 998877665 },
    'repos/twoimo/tzudong': {
      full_name: 'twoimo/tzudong', owner: { login: 'twoimo', id: 998877665, type: 'User' },
      permissions: { admin: true },
    },
    'repos/twoimo/tzudong/branches/main': { name: 'main', protected: true, commit: { sha: revision } },
  };
  const calls: string[] = [];
  const dependencies: any = { githubGetImpl: (endpoint: string) => {
    calls.push(endpoint); return JSON.stringify(responses[endpoint], null, 2) + '\n';
  } };
  const options: any = { environment, operationId, clock: now };
  return { environment, responses, calls, dependencies, options,
    run: () => observeThumbnailLocalOwner(options, dependencies) };
}
function expectCode(run: () => unknown, code: string) {
  let caught: any;
  try { run(); } catch (error) { caught = error; }
  expect(caught?.code).toBe(code);
  expect(caught?.message).toBe(code);
  expect(caught?.cause).toBeUndefined();
}
const validate = (value: any, time = now()) => validateThumbnailLocalOwner(value, { sourceRevision: revision, operationId, now: time });

test('three fixed projected GETs verify the existing native account and return only the bound minimal observation', () => {
  const f = fixture();
  expect(userInfo().uid).toBe(process.getuid!());
  expect(userInfo().homedir).toBe(homedir());
  const observation = f.run();
  expect(f.calls).toEqual(['user', 'repos/twoimo/tzudong', 'repos/twoimo/tzudong/branches/main']);
  expect(observation).toEqual(expected());
  expect(Object.isFrozen(observation)).toBe(true);
  expect(JSON.stringify(observation)).not.toContain('998877665');
  expect(JSON.stringify(observation)).not.toContain('login');
  expect(JSON.stringify(observation)).not.toContain('permissions');
  expect(validate(observation)).toEqual(expected());
});

test('all six auth/config overrides, even empty ones, fail before any GET', () => {
  for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_CONFIG_DIR', 'GH_HOST', 'GITHUB_ENTERPRISE_TOKEN', 'GH_ENTERPRISE_TOKEN']) {
    for (const value of ['', 'PRIVATE_SECRET']) {
      const f = fixture(); f.environment[key] = value;
      expectCode(f.run, 'THUMBNAIL_LOCAL_OWNER_ENVIRONMENT_INVALID');
      expect(f.calls).toEqual([]);
    }
  }
});

test('workflow impersonation, missing HOME or alternate HOME is rejected without transport', () => {
  for (const change of [
    (env: any) => { env.GITHUB_ACTIONS = 'true'; },
    (env: any) => { delete env.HOME; },
    (env: any) => { env.HOME = '/tmp/other-owner-home'; },
  ]) {
    const f = fixture(); change(f.environment);
    expectCode(f.run, 'THUMBNAIL_LOCAL_OWNER_ENVIRONMENT_INVALID');
    expect(f.calls).toEqual([]);
  }
});

test('malformed operation UUID and clock reject before any transport', () => {
  for (const invalid of [undefined, '', 'not-a-uuid', '00000000-0000-0000-0000-000000000000', { id: operationId }]) {
    const f = fixture(); f.options.operationId = invalid;
    expectCode(f.run, 'THUMBNAIL_LOCAL_OWNER_ARGUMENT_INVALID'); expect(f.calls).toEqual([]);
  }
  for (const clock of [() => new Date('invalid'), () => observedAt, () => { throw new Error('PRIVATE_SECRET'); }]) {
    const f = fixture(); f.options.clock = clock;
    expectCode(f.run, 'THUMBNAIL_LOCAL_OWNER_ARGUMENT_INVALID'); expect(f.calls).toEqual([]);
  }
});

test('different user or owner, admin collaborator and incomplete identity cannot become an owner observation', () => {
  const cases = [
    (f: ReturnType<typeof fixture>) => { f.responses.user.login = 'collaborator'; },
    (f: ReturnType<typeof fixture>) => { f.responses.user.id = 999; },
    (f: ReturnType<typeof fixture>) => { f.responses['repos/twoimo/tzudong'].owner.login = 'other'; },
    (f: ReturnType<typeof fixture>) => { f.responses['repos/twoimo/tzudong'].owner.id = 999; },
    (f: ReturnType<typeof fixture>) => { f.responses['repos/twoimo/tzudong'].owner.type = 'Organization'; },
    (f: ReturnType<typeof fixture>) => { f.responses['repos/twoimo/tzudong'].full_name = 'twoimo/other'; },
    (f: ReturnType<typeof fixture>) => { f.responses['repos/twoimo/tzudong'].permissions.admin = false; },
    (f: ReturnType<typeof fixture>) => { f.responses['repos/twoimo/tzudong'].permissions.admin = 'true'; },
    (f: ReturnType<typeof fixture>) => { delete f.responses['repos/twoimo/tzudong'].owner.id; },
    (f: ReturnType<typeof fixture>) => { delete f.responses['repos/twoimo/tzudong'].permissions; },
    (f: ReturnType<typeof fixture>) => { f.responses['repos/twoimo/tzudong'].extra = 'PRIVATE_SECRET'; },
  ];
  for (const change of cases) {
    const f = fixture(); change(f);
    expectCode(f.run, 'THUMBNAIL_LOCAL_OWNER_IDENTITY_INVALID');
    expect(f.calls.length).toBeLessThanOrEqual(2);
  }
});

test('IDs must be positive safe JSON integers, not strings, fractions, infinities or objects', () => {
  for (const invalid of [undefined, null, '123456789', 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, {}]) {
    const f = fixture(); f.responses.user.id = invalid;
    expectCode(f.run, 'THUMBNAIL_LOCAL_OWNER_IDENTITY_INVALID');
    expect(f.calls).toEqual(['user']);
  }
});

test('unprotected, non-main and malformed commit objects cannot attest protected main', () => {
  for (const branch of [
    { name: 'main', protected: false, commit: { sha: revision } },
    { name: 'main', protected: 'true', commit: { sha: revision } },
    { name: 'develop', protected: true, commit: { sha: revision } },
    { name: 'main', protected: true, commit: {} },
    { name: 'main', protected: true, commit: { sha: 'a'.repeat(39) } },
    { name: 'main', protected: true, commit: { sha: 'A'.repeat(40) } },
    { name: 'main', protected: true, commit: { sha: { value: revision } } },
    { name: 'main', protected: true, commit: null },
  ]) {
    const f = fixture(); f.responses['repos/twoimo/tzudong/branches/main'] = branch;
    expectCode(f.run, 'THUMBNAIL_LOCAL_OWNER_IDENTITY_INVALID');
    expect(f.calls).toHaveLength(3);
  }
});

test('multiple documents, invalid JSON, non-object, non-string and oversized UTF-8 output fail closed', () => {
  for (const raw of ['', 'PRIVATE_SECRET', '{}\n{}', '[]', 'null', 'true', '123', '"text"', {}, Buffer.from('{}'),
    ' '.repeat(64 * 1024 + 1), '가'.repeat(22_000)]) {
    const f = fixture(); f.dependencies.githubGetImpl = () => raw;
    expectCode(f.run, 'THUMBNAIL_LOCAL_OWNER_READBACK_INVALID');
  }
});

test('timeouts and process/transport diagnostics become a fixed code without exposing raw error contents', () => {
  for (const diagnostic of [Object.assign(new Error('PRIVATE_SECRET token stderr'), { code: 'ETIMEDOUT', stdout: 'raw account data' }),
    Object.assign(new Error('spawn failure'), { code: 'ENOENT' }), 'PRIVATE_SECRET']) {
    const f = fixture(); f.dependencies.githubGetImpl = () => { throw diagnostic; };
    expectCode(f.run, 'THUMBNAIL_LOCAL_OWNER_TRANSPORT_FAILED');
  }
});

test('GET sequence is dated at its beginning and cannot hide stale identity or a backward clock', () => {
  for (const finalTime of ['2026-10-24T12:01:00.001Z', '2026-10-24T11:59:59.999Z']) {
    const f = fixture(); let count = 0;
    f.options.clock = () => new Date(count++ ? finalTime : observedAt);
    expectCode(f.run, 'THUMBNAIL_LOCAL_OWNER_STALE');
  }
  const f = fixture(); let count = 0;
  f.options.clock = () => new Date(count++ ? '2026-10-24T12:00:30.000Z' : observedAt);
  expect(f.run().observedAt).toBe(observedAt);
});

test('changed authentication environment during observation is rejected before returning a receipt', () => {
  const f = fixture(); const get = f.dependencies.githubGetImpl;
  f.dependencies.githubGetImpl = (endpoint: string) => {
    const result = get(endpoint); f.environment.GH_TOKEN = 'PRIVATE_SECRET'; return result;
  };
  expectCode(f.run, 'THUMBNAIL_LOCAL_OWNER_ENVIRONMENT_INVALID');
});

test('validator requires the exact schema and all authority facts, not a truthy owner label', () => {
  for (const [key, value] of Object.entries({
    kind: 'other', authority: 'authenticated-repository-owner-workflow-dispatch', operationId: 'invalid',
    repository: 'other/tzudong', principal: 'admin', identityVerified: 'true', branch: 'develop',
    protected: false, sourceRevision: 'invalid', observedAt: '2026-10-24T12:00:00Z', extra: true,
  })) expectCode(() => validate({ ...expected(), [key]: value }), 'THUMBNAIL_LOCAL_OWNER_OBSERVATION_INVALID');
  for (const key of Object.keys(expected())) {
    const incomplete: any = expected(); delete incomplete[key];
    expectCode(() => validate(incomplete), 'THUMBNAIL_LOCAL_OWNER_OBSERVATION_INVALID');
  }
  for (const invalid of [null, [], {}, 'owner']) expectCode(() => validate(invalid), 'THUMBNAIL_LOCAL_OWNER_OBSERVATION_INVALID');
});

test('validator binds the exact operation and source, rejects future/stale time and permits the 60s boundary', () => {
  expectCode(() => validate({ ...expected(), sourceRevision: 'b'.repeat(40) }), 'THUMBNAIL_LOCAL_OWNER_BINDING_MISMATCH');
  expectCode(() => validate({ ...expected(), operationId: '01234567-89ab-4cde-8fab-0123456789ac' }), 'THUMBNAIL_LOCAL_OWNER_BINDING_MISMATCH');
  expectCode(() => validate(expected(), new Date('2026-10-24T11:59:59.999Z')), 'THUMBNAIL_LOCAL_OWNER_STALE');
  expectCode(() => validate(expected(), new Date('2026-10-24T12:01:00.001Z')), 'THUMBNAIL_LOCAL_OWNER_STALE');
  expect(validate(expected(), new Date('2026-10-24T12:01:00.000Z'))).toEqual(expected());
  expectCode(() => validate(expected(), new Date('invalid')), 'THUMBNAIL_LOCAL_OWNER_ARGUMENT_INVALID');
  expectCode(() => validateThumbnailLocalOwner(expected(), { sourceRevision: 'invalid', operationId, now: now() }), 'THUMBNAIL_LOCAL_OWNER_ARGUMENT_INVALID');
  expectCode(() => validateThumbnailLocalOwner(expected(), { sourceRevision: revision, operationId: 'invalid', now: now() }), 'THUMBNAIL_LOCAL_OWNER_ARGUMENT_INVALID');
});
