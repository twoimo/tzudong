import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { getAdminEvaluationDisplayName } from '../lib/admin-evaluation-name';
import { normalizeCanonicalYouTubeWatchUrl } from '../lib/youtube-url';
import { createRecordActionClient, isRecordActionCancelled, recordActionErrorMessage, type RecordActionInput } from '../lib/admin/record-action-client';
import { parseRecordActionRequest, type RecordActionReceipt } from '../lib/admin/record-action-contract';
import { isEvaluationRecordStatus, normalizeEvaluationRecord, withAdminEvaluationDisplayName } from '../lib/admin/normalize-evaluation-record';
const id = '11111111-1111-4111-8111-111111111111', second = '22222222-2222-4222-8222-222222222222', third = '33333333-3333-4333-8333-333333333333';
const youtube = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const sources = Object.fromEntries(['EditRestaurantModal', 'MissingRestaurantForm', 'DbConflictResolutionPanel', 'AdminRestaurantModal', 'EvaluationSlideView'].map(name => [name, readFileSync(new URL(`../components/admin/${name}.tsx`, import.meta.url), 'utf8')]));
function actual<T>(file: keyof typeof sources, from: string, until: string, names: string[], deps: Record<string, unknown>): T {
  const source = sources[file], start = source.indexOf(from), end = source.indexOf(until, start);
  expect(start).toBeGreaterThan(-1); expect(end).toBeGreaterThan(start);
  const code = `const {${Object.keys(deps).join(',')}}=deps;\n${source.slice(start, end)}\nreturn {${names.join(',')}};`;
  return new Function('deps', new Bun.Transpiler({ loader: 'tsx' }).transformSync(code))(deps) as T;
}
const form = () => ({ name: '수정 맛집', address: '합성로 1', phone: '02-000-0000', categories: ['한식'], youtube_link: youtube, tzuyang_review: '보존할 리뷰' });
const geo = { road_address: '합성로 1', jibun_address: '합성동 1', english_address: '', address_elements: {}, x: '127', y: '37.5' };
const receipt = (action: RecordActionReceipt['action'] = 'restaurant.edit'): RecordActionReceipt => ({ operationId: third, action, state: 'applied', targetIds: [id], auditId: second, previewHash: 'a'.repeat(64), expiresAt: '2099-01-01T00:00:00Z', readback: [{ id, kind: 'restaurant', status: 'approved', fingerprint: 'b'.repeat(64) }], mediaCleanupPending: false });
function editHarness(overrides: Record<string, unknown> = {}) {
  const calls: RecordActionInput[] = [], refreshed: unknown[] = [], notices: unknown[] = [], working: boolean[] = [];
  const deps = {
    record: { id, youtube_link: youtube, restaurant_info: {} }, loading: false, addressChanged: false,
    formData: form(), initialFormRef: { current: '{}' }, geocodingDirty: true, geocodingResults: [geo], selectedGeocodingIndex: 0,
    normalizeCanonicalYouTubeWatchUrl, isRecordActionCancelled, recordActionErrorMessage,
    toast: (notice: unknown) => notices.push(notice), setLoading: (value: boolean) => working.push(value),
    notifyRestaurantIdentityWarning: () => false, notifySameVideoDuplicateWarning: () => {},
    checkRestaurantDuplicate: async () => ({ isDuplicate: false }),
    findActiveRestaurantIdentityConflict: async () => null, canAutoSoftDeleteDuplicateSource: () => false,
    formatActiveRestaurantIdentityConflictMessage: () => '중복 후보',
    setConflictingRestaurantInfo: () => {}, setShowApprovalConfirm: () => {},
    recordActions: { run: async (input: RecordActionInput) => { calls.push(input); return receipt(input.action); } },
    refreshAfterAction: async (value: unknown) => { refreshed.push(value); }, ...overrides,
  };
  const handlers = actual<{ handleSave: () => Promise<void>; handleApprove: () => Promise<void>; performApproval: () => Promise<void> }>('EditRestaurantModal', '  const buildChanges =', '  const currentRestaurantIdentityWarnings', ['handleSave', 'handleApprove', 'performApproval'], deps);
  return { ...handlers, calls, refreshed, notices, working };
}

