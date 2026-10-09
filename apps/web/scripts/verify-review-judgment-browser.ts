/** Owned agent-browser 0.38.1; synthetic automation in browser memory; no forwarded mutations. */
import { chromium, type Locator } from 'playwright';
import { expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import { execFileSync } from 'node:child_process';
import type { ReviewAutomationSnapshot, ReviewAutomationPreview, ReviewGeminiDecision } from '../lib/admin/restaurant-review-automation.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Resolve the actual parser's two local imports without editing production source.
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === './normalize-evaluation-record') return nextResolve(pathToFileURL(resolve(root, 'lib/admin/normalize-evaluation-record.ts')).href, context);
  if (specifier === '@/lib/admin-evaluation-name') return nextResolve(pathToFileURL(resolve(root, 'lib/admin-evaluation-name.ts')).href, context);
  return nextResolve(specifier, context);
} });
const { parseReviewAutomationSnapshot, parseReviewAutomationPreview, REVIEW_EVIDENCE_CODES } = await import('../lib/admin/restaurant-review-automation.ts');
const origin = 'http://127.0.0.1:18794', fakeSupabase = 'http://127.0.0.1:18793';
const allowedOrigins = new Set([origin, fakeSupabase]);
const endpoint = `${origin}/api/admin/evaluations/automation`;
const connection = process.argv[2];
if (!/^ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[a-z0-9-]+$/i.test(connection ?? '')) throw new Error('OWNED_LOCAL_BROWSER_REQUIRED');
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const sourcePaths = ['components/admin/RestaurantReviewAutomation.tsx', 'lib/admin/restaurant-review-automation.ts',
  'lib/admin/normalize-evaluation-record.ts', 'tests-unit/restaurant-review-judgment.test.ts', 'components/admin/EvaluationRowDetails.tsx',
  'app/api/admin/evaluations/automation/route.ts', 'scripts/preview-design-fixtures.mjs', 'scripts/verify-review-judgment-browser.ts'];
