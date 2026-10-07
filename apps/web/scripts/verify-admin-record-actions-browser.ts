/** Actual page + owned browser. Every mutation is synthetic and all external origins are blocked. */
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseRecordActionRequest, type RecordActionReceipt } from '../lib/admin/record-action-contract.ts';
const connection = process.argv[2];
const suffix = process.argv[3] ?? '20261005';
if (!/^[a-z0-9-]{1,50}$/.test(suffix)) throw Error('INVALID_SUFFIX');
const sourcePaths = ['app/admin/evaluations/page.tsx', 'lib/admin/record-action-client.ts', 'lib/admin/use-record-action.tsx', 'lib/admin/evaluation-record-actions.ts', 'lib/admin/record-action-contract.ts'];
const sources = () => sourcePaths.map(path => ({ path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') }));
const sourceStart = sources();
if (!/^ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\//.test(connection ?? '')) throw Error('OWNED_BROWSER_REQUIRED');
const origin = 'http://127.0.0.1:18794', fake = 'http://127.0.0.1:18793', endpoint = '/api/admin/record-actions';
const browser = await chromium.connectOverCDP(connection), context = browser.contexts()[0];
if (context.pages().some(page => !['about:blank', 'chrome://newtab/', 'chrome://new-tab-page/'].includes(page.url()) && !page.url().startsWith(origin))) throw Error('OWNED_TARGET_REQUIRED');
const page = context.pages().find(page => page.url() === 'about:blank' || page.url().startsWith(origin))!;
page.setDefaultTimeout(12000); page.setDefaultNavigationTimeout(45000);
await context.unrouteAll({ behavior: 'wait' });
await context.addInitScript(() => { localStorage.setItem('tzudong:e2e-admin-shell-bypass', '1'); localStorage.removeItem('adminEvaluationPageState'); });
const fixture = await fetch(`${origin}/api/admin/evaluations`).then(response => response.json());
let mode: 'normal' | 'lost' | 'uncertain' | 'stale' | 'delayed' = 'normal', unknown = false;
let failCurrentRead = false;
let receipt: RecordActionReceipt | null = null, release: (() => void) | null = null;
let calls: Array<{ method: string; phase?: string; operationId: string; action?: string }> = [], denied = 0, notifications = 0, pageErrors = 0;
const results: Array<Record<string, unknown>> = [];
page.on('pageerror', error => { pageErrors++; console.log('PAGE_ERROR', error.message.slice(0, 160)); });
const statuses = new Map<string, string>();
await context.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url());
  const fulfill = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (![origin, fake].includes(url.origin)) { await route.abort('blockedbyclient'); return; }
  if (request.method() === 'POST' && ['/rest/v1/rpc/get_current_privacy_eligibility', '/rest/v1/rpc/is_current_auth_session_active', '/rest/v1/rpc/read_public_profile_summaries', '/api/admin/profile-summaries'].includes(url.pathname)) {
    if (url.pathname.includes('eligibility')) { await fulfill({ schemaVersion: 1, eligible: true, reasonCode: 'PRIVACY_ELIGIBLE', policyVersionId: '00000000-0000-4000-8000-000000000001', policyVersion: '2026-08-04.1', contentSha256: '6e42ced065a6ea0762b85d9b5e11500fcfc535543ab50d12ffbe6490086a110b' }); return; }
    if (url.pathname.includes('active')) { await fulfill(true); return; }
    const body = request.postDataJSON(), ids: string[] = body.userIds ?? body.p_user_ids ?? [];
    await fulfill(url.pathname === '/api/admin/profile-summaries' ? { rows: ids.map(userId => ({ userId, nickname: '검증 사용자' })) } : ids.map(user_id => ({ user_id, nickname: '검증 사용자', avatar_url: null }))); return;
  }
  if (url.pathname === endpoint) {
    if (request.method() === 'GET') {
      calls.push({ method: 'GET', operationId: url.searchParams.get('operationId') ?? '' });
      if (unknown) { await fulfill({ code: 'RECORD_ACTION_UNCERTAIN' }, 503); return; }
      await fulfill({ success: true, receipt }); return;
    }
    const body = parseRecordActionRequest(request.postDataJSON());
    if (!body) { await fulfill({ code: 'RECORD_ACTION_INVALID_PAYLOAD' }, 400); return; }
    calls.push({ method: 'POST', phase: body.phase, operationId: body.operationId, action: body.action });
    if (body.phase === 'preview') {
      receipt = { operationId: body.operationId, action: body.action, state: 'preview', previewHash: 'a'.repeat(64), targetIds: body.targetIds, auditId: null, expiresAt: new Date(Date.now() + 900000).toISOString(), readback: body.targetIds.map(id => ({ id, kind: body.action.split('.')[0], status: statuses.get(id) ?? 'pending', fingerprint: 'b'.repeat(64) })), mediaCleanupPending: false };
      await fulfill({ success: true, receipt }); return;
    }
    if (mode === 'stale') { await fulfill({ code: 'RECORD_ACTION_STALE' }, 409); return; }
    if (mode === 'delayed') await new Promise<void>(resolve => { release = resolve; });
    const status = body.action.endsWith('delete') ? 'deleted' : body.action.endsWith('approve') ? 'approved' : body.action.endsWith('reject') ? 'rejected' : 'pending';
    for (const id of body.targetIds) statuses.set(id, status);
    receipt = { ...receipt!, state: 'applied', auditId: '00000000-0000-4000-8000-000000000099', readback: receipt!.readback.map(row => ({ ...row, status })) };
    if (mode === 'uncertain') unknown = true;
    if (mode === 'lost' || mode === 'uncertain') { await route.abort('failed'); return; }
    await fulfill({ success: true, receipt }); return;
  }
  if (url.pathname === '/api/admin/notifications' && request.method() === 'POST') { notifications++; await fulfill({ success: true }); return; }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { denied++; await fulfill({ code: 'SYNTHETIC_WRITE_BLOCKED' }, 403); return; }
  if (url.pathname === '/api/admin/evaluations') {
    if (failCurrentRead) { await fulfill({ code: 'SYNTHETIC_READ_UNAVAILABLE' }, 503); return; }
    const records = fixture.records.map((row: Record<string, unknown>) => ({ ...row, status: statuses.get(String(row.id)) ?? row.status }));
    await fulfill({ ...fixture, records, stats: { ...fixture.stats, deleted: records.filter((row: {status: string}) => row.status === 'deleted').length } }); return;
  }
  await route.continue();
});
const dialog = () => page.getByRole('dialog').filter({ has: page.locator('[data-record-action-preview]') });
async function openDelete() {
  await page.getByRole('button', { name: '검수 항목 삭제', exact: true }).first().click();
  await expect(dialog().getByRole('textbox', { name: '변경 적용 확인 문구' })).toBeVisible();
  await expect(dialog().getByRole('button', { name: '변경 적용', exact: true })).toBeDisabled();
}
async function confirm() { await dialog().getByRole('textbox', { name: '변경 적용 확인 문구' }).fill('변경 적용'); await dialog().getByRole('button', { name: '변경 적용', exact: true }).click(); }
async function geometry(width: number, label: string) {
  const overflow = await dialog().evaluate(element => element.scrollWidth - element.clientWidth);
  expect(overflow).toBe(0);
  const viewportOverflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); expect(viewportOverflow).toBe(0);
  await page.screenshot({ path: `performance/ui-renewal-20261003/record-actions-${label}-${width}-${suffix}.png` });
  results.push({ width, label, overflow, viewportOverflow });
}
try {
  await page.goto(`${origin}/__fixture/session`);
  for (const width of [390, 834, 1423]) {
    await page.setViewportSize({ width, height: 900 }); await page.goto(`${origin}/admin?module=restaurants`);
    await openDelete(); await geometry(width, 'preview'); const before = calls.length;
    await dialog().getByRole('button', { name: '취소', exact: true }).click(); await expect(dialog()).toHaveCount(0); expect(calls.length).toBe(before);
    results.push({ width, cancellationSentNoApply: true });
  }
  mode = 'stale'; calls = []; await openDelete(); await confirm(); await expect(dialog().getByRole('alert')).toContainText('다른 변경');
  expect(calls.map(call => call.phase)).toEqual(['preview', 'apply']); await expect(dialog().getByRole('button', { name: '변경 적용', exact: true })).toHaveCount(0);
  await dialog().getByRole('button', { name: '닫기', exact: true }).click();
  const invalidated = () => page.locator('[data-admin-record-views-invalidated]');
  const fresh = async () => { await invalidated().getByRole('button', { name: '새로 조회', exact: true }).click(); await expect(invalidated()).toHaveCount(0); };
  await expect(invalidated()).toBeVisible(); await expect(page.getByRole('button', { name: '검수 항목 삭제', exact: true })).toHaveCount(0);
  failCurrentRead = true; await invalidated().getByRole('button', { name: '새로 조회', exact: true }).click();
  await expect(invalidated().getByRole('button', { name: '새로 조회', exact: true })).toBeEnabled(); await expect(page.getByRole('button', { name: '검수 항목 삭제', exact: true })).toHaveCount(0);
  failCurrentRead = false; await fresh();
  results.push({ casConflictBlocksReplay: true, staleBackgroundCleared: true, failedFreshReadRemainsEmpty: true, successfulFreshReadRecovers: true });
  mode = 'delayed'; calls = []; await openDelete(); await confirm(); await expect.poll(() => Boolean(release)).toBe(true);
  await page.keyboard.press('Escape'); await expect(dialog()).toBeVisible(); await expect(dialog().getByRole('button', { name: '취소', exact: true })).toHaveCount(0);
  expect(calls.filter(call => call.phase === 'apply')).toHaveLength(1); release!(); await expect(dialog()).toHaveCount(0); await expect(invalidated()).toHaveCount(0); results.push({ inflightCancellationBlocked: true, singleApply: true });
  mode = 'lost'; calls = []; await openDelete(); failCurrentRead = true; await confirm(); await expect(dialog()).toHaveCount(0);
  await expect(invalidated()).toBeVisible(); await expect(invalidated().getByRole('button', { name: '새로 조회', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '검수 항목 삭제', exact: true })).toHaveCount(0); failCurrentRead = false; await fresh();
  results.push({ appliedReceiptWithFailedCurrentReadRemainsEmpty: true });
  expect(calls.map(call => call.method)).toEqual(['POST', 'POST', 'GET']); expect(new Set(calls.map(call => call.operationId)).size).toBe(1); results.push({ lostApplyRecoveredByOriginalId: true });
  mode = 'uncertain'; calls = []; await openDelete(); await confirm(); await expect(dialog().getByRole('button', { name: '기존 작업 결과 조회' })).toBeVisible();
  expect(calls.filter(call => call.phase === 'apply')).toHaveLength(1); await expect(invalidated()).toBeVisible(); await expect(page.getByRole('button', { name: '검수 항목 삭제', exact: true })).toHaveCount(0); await page.reload(); await expect(dialog().getByRole('button', { name: '기존 작업 결과 조회' })).toBeVisible();
  await expect(invalidated()).toBeVisible(); await expect(page.getByRole('button', { name: '검수 항목 삭제', exact: true })).toHaveCount(0);
  unknown = false; await dialog().getByRole('button', { name: '기존 작업 결과 조회' }).click(); await expect(dialog()).toHaveCount(0); expect(calls.filter(call => call.phase === 'apply')).toHaveLength(1);
  await expect(invalidated()).toHaveCount(0); expect(new Set(calls.map(call => call.operationId)).size).toBe(1); results.push({ uncertainBackgroundCleared: true, reloadRecoveredByOriginalId: true, noReplay: true });
  mode = 'normal'; calls = []; await page.goto(`${origin}/admin?module=submissions`);
  await page.getByRole('button', { name: '제보 수정', exact: true }).click(); await page.getByLabel('수정할 제보').selectOption('00000000-0000-4000-a100-000000000001');
  await page.getByLabel('제보 맛집 이름').fill('수정한 합성 맛집'); await page.getByRole('button', { name: '변경 내용 확인', exact: true }).click();
  await expect(dialog().getByLabel('적용할 변경')).toContainText('수정한 합성 맛집'); await confirm(); await expect(dialog()).toHaveCount(0);
  expect(calls.filter(call => call.method === 'POST').map(call => call.action)).toEqual(['submission.edit', 'submission.edit']); results.push({ reachableSubmissionEdit: true });
  await page.goto(`${origin}/admin?module=reviews`); calls = [];
  await page.locator('[data-admin-review-row]').first().click(); await page.getByRole('region', { name: '리뷰 상세 작업 패널' }).getByRole('button', { name: '승인', exact: true }).click();
  await expect(dialog().getByRole('textbox', { name: '변경 적용 확인 문구' })).toBeVisible(); await confirm(); await expect(dialog()).toHaveCount(0);
  expect(calls.filter(call => call.method === 'POST').map(call => call.action)).toEqual(['review.approve', 'review.approve']); results.push({ reviewApprovalGuarded: true });
  expect(denied).toBe(0); expect(pageErrors).toBe(0);
  const sourceEnd = sources(); expect(sourceEnd).toEqual(sourceStart);
  const report = { passed: true, kind: 'actual-page-synthetic-browser', origin, results, deniedUnexpectedWrites: denied, syntheticNotifications: notifications, pageErrors, actualWrites: 0, providerCalls: 0, browser: browser.version(), node: process.version, sourceStable: true, source: sourceEnd };
  writeFileSync(`performance/ui-renewal-20261003/record-actions-browser-${suffix}.json`, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
} catch (error) { await page.screenshot({ path: '/tmp/astra-record-browser-failure.png' }); console.log('FAILURE', error instanceof Error ? error.message : 'unknown'); throw error; }
finally { await context.unrouteAll({ behavior: 'ignoreErrors' }); }
process.exit(0);
