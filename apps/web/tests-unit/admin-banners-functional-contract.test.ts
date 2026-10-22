import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const appRoot = join(import.meta.dir, '..');
const source = (path: string) => readFileSync(join(appRoot, path), 'utf8');

const pageSource = source('app/admin/banners/page.tsx');
const adBannerHookSource = source('hooks/use-ad-banners.tsx');
const decisionStart = pageSource.indexOf('const matchesSavedBanner =');
const decisionEnd = pageSource.indexOf('const revokeObjectUrlIfNeeded', decisionStart);
const refreshFunctions = new Function(new Bun.Transpiler({ loader: 'ts' }).transformSync(
  `${pageSource.slice(decisionStart, decisionEnd)}\nreturn { getBannerPendingReadbackDecision, getBannerRefreshEditorDecision, readBannerRefresh, isBannerRefreshConflictBlocking, getBannerTitleValidationError, isDefiniteBannerMutationRejection, cleanupDefiniteRejectedBannerUploads };`,
))() as {
  getBannerPendingReadbackDecision: (banners: Banner[], pending: { saved: Banner } | { deletedId: string; mediaCleanupFailed: boolean }) => { kind: string; banner?: Banner; latest?: Banner | null };
  getBannerRefreshEditorDecision: (banners: Banner[], editing: Banner | null, dirty: boolean) => { kind: string; banner?: Banner; removed?: boolean };
  readBannerRefresh: <T>(refetch: () => Promise<T>, getLive: () => { revision: number; editingBanner: Banner | null; isDirty: boolean }) => Promise<{ result: T; current: { revision: number; editingBanner: Banner | null; isDirty: boolean }; editorChangedDuringRefresh: boolean }>;
  isBannerRefreshConflictBlocking: (conflict: { bannerId: string; latest: Banner | null } | null, editing: Banner | null) => boolean;
  getBannerTitleValidationError: (title: string) => string | null;
  isDefiniteBannerMutationRejection: (status: number | null, code: string) => boolean;
  cleanupDefiniteRejectedBannerUploads: (status: number | null, code: string, paths: readonly string[], remove: (path: string) => Promise<unknown>) => Promise<boolean | null>;
};
const {
  getBannerPendingReadbackDecision,
  getBannerRefreshEditorDecision,
  readBannerRefresh,
  isBannerRefreshConflictBlocking,
  getBannerTitleValidationError,
  isDefiniteBannerMutationRejection,
  cleanupDefiniteRejectedBannerUploads,
} = refreshFunctions;
const hookErrorCodeStart = adBannerHookSource.indexOf('function isAdminBannerMutationErrorCode');
const hookErrorCodeEnd = adBannerHookSource.indexOf('async function requestAdminBannerMutation', hookErrorCodeStart);
const { getAdminBannerMutationErrorCode } = new Function(new Bun.Transpiler({ loader: 'ts' }).transformSync(
  `${adBannerHookSource.slice(hookErrorCodeStart, hookErrorCodeEnd)}\nreturn { getAdminBannerMutationErrorCode };`,
))() as {
  getAdminBannerMutationErrorCode: (status: number, code: unknown) => string;
};

type Banner = {
  id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  video_url: string | null;
  media_type: 'none';
  link_url: string | null;
  is_active: boolean;
  priority: number;
  display_target: string[];
};

const banner = (overrides: Partial<Banner> = {}): Banner => ({
  id: 'banner-1', title: '기존 배너', description: null, image_url: null, video_url: null,
  media_type: 'none', link_url: null, is_active: true, priority: 1,
  display_target: ['sidebar'], ...overrides,
});

test('banner refresh rebases clean detail and preserves dirty conflicts', () => {
  const before = banner();
  const after = banner({ title: '최신 배너', priority: 2 });

  expect(getBannerRefreshEditorDecision([before], before, false)).toEqual({ kind: 'unchanged' });
  expect(getBannerRefreshEditorDecision([after], before, false)).toEqual({ kind: 'rebase', banner: after });
  expect(getBannerRefreshEditorDecision([after], before, true)).toEqual({ kind: 'preserve-conflict', removed: false });
  expect(getBannerRefreshEditorDecision([], before, false)).toEqual({ kind: 'close-removed' });
  expect(getBannerRefreshEditorDecision([], before, true)).toEqual({ kind: 'preserve-conflict', removed: true });
  expect(getBannerRefreshEditorDecision([after], null, false)).toEqual({ kind: 'none' });
});