describe('actual restaurant edit handlers', () => {
  test('save keeps editable fields and coordinates, with one guarded request and receipt-gated refresh', async () => {
    const h = editHarness(); await h.handleSave(); expect(h.calls).toHaveLength(1);
    expect(parseRecordActionRequest({ ...h.calls[0], phase: 'preview', operationId: third })).not.toBeNull();
    expect(h.calls[0]).toMatchObject({ action: 'restaurant.edit', targetIds: [id], payload: { changes: { approved_name: '수정 맛집', phone: '02-000-0000', categories: ['한식'], youtube_link: youtube, tzuyang_review: '보존할 리뷰', lat: 37.5, lng: 127, geocoding_success: true } } });
    expect(h.refreshed).toHaveLength(1); expect(h.working).toEqual([true, false]);
    expect(JSON.stringify(h.calls[0])).not.toMatch(/updated_by_admin_id|evaluation_results|"status"/);
  });
  test('changed address, busy operation and identity warning cannot emit writes', async () => {
    for (const override of [{ addressChanged: true }, { loading: true }, { formData: { ...form(), name: '' } }]) {
      const h = editHarness(override); await h.handleSave(); expect(h.calls).toHaveLength(0);
    }
    const approval = editHarness({ notifyRestaurantIdentityWarning: () => true }); await approval.handleApprove(); expect(approval.calls).toHaveLength(0);
  });
  test('approval retains draft changes; same canonical video duplicate blocks instead of writing diagnostics', async () => {
    const h = editHarness(); await h.handleApprove(); expect(parseRecordActionRequest({ ...h.calls[0], phase: 'preview', operationId: third })).not.toBeNull(); expect(h.calls[0]).toMatchObject({ action: 'restaurant.approve', payload: { changes: { approved_name: '수정 맛집', tzuyang_review: '보존할 리뷰' } } });
    const duplicate = editHarness({ checkRestaurantDuplicate: async () => ({ isDuplicate: true, matchedRestaurant: { id: second, youtube_link: 'https://youtu.be/dQw4w9WgXcQ' } }) });
    await duplicate.handleApprove(); expect(duplicate.calls).toHaveLength(0); expect(duplicate.refreshed).toHaveLength(0);
  });
  test('eligible duplicate cleanup still requires a guarded delete preview; blocked collision cannot mutate', async () => {
    const options = { findActiveRestaurantIdentityConflict: async () => ({ id: second, name: '기존' }) };
    const blocked = editHarness(options); await blocked.handleSave(); expect(blocked.calls).toHaveLength(0);
    const cleanup = editHarness({ ...options, canAutoSoftDeleteDuplicateSource: () => true }); await cleanup.handleSave();
    expect(cleanup.calls[0]).toMatchObject({ action: 'restaurant.delete', targetIds: [id] }); expect(parseRecordActionRequest({ ...cleanup.calls[0], phase: 'preview', operationId: third })).not.toBeNull();
  });
  test('lost apply remains pending until the original operation GET returns an audited receipt', async () => {
    let unknown = true, action: RecordActionInput | null = null;
    const calls: Array<{ method: string; phase?: string; operationId: string }> = [];
    const client = createRecordActionClient({ uuid: () => third, fetch: async (url, init) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ method: init?.method ?? '', phase: body?.phase, operationId: body?.operationId ?? new URL(String(url), 'http://fixture').searchParams.get('operationId') });
      if (body?.phase === 'preview') return Response.json({ success: true, receipt: { ...receipt(), state: 'preview', auditId: null } });
      if (body?.phase === 'apply') throw Error('RAW_PROVIDER_ERROR_MUST_NOT_APPEAR');
      return unknown ? Response.json({ code: 'RECORD_ACTION_UNCERTAIN' }, { status: 503 }) : Response.json({ success: true, receipt: receipt() });
    } });
    const h = editHarness({ recordActions: { run: (input: RecordActionInput) => { action = input; return client.run(input); } } });
    const pending = h.handleSave(); await new Promise(resolve => setTimeout(resolve, 0));
    expect(action).not.toBeNull(); expect(client.getSnapshot().phase).toBe('confirming'); expect(h.refreshed).toHaveLength(0);
    await client.apply('변경 적용'); expect(client.getSnapshot().phase).toBe('uncertain');
    client.cancel(); await client.apply('변경 적용'); expect(h.refreshed).toHaveLength(0); expect(h.working).toEqual([true]);
    unknown = false; await client.readback(); await pending;
    expect(h.refreshed).toHaveLength(1); expect(calls.filter(call => call.phase === 'apply')).toHaveLength(1); expect(new Set(calls.map(call => call.operationId)).size).toBe(1);
  });
});