const sources = () => sourcePaths.map(path => ({ path, sha256: hash(readFileSync(resolve(root, path))) }));
const sourceStart = sources();
const sourceHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const admissionOnly = process.argv.includes('--admission');
const previousReport = resolve(root, 'performance/ui-renewal-20261003/review-judgment-browser-20261004.json');
const previousReportSha256 = admissionOnly ? hash(readFileSync(previousReport)) : null;
const output = resolve(root, `performance/ui-renewal-20261003/review-judgment-browser-${admissionOnly ? 'admission-' : ''}20261004.json`);
const stamp = '2026-10-04T09:00:00Z', uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const labels = ['합성 차단 이력', '합성 한도 이력', '합성 보류 이력'];
const outcomes = ['blocked', 'deferred', 'hold'] as const, outcomeLabels = ['적용 차단', '한도 대기', '보류'];
const evidenceLabels = ['방문 근거', '상호 일치', '리뷰 근거', '카테고리 일치', '위치 교차 확인', '원본 일치'];
const legacy = (): ReviewAutomationSnapshot => ({ policy: { version: 7, enabled: true, batch_size: 50, daily_limit: 50, last_run_at: null }, runs: [], items: [], queue: { queued: 2, running: 1, failed: 0 } });
const enabled = (): ReviewAutomationSnapshot => ({ ...legacy(), judgmentEngine: { provider: 'gemini', model: 'gemini-3.8-flash', promptVersion: 'restaurant-review-v1', requiredForApproval: true, maxCallsPerClaim: 1 },
  runs: [{ id: uuid(91), started_at: stamp, scanned: 3, approved: 0, held: 1, recheck: 0, protected: 0 }],
  items: outcomes.map((outcome, index) => ({ id: uuid(index + 101), restaurant_id: uuid(index + 1), restaurant_name: labels[index], state: 'applied',
    reason: ['location_requires_review', 'daily_limit', 'gemini_hold'][index], geminiDecision: {
      schemaVersion: 1, model: 'gemini-3.8-flash', modelVersion: 'gemini-3.8-flash', promptVersion: 'restaurant-review-v1',
      inputSha256: 'a'.repeat(64), promptSha256: 'b'.repeat(64), recommendation: 'approve', evidenceCodes: [...REVIEW_EVIDENCE_CODES.slice(0, 6)], outcome, decidedAt: stamp,
    } as ReviewGeminiDecision })),
});
let snapshot = legacy(), width = 0, phase = 'setup', schemaValidationCount = 0;
const validateSnapshot = (value: ReviewAutomationSnapshot) => { parseReviewAutomationSnapshot(value); schemaValidationCount++; return value; };
const validatePreview = (value: ReviewAutomationPreview) => { parseReviewAutomationPreview(value); schemaValidationCount++; return value; };
validateSnapshot(legacy()); validateSnapshot(enabled());
const assertions: Array<{ width: number; name: string; passed: boolean }> = [];
function check(name: string, passed: boolean) { assertions.push({ width, name, passed }); if (!passed) throw new Error(name); }
const events: Array<{ width: number; phase: string; action: string; status: number }> = [];
const overflows: Array<{ width: number; phase: string; document: number; target: number; escapedHorizontal: number }> = [];
let externalBlocked = 0, unexpectedMutationsBlocked = 0, getAutomationCount = 0, detailGetCount = 0;
let pageErrorCount = 0, consoleErrorCount = 0, expectedConsoleErrors = 0, unexpectedConsoleErrors = 0, networkFailures = 0;
let readPostCount = 0, runAttemptCount = 0;
const runIds: string[] = []; // In memory only. Never included in the report.
const syntheticReadUrls = {
  eligibility: `${fakeSupabase}/rest/v1/rpc/get_current_privacy_eligibility`, activeSession: `${fakeSupabase}/rest/v1/rpc/is_current_auth_session_active`,
  profile: `${fakeSupabase}/rest/v1/rpc/read_public_profile_summaries`, adminProfile: `${origin}/api/admin/profile-summaries`,
};
const fixtureProfiles = Array.from({ length: 3 }, (_, index) => ({ user_id: `00000000-0000-4000-9000-${String(index + 1).padStart(12, '0')}`, nickname: `검증 사용자 ${index + 1}`, avatar_url: null }));
const browser = await chromium.connectOverCDP(connection);
let failureCode: string | null = null;
try {
  const context = browser.contexts()[0], blankUrls = new Set(['about:blank', 'chrome://newtab/', 'chrome://new-tab-page/']);
  check('owned-blank-browser', !!context && context.pages().every(page => blankUrls.has(page.url())));
  const page = context.pages()[0] ?? await context.newPage();
  page.setDefaultTimeout(8_000); page.setDefaultNavigationTimeout(20_000);
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await context.addInitScript(() => {
    localStorage.setItem('tzudong:e2e-admin-shell-bypass', '1'); localStorage.setItem('tzudong-admin-theme', 'system');
    localStorage.setItem('tzudong-admin-sidebar-collapsed', 'false'); localStorage.removeItem('adminEvaluationPageState');
  });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    const fulfill = (value: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (!allowedOrigins.has(url.origin)) { externalBlocked++; await route.abort('blockedbyclient'); return; }
    if (request.method() === 'POST' && Object.values(syntheticReadUrls).includes(url.href)) {
      let value: unknown;
      if (url.href === syntheticReadUrls.eligibility) value = { schemaVersion: 1, eligible: true, reasonCode: 'PRIVACY_ELIGIBLE', policyVersionId: uuid(1), policyVersion: '2026-08-04.1', contentSha256: '6e42ced065a6ea0762b85d9b5e11500fcfc535543ab50d12ffbe6490086a110b' };
      else if (url.href === syntheticReadUrls.activeSession) value = true;
      else {
        let ids: unknown; const body = request.postData() ?? '';
        try { ids = body.length <= 65_536 ? JSON.parse(body)[url.href === syntheticReadUrls.profile ? 'p_user_ids' : 'userIds'] : null; } catch { ids = null; }
        if (!Array.isArray(ids) || ids.length > 100 || ids.some(id => typeof id !== 'string')) { await fulfill({ error: 'FIXTURE_READ_INPUT_INVALID' }, 400); return; }
        value = url.href === syntheticReadUrls.profile ? fixtureProfiles.filter(profile => ids.includes(profile.user_id)) : { rows: ids.map(id => ({ userId: id, nickname: fixtureProfiles.find(profile => profile.user_id === id)?.nickname ?? null })) };
      }
      readPostCount++; await fulfill(value); return;
    }
    if (url.href === endpoint && request.method() === 'GET') { getAutomationCount++; await fulfill(validateSnapshot(snapshot)); return; }
    if (url.href === endpoint && request.method() === 'POST') {
      let body: Record<string, unknown>;
      try { const raw = request.postData() ?? ''; body = raw.length <= 4096 ? JSON.parse(raw) : {}; } catch { body = {}; }
      const action = String(body.action);
      if (['preview', 'preview-run', 'preview-stop'].includes(action)) {
        check(`${action}-has-no-confirmation-or-run-uuid`, !('confirmation' in body) && !('requestId' in body));
        if (action === 'preview') check('preview-start-has-bounded-policy', body.batchSize === 50 && body.dailyLimit === 50);
        const value: ReviewAutomationPreview = { version: String(snapshot.policy.version), previewHash: 'c'.repeat(32), counts: { approve: 0, recheck: 0, hold: 3, protected: 0 }, batchSize: 50, dailyLimit: 50,
          ...(action !== 'preview' ? { action: action === 'preview-run' ? 'run' as const : 'stop' as const, queue: { queued: 2, running: 1 }, remainingApprovals: 50 } : {}) };
        events.push({ width, phase, action, status: 200 }); await fulfill(validatePreview(value)); return;
      }
      if (['start', 'stop', 'run'].includes(action)) {
        check(`${action}-confirmation-bound-to-preview`, body.version === String(snapshot.policy.version) && body.previewHash === 'c'.repeat(32)
          && body.batchSize === 50 && body.dailyLimit === 50 && body.confirmation === ({ start: '자동 승인 시작', stop: '자동 운영 중지', run: '지금 실행' } as Record<string, string>)[action]);
        if (action === 'run') {
          check('run-has-v4-uuid', typeof body.requestId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId));
          runIds.push(String(body.requestId)); runAttemptCount++;
          if (runAttemptCount === 1) { events.push({ width, phase, action, status: 503 }); await fulfill({ error: 'FIXTURE_UNCERTAIN' }, 503); return; }
        } else {
          check(`${action}-does-not-invent-run-uuid`, !('requestId' in body));
          snapshot = { ...snapshot, policy: { ...snapshot.policy, enabled: action === 'start', version: snapshot.policy.version + 1 } };
        }
        events.push({ width, phase, action, status: 200 }); await fulfill(validateSnapshot(snapshot)); return;
      }
      unexpectedMutationsBlocked++; await fulfill({ error: 'FIXTURE_WRITE_DENIED' }, 403); return;
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { unexpectedMutationsBlocked++; await fulfill({ error: 'FIXTURE_WRITE_DENIED' }, 403); return; }
    if (url.origin === origin && /^\/api\/admin\/evaluations\/[0-9a-f-]{36}$/i.test(url.pathname)) detailGetCount++;
    await route.continue(); // Evaluation detail GET remains the existing synthetic gateway response.
  });
  await context.routeWebSocket('**/*', socket => {
    const url = new URL(socket.url());
    if (url.origin === origin.replace('http:', 'ws:') && url.pathname.startsWith('/_next/')) socket.connectToServer();
    else { externalBlocked++; socket.close(); }
  });
  page.on('pageerror', () => pageErrorCount++);
  page.on('console', message => { if (message.type() !== 'error') return; consoleErrorCount++; if (/Failed to load resource.*503/.test(message.text())) expectedConsoleErrors++; else unexpectedConsoleErrors++; });
  page.on('requestfailed', request => { if (allowedOrigins.has(new URL(request.url()).origin) && !request.failure()?.errorText.includes('ABORTED')) networkFailures++; });
  const automation = page.getByRole('region', { name: '맛집 검수 자동 운영', exact: true });
  const details = page.getByRole('region', { name: '맛집 검수 자동 운영 상세', exact: true });
  async function measure(target: Locator) {
    const dimensions = await target.evaluate(element => ({ document: Math.max(0, document.documentElement.scrollWidth - innerWidth), target: Math.max(0, element.scrollWidth - element.clientWidth),
      escapedHorizontal: Math.max(0, -element.getBoundingClientRect().left, element.getBoundingClientRect().right - innerWidth) }));
    overflows.push({ width, phase, ...dimensions });
    check(`${phase}-no-horizontal-overflow`, Object.values(dimensions).every(value => value <= 1));
  }
  await page.goto(`${origin}/__fixture/session`, { waitUntil: 'domcontentloaded' });
  for (const viewportWidth of [390, 1423]) {
    width = viewportWidth; snapshot = legacy();
    await page.setViewportSize({ width, height: 1000 });
    phase = 'legacy';
    await page.goto(`${origin}/admin?module=restaurants`, { waitUntil: 'domcontentloaded' });
    await expect(automation.getByRole('status')).toHaveText('켜짐 · 판단 연결 미확인');
    check('legacy-does-not-claim-gemini-active', !(await automation.innerText()).includes('Gemini 검수 켜짐'));
    await measure(automation);
    if (admissionOnly) {
      await expect(automation.getByRole('button', { name: '지금 실행', exact: true })).toBeDisabled();
      check('legacy-enabled-run-disabled', true);
      await expect(automation.getByRole('button', { name: '중지', exact: true })).toBeEnabled();
      check('legacy-enabled-stop-available', true);
      phase = 'legacy-stop-preview';
      await automation.getByRole('button', { name: '중지', exact: true }).click();
      const stopPreview = page.getByRole('alertdialog');
      await expect(stopPreview.getByRole('heading', { name: '자동 운영을 중지할까요?', exact: true })).toBeVisible();
      check('legacy-stop-preview-works-without-engine', snapshot.policy.enabled && !snapshot.judgmentEngine);
      await measure(stopPreview);
      await stopPreview.getByRole('button', { name: '취소', exact: true }).click();
      await expect(stopPreview).toHaveCount(0);
      phase = 'legacy-stopped';
      snapshot = { ...legacy(), policy: { ...legacy().policy, enabled: false } };
      await automation.getByRole('button', { name: '자동 운영 상태 새로고침' }).click();
      await expect(automation.getByRole('status')).toHaveText('중지됨 · 판단 연결 미확인');
      await expect(automation.getByRole('button', { name: '설정', exact: true })).toBeDisabled();
      check('legacy-stopped-settings-disabled', true);
      await automation.getByRole('button', { name: '이력·정책', exact: true }).click();
      await expect(details.getByRole('button', { name: '후보 미리보기', exact: true })).toBeDisabled();
      check('legacy-stopped-preview-disabled', true);
      check('legacy-cannot-send-start-or-run', events.every(event => event.action !== 'start' && event.action !== 'run'));
      await measure(details);
      await automation.getByRole('button', { name: '이력·정책', exact: true }).click();
    }
    phase = 'engine'; snapshot = enabled();
    await automation.getByRole('button', { name: '자동 운영 상태 새로고침' }).click();
    await expect(automation.getByRole('status')).toHaveText('Gemini 검수 켜짐');
    check('verified-engine-status-rendered', true);
    await expect(automation.getByRole('button', { name: '지금 실행', exact: true })).toBeEnabled();
    check('verified-engine-run-enabled', true);
    await automation.getByRole('button', { name: '이력·정책', exact: true }).click();
    await expect(details.getByText('최근 승인 0 · 보류 1 · 재검수 0 · 보호 0', { exact: true })).toBeVisible();
    check('actual-approved-count-remains-zero', true);
    await measure(details);
    for (let index = 0; index < (admissionOnly ? 0 : outcomes.length); index++) {
      phase = `detail-${outcomes[index]}`;
      const row = details.locator('li').filter({ hasText: labels[index] });
      await expect(row).toContainText(`Gemini 권장 승인 · 처리 ${outcomeLabels[index]}`);
      check(`${outcomes[index]}-recommendation-and-outcome-distinct`, true);
      const before = detailGetCount;
      await row.getByRole('button', { name: labels[index], exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '검수 상세', exact: true });
      const evidence = dialog.getByRole('region', { name: 'Gemini 판단 근거', exact: true });
      await expect(evidence).toBeVisible();
      await expect(evidence.getByText('권장 승인', { exact: true })).toBeVisible();
      await expect(evidence.getByText(`처리 ${outcomeLabels[index]}`, { exact: true })).toBeVisible();
      await expect(evidence.getByText('Gemini 3.8 Flash', { exact: true })).toBeVisible();
      for (const label of evidenceLabels) await expect(evidence.getByText(label, { exact: true })).toBeVisible();
      check(`${outcomes[index]}-six-evidence-codes-rendered`, await evidence.getByRole('listitem').count() === 6);
      check(`${outcomes[index]}-detail-get-preserved`, detailGetCount === before + 1);
      await measure(dialog);
      await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
    }
    phase = 'run-preview-cancel';
    let beforeRuns = runAttemptCount;
    await automation.getByRole('button', { name: '지금 실행', exact: true }).click();
    let confirmation = page.getByRole('alertdialog');
    await expect(confirmation.getByRole('heading', { name: '지금 검수할까요?', exact: true })).toBeVisible();
    check('preview-never-runs-before-confirmation', runAttemptCount === beforeRuns);
    await measure(confirmation);
    await confirmation.getByRole('button', { name: '취소', exact: true }).click(); await expect(confirmation).toHaveCount(0);
    check('cancel-sends-no-run', runAttemptCount === beforeRuns);
    if (width !== 1423) continue;

    phase = 'run-uncertain';
    await automation.getByRole('button', { name: '지금 실행', exact: true }).click();
    confirmation = page.getByRole('alertdialog');
    await expect(confirmation.getByRole('heading', { name: '지금 검수할까요?', exact: true })).toBeVisible();
    await confirmation.getByRole('button', { name: '지금 실행', exact: true }).click();
    await expect(confirmation.getByRole('alert')).toContainText('결과를 확인하지 못했습니다');
    await expect(confirmation.getByRole('button', { name: '지금 실행', exact: true })).toBeEnabled();
    check('uncertain-run-retains-confirmation', runIds.length === 1);
    phase = 'run-retry';
    await confirmation.getByRole('button', { name: '지금 실행', exact: true }).click(); await expect(confirmation).toHaveCount(0);
    check('uncertain-retry-reuses-uuid', runIds.length === 2 && runIds[0] === runIds[1]);
    phase = 'run-new-operation';
    await automation.getByRole('button', { name: '지금 실행', exact: true }).click();
    confirmation = page.getByRole('alertdialog');
    await expect(confirmation.getByRole('heading', { name: '지금 검수할까요?', exact: true })).toBeVisible();
    await confirmation.getByRole('button', { name: '지금 실행', exact: true }).click(); await expect(confirmation).toHaveCount(0);
    check('successful-run-clears-uuid-for-new-operation', runIds.length === 3 && runIds[2] !== runIds[1]);

    phase = 'stop-confirmation';
    await automation.getByRole('button', { name: '중지', exact: true }).click(); confirmation = page.getByRole('alertdialog');
    await expect(confirmation.getByRole('heading', { name: '자동 운영을 중지할까요?', exact: true })).toBeVisible();
    check('stop-preview-does-not-apply', snapshot.policy.enabled);
    await expect(confirmation).toContainText('재검수 대기 2건과 실행 1건을 취소합니다.');
    await confirmation.getByRole('button', { name: '자동 운영 중지', exact: true }).click();
    await expect(automation.getByRole('status')).toHaveText('중지됨');
    check('stop-memory-readback-rendered', !snapshot.policy.enabled);
    phase = 'start-confirmation';
    await details.getByRole('button', { name: '후보 미리보기', exact: true }).click(); confirmation = page.getByRole('alertdialog');
    await expect(confirmation.getByRole('heading', { name: '자동 승인을 시작할까요?', exact: true })).toBeVisible();
    check('start-preview-does-not-apply', !snapshot.policy.enabled);
    await confirmation.getByRole('button', { name: '자동 승인 시작', exact: true }).click();
    await expect(automation.getByRole('status')).toHaveText('Gemini 검수 켜짐');
    check('start-memory-readback-rendered', snapshot.policy.enabled);
  }
  check('no-browser-page-errors', pageErrorCount === 0);
  check('no-unexpected-console-errors', unexpectedConsoleErrors === 0);
  check('no-local-network-failures', networkFailures === 0);
  check('no-unexpected-mutations', unexpectedMutationsBlocked === 0);
  check('source-stable-during-run', JSON.stringify(sourceStart) === JSON.stringify(sources()));
  if (admissionOnly) check('previous-70-assertion-report-preserved', hash(readFileSync(previousReport)) === previousReportSha256);
} catch (error) {
  failureCode = assertions.at(-1)?.passed === false ? assertions.at(-1)!.name : `${phase}:${error instanceof Error ? error.name : 'UNKNOWN_ERROR'}`;
} finally {
  await browser.close();
  const report = { schemaVersion: 1, passed: failureCode === null, failureCode, sourceHead, sourceStart, sourceEnd: sources(),
    environment: { agentBrowserVersion: '0.38.1', browserOwner: 'tzudong-gemini-review-astra-74a1b6', widths: [390, 1423], height: 1000, light: true, loopbackSyntheticOnly: true },
    counts: { schemaValidationCount, getAutomationCount, detailGetCount, readPostCount, runAttemptCount, externalBlocked, unexpectedMutationsBlocked,
      pageErrorCount, consoleErrorCount, expectedConsoleErrors, unexpectedConsoleErrors, networkFailures, forwardedMutations: 0, forwardedExternalRequests: 0, realProviderCalls: 0 },
    events, assertions, overflows,
    scope: { admissionOnly, previousReportSha256, syntheticRenderAndInteractionOnly: true, providerAccuracyEvaluated: false, deployedApiEvaluated: false, databaseMutationEvaluated: false, evaluationDetailFixtureUnmodified: true },
  };
  const body = JSON.stringify(report, null, 2) + '\n'; writeFileSync(output, body); writeFileSync(output + '.sha256', hash(body) + '\n');
  console.log(JSON.stringify({ passed: report.passed, failureCode, assertions: assertions.length, output }));
  if (failureCode) process.exitCode = 1;
}