test('deferred refetch observes live editor revision instead of the pre-await closure', async () => {
  const before = banner();
  const selectedDuringRefresh = banner({ id: 'banner-2', title: '두 번째 배너' });
  let live = { revision: 1, editingBanner: before, isDirty: false };
  let release!: (value: { isError: boolean; data: Banner[] }) => void;
  const deferred = new Promise<{ isError: boolean; data: Banner[] }>((resolve) => { release = resolve; });

  const pending = readBannerRefresh(() => deferred, () => live);
  live = { revision: 2, editingBanner: selectedDuringRefresh, isDirty: true };
  release({ isError: false, data: [before, selectedDuringRefresh] });
  const outcome = await pending;

  expect(outcome.editorChangedDuringRefresh).toBe(true);
  expect(outcome.current).toEqual(live);
  expect(outcome.result.data).toEqual([before, selectedDuringRefresh]);
});

test('confirmed refresh conflicts block save and delete until explicit re-open', () => {
  const selected = banner();
  expect(isBannerRefreshConflictBlocking({ bannerId: selected.id, latest: banner({ title: '최신' }) }, selected)).toBe(true);
  expect(isBannerRefreshConflictBlocking({ bannerId: 'other', latest: null }, selected)).toBe(false);
  expect(isBannerRefreshConflictBlocking(null, selected)).toBe(false);
  expect(pageSource).toContain('setRefreshConflict({ bannerId: current.editingBanner.id, latest });');
  expect(pageSource).toContain('if (hasRefreshConflict)');
  expect(pageSource).toContain('disabled={isBusy || bannerReadFailed || !isDirty || Boolean(pendingReadback) || hasRefreshConflict}');
  expect(pageSource).toContain("'현재 입력 버리고 최신 상태 열기'");
  expect(pageSource).toContain("'현재 입력 버리고 상세 닫기'");
});

test('pending readback accepts authoritative divergence instead of locking forever', () => {
  const expected = banner({ title: '저장 응답' });
  const latest = banner({ title: '후속 최신 상태', priority: 9 });

  expect(getBannerPendingReadbackDecision([expected], { saved: expected })).toEqual({ kind: 'saved-confirmed', banner: expected });
  expect(getBannerPendingReadbackDecision([latest], { saved: expected })).toEqual({ kind: 'saved-diverged', latest });
  expect(getBannerPendingReadbackDecision([], { saved: expected })).toEqual({ kind: 'saved-diverged', latest: null });
  expect(getBannerPendingReadbackDecision([], { deletedId: expected.id, mediaCleanupFailed: false })).toEqual({ kind: 'delete-confirmed' });
  expect(getBannerPendingReadbackDecision([latest], { deletedId: expected.id, mediaCleanupFailed: false })).toEqual({ kind: 'delete-diverged', latest });
});

test('banner callers send observed revisions and clean media from the authoritative deleted row', () => {
  const hookSource = source('hooks/use-ad-banners.tsx');
  expect(hookSource).toContain("requestAdminBannerMutation('PATCH', { id, expectedUpdatedAt, data })");
  expect(hookSource).toContain("requestAdminBannerMutation('DELETE', { id, expectedUpdatedAt })");
  expect(pageSource).toContain('expectedUpdatedAt: editingBanner.updated_at');
  expect(pageSource).toContain('expectedUpdatedAt: target.updated_at');
  expect(pageSource).toContain('deletedBanner.image_url');
  expect(pageSource).toContain('deletedBanner.video_url');
  expect(pageSource).toContain("error.code === 'banner_revision_conflict'");
});