function adminHarness(restaurant: unknown, overrides: Record<string, unknown> = {}) {
  const calls: RecordActionInput[] = [], notices: string[] = [];
  const deps = { restaurant, isSubmitting: false, isGeocodingNaver: false, isGeocoded: true,
    formData: { ...form(), ...geo, lat: '37.5', lng: '127', youtube_reviews: [{ id, youtube_link: youtube, tzuyang_review: '첫 영상' }, { id: 'new-3', youtube_link: 'https://youtu.be/ABCDEFGHIJK', tzuyang_review: '추가 영상' }] },
    deletedReviewIds: [second], normalizeCanonicalYouTubeWatchUrl, fetchYouTubeMeta: async () => null,
    setIsSubmitting: () => {}, refreshAfterAction: async () => {}, setShowDeleteConfirm: () => {},
    deleteReason: '검토 사유', deleteConfirmation: '삭제', RESTAURANT_DESTRUCTIVE_ACTION_CONFIRMATIONS: { soft_delete_restaurant: '삭제' },
    isRecordActionCancelled, recordActionErrorMessage, initialFormRef: { current: '{}' },
    toast: Object.fromEntries(['error', 'warning', 'success'].map(key => [key, (message: string) => notices.push(message)])),
    recordActions: { run: async (input: RecordActionInput) => { calls.push(input); return receipt(input.action); } }, ...overrides };
  return { ...actual<{ handleSubmit: (event: { preventDefault: () => void }) => Promise<void>; handleDelete: () => Promise<void> }>('AdminRestaurantModal', '    const handleSubmit =', '    const adminRestaurantTitle =', ['handleSubmit', 'handleDelete'], deps), calls, notices };
}