test('banner save rejects a 101-character title and cleans only valid definite status-code rejections', async () => {
  expect(getBannerTitleValidationError('가'.repeat(100))).toBeNull();
  expect(getBannerTitleValidationError(` ${'가'.repeat(100)} `)).toBeNull();
  expect(getBannerTitleValidationError('가'.repeat(101))).toBe('제목은 100자 이하로 입력해주세요');

  const titleValidationIndex = pageSource.indexOf('const titleValidationError = getBannerTitleValidationError(formData.title);');
  const firstUploadIndex = pageSource.indexOf('await uploadImage.mutateAsync', titleValidationIndex);
  expect(titleValidationIndex).toBeGreaterThan(-1);
  expect(firstUploadIndex).toBeGreaterThan(titleValidationIndex);

  expect(getAdminBannerMutationErrorCode(400, 'banner_mutation_invalid')).toBe('banner_mutation_invalid');
  expect(getAdminBannerMutationErrorCode(403, 'banner_mutation_forbidden')).toBe('banner_mutation_forbidden');
  expect(getAdminBannerMutationErrorCode(404, 'banner_not_found')).toBe('banner_not_found');
  expect(getAdminBannerMutationErrorCode(409, 'banner_revision_conflict')).toBe('banner_revision_conflict');
  expect(getAdminBannerMutationErrorCode(500, 'banner_update_failed')).toBe('banner_update_failed');
  expect(getAdminBannerMutationErrorCode(500, 'banner_readback_failed')).toBe('banner_readback_failed');
  expect(getAdminBannerMutationErrorCode(500, 'banner_delete_failed')).toBe('banner_delete_failed');
  expect(getAdminBannerMutationErrorCode(500, 'banner_mutation_invalid')).toBe('banner_invalid_response');
  expect(getAdminBannerMutationErrorCode(400, 'banner_revision_conflict')).toBe('banner_invalid_response');
  expect(getAdminBannerMutationErrorCode(500, 'unknown')).toBe('banner_invalid_response');

  expect(isDefiniteBannerMutationRejection(400, 'banner_mutation_invalid')).toBe(true);
  expect(isDefiniteBannerMutationRejection(403, 'banner_mutation_forbidden')).toBe(true);
  expect(isDefiniteBannerMutationRejection(404, 'banner_not_found')).toBe(true);
  expect(isDefiniteBannerMutationRejection(409, 'banner_revision_conflict')).toBe(true);
  expect(isDefiniteBannerMutationRejection(500, 'banner_mutation_invalid')).toBe(false);
  expect(isDefiniteBannerMutationRejection(500, 'banner_update_failed')).toBe(false);
  expect(isDefiniteBannerMutationRejection(null, 'banner_mutation_invalid')).toBe(false);

  const uploadedPaths = ['owned/image.webp', 'owned/video.mp4'];
  const removed: string[] = [];
  expect(await cleanupDefiniteRejectedBannerUploads(
    400,
    'banner_mutation_invalid',
    uploadedPaths,
    async (path) => { removed.push(path); },
  )).toBe(false);
  expect(removed).toEqual(uploadedPaths);

  expect(await cleanupDefiniteRejectedBannerUploads(
    500,
    'banner_mutation_invalid',
    uploadedPaths,
    async (path) => { removed.push(path); },
  )).toBeNull();
  expect(await cleanupDefiniteRejectedBannerUploads(
    500,
    'banner_update_failed',
    uploadedPaths,
    async (path) => { removed.push(path); },
  )).toBeNull();
  expect(removed).toEqual(uploadedPaths);
  expect(adBannerHookSource).toContain('getAdminBannerMutationErrorCode(response.status, payload?.code)');
  expect(adBannerHookSource).toContain("new AdminBannerMutationError(code, latest, response.status)");
  expect(pageSource).toContain('await cleanupDefiniteRejectedBannerUploads(');
  expect(pageSource).toContain('if (error instanceof AdminBannerMutationError && cleanupFailed !== null)');
});

test('admin banner query rejects malformed payloads and rows instead of hiding them', () => {
  const hookSource = source('hooks/use-ad-banners.tsx');
  const adminQuery = hookSource.slice(hookSource.indexOf('export function useAdBannersAdmin'), hookSource.indexOf('export function useActiveAdBanners'));

  expect(adminQuery).toContain("throw new Error('admin-banners-invalid-response')");
  expect(adminQuery).toContain('return readAdminBannerRows(payload.banners);');
  expect(adminQuery).not.toContain('flatMap');
});

const routeWorker = String.raw`
import { mock } from 'bun:test';
let authOk = false, dbError = false, serviceClients = 0;
mock.module('@/lib/auth/require-admin', () => ({ requireAdmin: async () => authOk
  ? { ok: true, userId: 'fixture-admin' }
  : { ok: false, response: Response.json({ code: 'forbidden' }, { status: 403 }) } }));
mock.module('@/lib/supabase/service-role', () => ({ createSupabaseServiceRoleClient: () => {
  serviceClients++;
  return { from: () => ({ select: () => ({ order: async () => dbError
    ? { data: null, error: { code: 'synthetic' } }
    : { data: [{ id: 'banner-1' }], error: null } }) }) };
} }));
const route = await import('./app/api/admin/banners/route.ts');
const forbidden = await route.GET();
authOk = true;
const success = await route.GET();
dbError = true;
const failure = await route.GET();
console.log(JSON.stringify({
  forbidden: { status: forbidden.status, cache: forbidden.headers.get('cache-control') },
  success: { status: success.status, cache: success.headers.get('cache-control'), body: await success.json() },
  failure: { status: failure.status, cache: failure.headers.get('cache-control') },
  serviceClients,
}));
`;

test('admin banner GET is admin-first and private no-store on every result', () => {
  const result = Bun.spawnSync([process.execPath, '--eval', routeWorker], {
    cwd: resolve(appRoot), env: process.env, stdout: 'pipe', stderr: 'pipe',
  });
  expect(result.exitCode).toBe(0);
  expect(new TextDecoder().decode(result.stderr)).toBe('');
  const report = JSON.parse(new TextDecoder().decode(result.stdout));

  expect(report.forbidden).toEqual({ status: 403, cache: 'private, no-store, max-age=0' });
  expect(report.success).toEqual({ status: 200, cache: 'private, no-store, max-age=0', body: { banners: [{ id: 'banner-1' }] } });
  expect(report.failure).toEqual({ status: 500, cache: 'private, no-store, max-age=0' });
  expect(report.serviceClients).toBe(2);
});

const mutationRouteWorker = String.raw`
import { mock } from 'bun:test';
let authOk = true, serviceClients = 0, revision = 2;
let dbRow = {
  id: '00000000-0000-4000-9000-000000000201', title: 'v2', description: null,
  image_url: 'media-v2', video_url: null, media_type: 'image', link_url: null,
  is_active: true, priority: 2, display_target: ['sidebar'],
  created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-02T00:00:00.000Z', created_by: null,
};
mock.module('@/lib/auth/require-admin', () => ({ requireAdmin: async () => authOk
  ? { ok: true, userId: '00000000-0000-4000-9000-000000000099' }
  : { ok: false, response: Response.json({ code: 'forbidden' }, { status: 403 }) } }));
mock.module('@/lib/security/same-origin-mutation', () => ({ isTrustedSameOriginMutation: () => true }));
mock.module('@/lib/ad-banner-url', () => ({ resolveAdBannerPersistenceUrls: (value) => ({
  image_url: value.image_url ?? null, video_url: value.video_url ?? null,
  media_type: value.media_type, link_url: value.link_url || null,
}) }));
mock.module('@/lib/supabase/service-role', () => ({ createSupabaseServiceRoleClient: () => {
  serviceClients++;
  return { from: () => {
    let mode = 'read', values = null; const filters = {};
    const query = {
      select() { return query; },
      update(next) { mode = 'update'; values = next; return query; },
      delete() { mode = 'delete'; return query; },
      eq(key, value) { filters[key] = value; return query; },
      order: async () => ({ data: dbRow ? [dbRow] : [], error: null }),
      maybeSingle: async () => {
        const idMatches = Boolean(dbRow && filters.id === dbRow.id);
        if (mode === 'read') return { data: idMatches ? dbRow : null, error: null };
        const revisionMatches = idMatches && filters.updated_at === dbRow.updated_at;
        if (!revisionMatches) return { data: null, error: null };
        if (mode === 'delete') { const deleted = dbRow; dbRow = null; return { data: deleted, error: null }; }
        revision++;
        dbRow = { ...dbRow, ...values, updated_at: '2026-01-0' + revision + 'T00:00:00.000Z' };
        return { data: dbRow, error: null };
      },
    };
    return query;
  } };
} }));
const route = await import('./app/api/admin/banners/route.ts');
const request = (method, body) => new Request('https://fixture.test/api/admin/banners', {
  method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const form = (title, image_url) => ({ title, description: null, image_url, video_url: null, media_type: 'image', link_url: null, is_active: true, priority: 3, display_target: ['sidebar'] });
authOk = false;
const forbidden = await route.PATCH(request('PATCH', { id: dbRow.id, expectedUpdatedAt: dbRow.updated_at, data: form('forbidden', 'media-forbidden') }));
authOk = true;
const serviceClientsBeforeInvalid = serviceClients;
const invalid = await route.PATCH(request('PATCH', { id: dbRow.id, expectedUpdatedAt: dbRow.updated_at, data: form('x'.repeat(101), 'media-invalid') }));
const invalidBody = await invalid.json();
const afterInvalid = { ...dbRow };
const serviceClientsAfterInvalid = serviceClients;
const stalePatch = await route.PATCH(request('PATCH', { id: dbRow.id, expectedUpdatedAt: '2026-01-01T00:00:00.000Z', data: form('stale', 'media-stale') }));
const stalePatchBody = await stalePatch.json();
const afterStalePatch = { ...dbRow };
const updated = await route.PATCH(request('PATCH', { id: dbRow.id, expectedUpdatedAt: dbRow.updated_at, data: form('v3', 'media-v3') }));
const updatedBody = await updated.json();
const staleDelete = await route.DELETE(request('DELETE', { id: dbRow.id, expectedUpdatedAt: '2026-01-02T00:00:00.000Z' }));
const staleDeleteBody = await staleDelete.json();
const afterStaleDelete = { ...dbRow };
const deleted = await route.DELETE(request('DELETE', { id: dbRow.id, expectedUpdatedAt: dbRow.updated_at }));
const deletedBody = await deleted.json();
console.log(JSON.stringify({
  forbidden: { status: forbidden.status, cache: forbidden.headers.get('cache-control') },
  invalid: { status: invalid.status, cache: invalid.headers.get('cache-control'), body: invalidBody },
  afterInvalid,
  invalidServiceClients: [serviceClientsBeforeInvalid, serviceClientsAfterInvalid],
  stalePatch: { status: stalePatch.status, cache: stalePatch.headers.get('cache-control'), body: stalePatchBody },
  afterStalePatch,
  updated: { status: updated.status, cache: updated.headers.get('cache-control'), body: updatedBody },
  staleDelete: { status: staleDelete.status, cache: staleDelete.headers.get('cache-control'), body: staleDeleteBody },
  afterStaleDelete,
  deleted: { status: deleted.status, cache: deleted.headers.get('cache-control'), body: deletedBody },
  dbRow,
  serviceClients,
}));
`;