describe('actual multi-video editor and missing/conflict handlers', () => {
  test('group edit includes primary and children, removals, per-video changes and additions in one valid action', async () => {
    const h = adminHarness({ id, mergedRestaurants: [{ id: second }] }); await h.handleSubmit({ preventDefault() {} });
    expect(h.calls).toHaveLength(1); const input = h.calls[0]; expect(input.targetIds).toEqual([id, second]);
    expect(input.payload).toMatchObject({ perTargetChanges: [{ id, changes: { youtube_link: youtube, tzuyang_review: '첫 영상' } }], removeIds: [second], additions: [{ youtube_link: 'https://www.youtube.com/watch?v=ABCDEFGHIJK', tzuyang_review: '추가 영상', geocoding_success: true }] });
    expect(parseRecordActionRequest({ ...input, phase: 'preview', operationId: third })).not.toBeNull();
  });
  test('public video metadata keeps nested ad fields while provider diagnostics stay outside the DTO', async () => {
    const h = adminHarness({ id }, { deletedReviewIds: [], fetchYouTubeMeta: async () => ({ title: '공개 영상', publishedAt: '2026-10-05', duration: 900, is_shorts: false, ads_info: { is_ads: true, what_ads: '공개 광고 표시' }, diagnostic: 'RAW_PROVIDER_ERROR' }) });
    await h.handleSubmit({ preventDefault() {} });
    expect(h.calls[0].payload).toMatchObject({ additions: [{ youtube_meta: { title: '공개 영상', published_at: '2026-10-05', duration: 900, is_shorts: false, is_ads: true, what_ads: ['공개 광고 표시'] } }] });
    expect(JSON.stringify(h.calls)).not.toContain('RAW_PROVIDER_ERROR');
  });
  test('creation carries every entered video and deletion uses guarded reason/confirmation', async () => {
    const h = adminHarness(null); await h.handleSubmit({ preventDefault() {} }); expect(parseRecordActionRequest({ ...h.calls[0], phase: 'preview', operationId: third })).not.toBeNull(); expect(h.calls[0]).toMatchObject({ action: 'restaurant.create', targetIds: [], payload: { changes: { youtube_link: youtube }, additions: [{ youtube_link: 'https://www.youtube.com/watch?v=ABCDEFGHIJK' }] } });
    const blocked = adminHarness({ id }, { deleteConfirmation: 'wrong' }); await blocked.handleDelete(); expect(blocked.calls).toHaveLength(0);
    const remove = adminHarness({ id }); await remove.handleDelete(); expect(remove.calls[0]).toEqual({ action: 'restaurant.delete', targetIds: [id], payload: { reason: '검토 사유' } });
  });
  test('missing registration and merge preserve edited review/category and coordinates without actor overrides', async () => {
    const calls: RecordActionInput[] = [];
    const h = actual<{ registerNewRestaurant: (...args: unknown[]) => Promise<void>; handleMerge: (...args: unknown[]) => Promise<void> }>('MissingRestaurantForm', '  const handleMerge =', '  // 오류 경고 후', ['registerNewRestaurant', 'handleMerge'], { record: { id, restaurant_info: {} }, canonicalYoutubeUrl: youtube, refreshAfterAction: async () => {}, recordActions: { run: async (input: RecordActionInput) => { calls.push(input); return receipt(input.action); } } });
    await h.registerNewRestaurant(geo, '등록 맛집', '', '한식', '새 리뷰'); await h.handleMerge({ id: second }, '등록 맛집', '한식', '새 리뷰');
    expect(parseRecordActionRequest({ ...calls[0], phase: 'preview', operationId: third })).not.toBeNull();
    expect(parseRecordActionRequest({ ...calls[1], phase: 'preview', operationId: third })).not.toBeNull();
    expect(calls[1]).toMatchObject({ action: 'restaurant.merge', targetIds: [second, id], payload: { mergeTargetId: second, incomingChanges: { youtube_link: youtube, tzuyang_review: '새 리뷰', categories: ['한식'] } } });
    expect(JSON.stringify(calls)).not.toMatch(/updated_by_admin_id|"status"|evaluation_results/);
  });
  test('conflict merge and hold share guarded client, with busy and empty-reason guards', async () => {
    const calls: RecordActionInput[] = [];
    const deps = { loading: false, targetRead: 'ready', holdReason: '검토 중', record: { id }, existing: { id: second }, newInfo: { category: '한식', tzuyang_review: '새 근거' }, canonicalYoutubeUrl: youtube,
      setLoading: () => {}, refreshAfterAction: async () => {}, toast: () => {}, isRecordActionCancelled, recordActionErrorMessage,
      recordActions: { run: async (input: RecordActionInput) => { calls.push(input); return receipt(input.action); } } };
    const get = (override = {}) => actual<{ handleUpdateExisting: () => Promise<void>; handleHoldNew: () => Promise<void> }>('DbConflictResolutionPanel', '  const handleUpdateExisting =', '  return (', ['handleUpdateExisting', 'handleHoldNew'], { ...deps, ...override });
    await get().handleUpdateExisting(); await get().handleHoldNew(); expect(calls.map(call => call.action)).toEqual(['restaurant.merge', 'restaurant.hold']);
    expect(parseRecordActionRequest({ ...calls[0], phase: 'preview', operationId: third })).not.toBeNull();
    expect(parseRecordActionRequest({ ...calls[1], phase: 'preview', operationId: third })).not.toBeNull();
    await get({ loading: true }).handleUpdateExisting(); await get({ targetRead: 'failed' }).handleUpdateExisting(); await get({ existing: null }).handleUpdateExisting(); await get({ holdReason: ' ' }).handleHoldNew(); expect(calls).toHaveLength(2);
  });
});