test('banner PATCH and DELETE reject stale revisions and return authoritative rows', () => {
  const result = Bun.spawnSync([process.execPath, '--eval', mutationRouteWorker], {
    cwd: resolve(appRoot), env: process.env, stdout: 'pipe', stderr: 'pipe',
  });
  expect(result.exitCode).toBe(0);
  expect(new TextDecoder().decode(result.stderr)).toBe('');
  const report = JSON.parse(new TextDecoder().decode(result.stdout));

  expect(report.forbidden).toEqual({ status: 403, cache: 'private, no-store, max-age=0' });
  expect(report.invalid).toEqual({ status: 400, cache: 'private, no-store, max-age=0', body: { code: 'banner_mutation_invalid' } });
  expect(report.invalidServiceClients[1]).toBe(report.invalidServiceClients[0]);
  expect(report.afterInvalid).toMatchObject({ title: 'v2', image_url: 'media-v2' });
  expect(report.stalePatch.status).toBe(409);
  expect(report.stalePatch.cache).toBe('private, no-store, max-age=0');
  expect(report.stalePatch.body).toMatchObject({ code: 'banner_revision_conflict', banner: { title: 'v2', image_url: 'media-v2' } });
  expect(report.afterStalePatch).toMatchObject({ title: 'v2', image_url: 'media-v2' });
  expect(report.updated).toMatchObject({ status: 200, cache: 'private, no-store, max-age=0', body: { banner: { title: 'v3', image_url: 'media-v3' } } });
  expect(report.staleDelete.status).toBe(409);
  expect(report.staleDelete.body).toMatchObject({ code: 'banner_revision_conflict', banner: { title: 'v3', image_url: 'media-v3' } });
  expect(report.afterStaleDelete).toMatchObject({ title: 'v3', image_url: 'media-v3' });
  expect(report.deleted).toMatchObject({ status: 200, cache: 'private, no-store, max-age=0', body: { deletedBanner: { title: 'v3', image_url: 'media-v3' } } });
  expect(report.dbRow).toBeNull();
  expect(report.serviceClients).toBe(4);
});