test('each evaluation modal reads current data after receipt and retains a retry-only lock on missing/malformed current data', async () => {
  for (const name of ['EditRestaurantModal', 'MissingRestaurantForm', 'DbConflictResolutionPanel']) {
    let current: unknown = { id: second }, locked: RecordActionReceipt | null = null, closed = 0, updated: unknown = null, notices = 0;
    const deps = { record: { id }, setConfirmedReceipt: (value: RecordActionReceipt) => { locked = value; }, isEvaluationRecordStatus, normalizeEvaluationRecord, withAdminEvaluationDisplayName,
      onSuccess: (_id: string, value: unknown) => { updated = value; }, onOpenChange: () => { closed++; }, toast: () => { notices++; },
      fetch: async (_url: string, init: RequestInit) => { expect(init.cache).toBe('no-store'); return Response.json({ record: current }); } };
    const { refreshAfterAction } = actual<{ refreshAfterAction: (receipt: RecordActionReceipt) => Promise<void> }>(name, '  const refreshAfterAction =', '  const recordActions =', ['refreshAfterAction'], deps);
    await refreshAfterAction(receipt()); expect(locked).not.toBeNull(); expect(closed).toBe(0); expect(updated).toBeNull();
    current = { id }; await refreshAfterAction(receipt()); expect(closed).toBe(0);
    current = { id, name: '합성', status: 'invalid-status', updated_at: '2026-10-05T12:00:00Z' }; await refreshAfterAction(receipt()); expect(closed).toBe(0);
    current = { id, status: 'hold', name: '다른 운영자의 최신 이름', updated_at: '2026-10-05T12:00:00Z' };
    await refreshAfterAction(receipt()); expect(updated).toMatchObject({ id, status: 'hold', name: '다른 운영자의 최신 이름' }); expect(closed).toBe(1); expect(notices).toBe(4);
    current = { id, status: 'hold', name: null, approved_name: null, origin_name: '승인 전 원본 이름', updated_at: '2026-10-05T12:00:00Z' };
    await refreshAfterAction(receipt()); expect(closed).toBe(2); expect(updated).toMatchObject({ status: 'hold', name: '승인 전 원본 이름' });
    current = { id, status: 'hold', updated_at: '2026-10-05T12:00:00Z' };
    await refreshAfterAction(receipt()); expect(closed).toBe(2);
  }
});

test('actual close handlers protect dirty forms and block close while saving/readback', () => {
  for (const name of ['EditRestaurantModal', 'MissingRestaurantForm']) {
    let closed = 0, discard = false;
    const deps = { loading: false, geocodingNaver: false, geocoding: false, geocodingDirty: false, geocodingResult: null, formData: { name: 'draft' }, initialFormRef: { current: JSON.stringify({ name: 'original' }) }, setDiscardOpen: (value: boolean) => { discard = value; }, onOpenChange: () => { closed++; } };
    const get = (override = {}) => actual<{ handleOpenChange: (open: boolean) => void }>(name, '  const handleOpenChange =', name === 'EditRestaurantModal' ? '  // Modal' : '  return (', ['handleOpenChange'], { ...deps, ...override });
    get().handleOpenChange(false); expect(discard).toBe(true); expect(closed).toBe(0);
    discard = false; get({ loading: true }).handleOpenChange(false); expect(discard).toBe(false); expect(closed).toBe(0);
    get({ initialFormRef: { current: JSON.stringify(deps.formData) } }).handleOpenChange(false); expect(closed).toBe(1);
  }
  for (const source of Object.values(sources)) expect(source).not.toMatch(/\.update\(|\.insert\(|\.delete\(|mergeAdminReviewRestaurant|assertLegacyBrowserAdminMutationEnabled|console\.(error|warn)/);
});

test('actual grouped current-row readback rejects malformed states and keeps the replacement primary and added video', async () => {
  const { parseRestaurantMergeQueryRow } = actual<{ parseRestaurantMergeQueryRow: (value: unknown) => unknown }>('AdminRestaurantModal', 'const isRecord =', 'interface GeocodingResultItem', ['parseRestaurantMergeQueryRow'], { isEvaluationRecordStatus, getAdminEvaluationDisplayName });
  const nullable = Object.fromEntries(['phone', 'youtube_meta', 'evaluation_results', 'reasoning_basis', 'trace_id', 'origin_address', 'english_address', 'address_elements', 'geocoding_false_stage', 'created_by', 'updated_by_admin_id', 'db_error_message', 'db_error_details', 'origin_name', 'naver_name', 'google_name', 'trace_id_name_source', 'channel_name', 'description_map_url', 'recollect_version'].map(key => [key, null]));
  const base = { ...nullable, id, name: '합성', approved_name: '합성', status: 'approved', source_type: 'test', categories: ['한식'], road_address: '합성로', jibun_address: '합성동', geocoding_success: true, is_missing: false, is_not_selected: false, lat: 37, lng: 127, youtube_link: youtube, tzuyang_review: '원본', review_count: 0, search_count: 0, weekly_search_count: 0, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-05T00:00:00Z' };
  expect(parseRestaurantMergeQueryRow({ ...base, name: null, approved_name: null, origin_name: '승인 전 원본 이름' })).toMatchObject({ name: '승인 전 원본 이름' });
  expect(parseRestaurantMergeQueryRow({ ...base, name: undefined })).toBeNull();
  const valid = [{ ...base, status: 'deleted' }, { ...base, id: second, tzuyang_review: '유지할 영상' }, { ...base, id: third, tzuyang_review: '새 영상' }];
  let rows: unknown[] = valid, closed = 0, updated: unknown = null, locked = false;
  const deps = { restaurant: base, parseRestaurantMergeQueryRow, setConfirmedReceipt: () => { locked = true; }, onClose: () => { closed++; }, onSuccess: (value: unknown) => { updated = value; }, toast: { success: () => {}, error: () => {} },
    fetch: async (url: string, init: RequestInit) => { expect(init.cache).toBe('no-store'); const rowId = url.split('/').at(-1); const index = [id, second, third].indexOf(rowId!); expect(index).toBeGreaterThan(-1); return Response.json({ record: rows[index] }); } };
  const { refreshAfterAction } = actual<{ refreshAfterAction: (receipt: RecordActionReceipt) => Promise<void> }>('AdminRestaurantModal', '    const refreshAfterAction =', '    const recordActions =', ['refreshAfterAction'], deps);
  for (const invalid of [{ status: 'unknown' }, { updated_at: 'bad date' }, { id: 'unexpected' }]) {
    rows = [valid[0], valid[1], { ...valid[2], ...invalid }]; await refreshAfterAction({ ...receipt(), targetIds: [id, second, third] }); expect(closed).toBe(0); expect(updated).toBeNull(); expect(locked).toBe(true);
  }
  rows = valid; await refreshAfterAction({ ...receipt(), targetIds: [id, second, third] }); expect(closed).toBe(1);
  expect(updated).toMatchObject({ id: second, mergedRestaurants: [{ id: second }, { id: third }], mergedTzuyangReviews: ['유지할 영상', '새 영상'] });
});

test('partial evaluation edits preserve untouched legacy link, empty categories and incomplete geocoding', async () => {
  const initial = { ...form(), categories: [], youtube_link: 'legacy-video-reference', tzuyang_review: '' };
  const h = editHarness({ formData: { ...initial, phone: '02-123-4567' }, initialFormRef: { current: JSON.stringify(initial) }, geocodingDirty: false, geocodingResults: [], selectedGeocodingIndex: null });
  await h.handleSave();
  expect(h.calls).toHaveLength(1);
  expect(h.calls[0].payload).toEqual({ changes: { phone: '02-123-4567' } });
  expect(parseRecordActionRequest({ ...h.calls[0], phase: 'preview', operationId: third })).not.toBeNull();
});

test('partial grouped edits preserve unchanged incomplete legacy videos and send only explicit video edits', async () => {
  const legacy = { id, name: '합성', youtube_link: 'legacy-video-reference', tzuyang_review: '', categories: [], lat: null, lng: null };
  const initial = { name: '합성', searchAddress: '', phone: '', categories: [], road_address: '', jibun_address: '', english_address: '', address_elements: null, lat: '', lng: '', youtube_reviews: [{ id, youtube_link: 'legacy-video-reference', tzuyang_review: '' }] };
  const h = adminHarness(legacy, { formData: { ...initial, phone: '02-123-4567' }, initialFormRef: { current: JSON.stringify(initial) }, deletedReviewIds: [], isGeocoded: false });
  await h.handleSubmit({ preventDefault() {} }); expect(h.calls).toHaveLength(1);
  expect(h.calls[0].payload).toEqual({ changes: { phone: '02-123-4567' }, perTargetChanges: [], removeIds: [], additions: [] });
  expect(parseRecordActionRequest({ ...h.calls[0], phase: 'preview', operationId: third })).not.toBeNull();
  const video = adminHarness(legacy, { formData: { ...initial, youtube_reviews: [{ id, youtube_link: '', tzuyang_review: '수정한 리뷰' }] }, initialFormRef: { current: JSON.stringify(initial) }, deletedReviewIds: [], isGeocoded: false });
  await video.handleSubmit({ preventDefault() {} });
  expect(parseRecordActionRequest({ ...video.calls[0], phase: 'preview', operationId: third })).not.toBeNull();
  expect(video.calls[0].payload).toMatchObject({ changes: {}, perTargetChanges: [{ id, changes: { youtube_link: null, tzuyang_review: '수정한 리뷰' } }] });
  const invalid = adminHarness(legacy, { formData: { ...initial, youtube_reviews: [{ id, youtube_link: 'invalid replacement', tzuyang_review: '' }] }, initialFormRef: { current: JSON.stringify(initial) }, deletedReviewIds: [], isGeocoded: false });
  await invalid.handleSubmit({ preventDefault() {} }); expect(invalid.calls).toHaveLength(0);
});

test('approval includes the visible resolved name and category while partial saves leave unrelated data alone', async () => {
  const initial = form();
  const h = editHarness({ formData: initial, initialFormRef: { current: JSON.stringify(initial) }, geocodingDirty: false });
  await h.performApproval();
  expect(h.calls[0].payload).toMatchObject({ changes: { approved_name: initial.name, categories: initial.categories, geocoding_success: true } });
  expect(h.calls[0].payload).not.toHaveProperty('changes.youtube_link');
  expect(parseRecordActionRequest({ ...h.calls[0], phase: 'preview', operationId: third })).not.toBeNull();
});


test('actual slide approval keeps the selected candidate while confirmation/readback is pending', () => {
  const navigations: number[] = [], approvals: string[] = [], timers: Array<() => void> = [];
  const deps = { currentRecord: { id }, currentIndex: 0, records: [{ id }, { id: second }], onNavigate: (index: number) => navigations.push(index), onApprove: (row: { id: string }) => { approvals.push(row.id); return new Promise(() => {}); }, setTimeout: (callback: () => void) => timers.push(callback) };
  const { handleApproveCurrent } = actual<{ handleApproveCurrent: () => void }>('EvaluationSlideView', '    const handleApproveCurrent =', '    const getStatusBadge', ['handleApproveCurrent'], deps);
  handleApproveCurrent(); timers.forEach(callback => callback());
  expect(approvals).toEqual([id]); expect(navigations).toEqual([]);
});

test('slide pointer and touch gestures preserve interactive clicks while ordinary swipes still navigate', () => {
  const captures: number[] = [], navigations: number[] = [];
  const ref = <T,>(current: T) => ({ current });
  const deps = {
    useCallback: (callback: unknown) => callback,
    isSlideSwipeActiveRef: ref(false), slideSwipeInputRef: ref<string | null>(null),
    slideSwipePointerIdRef: ref<number | null>(null), slideSwipeLastHandledAtRef: ref(0),
    slideSwipeStartXRef: ref<number | null>(null), slideSwipeEndXRef: ref<number | null>(null),
    slideSwipeStartYRef: ref<number | null>(null), slideSwipeEndYRef: ref<number | null>(null),
    SLIDE_SWIPE_DISTANCE: 24, currentIndex: 0, records: [{ id }, { id: second }], onNavigate: (index: number) => navigations.push(index),
  };
  const h = actual<Record<string, (event: unknown) => void>>('EvaluationSlideView', '    const handleSlideTouchStart =', '    // 키보드 네비게이션', ['handleSlideTouchStart', 'handleSlidePointerDown', 'handleSlidePointerMove', 'handleSlidePointerEnd'], deps);
  const target = { closest: () => ({ tagName: 'BUTTON' }) };
  const event = { target, pointerId: 1, clientX: 100, clientY: 100, touches: [{ clientX: 100, clientY: 100 }], currentTarget: { setPointerCapture: (id: number) => captures.push(id), releasePointerCapture() {} }, preventDefault() {} };
  h.handleSlidePointerDown(event); h.handleSlideTouchStart(event);
  expect(captures).toEqual([]); expect(deps.isSlideSwipeActiveRef.current).toBe(false);
  const plain = { ...event, target: { closest: () => null } };
  h.handleSlidePointerDown(plain); h.handleSlidePointerMove({ ...plain, clientX: 20 }); h.handleSlidePointerEnd({ ...plain, clientX: 20 });
  expect(captures).toEqual([1]); expect(navigations).toEqual([1]);
});
