/** Local synthetic UI and transport checks. Every POST is fulfilled or denied in this owned browser. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { GUARDED_MUTATION_CONFIRMATION } from '../lib/admin/guarded-mutation-contract.ts';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const connection = process.argv[2];
const renderOnly = process.argv.includes('--render-only');
const lightOnly = process.argv.includes('--light-only');
const evidenceId = new Date().toISOString().replace(/[:.]/g, '-');
const statesOnly = process.argv.includes('--states-only');
const consoleProbe = process.argv.includes('--console-probe');
if (!/^ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[a-z0-9-]+$/i.test(connection ?? '')) throw new Error('OWNED_LOCAL_BROWSER_REQUIRED');
const root = process.cwd(), origin = 'http://127.0.0.1:18794';
const output = resolve(root, 'performance/ui-renewal-20261003');
const files = ['components/admin/pipeline/AdminPipelineDashboard.tsx', 'components/admin/pipeline/PipelineFlowDiagram.tsx', 'components/admin/pipeline/PipelineFlowDiagram.module.css', 'lib/admin/pipeline-flow-view-model.ts', 'lib/admin/pipeline-action-preview.ts'];
const hash = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
const sourceHashes = () => files.map(path => ({ path, sha256: hash(readFileSync(resolve(root, path))) }));
const sourceStart = sourceHashes();
const sharedGeometryHashes = () => ['components/admin/AdminPageHeader.tsx', 'styles/admin-ui.css'].map(path => ({ path, sha256: hash(readFileSync(resolve(root, path))) }));
const sharedGeometryStart = sharedGeometryHashes();
const browser = await chromium.connectOverCDP(connection), context = browser.contexts()[0];
assert(context.pages().every(p => ['about:blank', 'chrome://new-tab-page/', 'chrome://newtab/'].includes(p.url()) || p.url().startsWith(origin)));
const page = context.pages().find(page => page.url().startsWith(origin))!; page.setDefaultTimeout(10_000);
await context.unrouteAll({ behavior: 'wait' });
await context.addInitScript(() => { localStorage.setItem('tzudong:e2e-admin-shell-bypass', '1'); localStorage.setItem('tzudong-admin-theme', 'system'); localStorage.setItem('tzudong-admin-sidebar-collapsed', 'false'); });
let scenario: 'available' | 'unavailable' | 'malformed' | 'gha' = 'available';
let phase: 'normal' | 'stale' | 'apply-unavailable' = 'normal';
let gets = 0, postsFulfilled = 0, externalDenied = 0, otherPostsDenied = 0, pageErrors = 0, consoleErrors = 0;
const job = { id: '22222222-2222-4222-8222-222222222222', target: 'tzuyang', profile: 'heavy_local', status: 'Fetching', dry_run: true, adapter_index: 0 };
let currentJob = { ...job };
const fixtureEvents = [
  { name: 'Step 1 (URL Collection)', status: 'completed', durationSeconds: 1.25 },
  { name: 'Step 2 (Metadata)', status: 'completed', durationSeconds: 2 },
  { name: 'Step 2.1+2.5 (Migration+Cleanup)', status: 'completed', durationSeconds: 0.5 },
  { name: 'Step 3 (Transcript)', status: 'completed', durationSeconds: 64 },
  { name: 'Step 3.1 (Context Generation)', status: 'completed', durationSeconds: 2 },
  ...['Step 3.2 (Visual Location)', 'Step 4 (Heatmap & Frames)', 'Step 5 (Map URL Crawling)', 'Step 6 (Frame Caption)'].map(name => ({ name, status: 'optional_skipped', durationSeconds: 0 })),
  { name: 'Step 11 (LAAJ Evaluation)', status: 'failed', durationSeconds: 3 },
  { name: 'Step 12 (Transform)', status: 'downstream_skipped', durationSeconds: -1, reason: 'DO_NOT_RENDER_PRIVATE_RAW' },
];
const consoleKinds: Record<string, number> = {};
const mutationChecks: Array<Record<string, unknown>> = [];
let previewIdentity: Record<string, unknown> | null = null;
page.on('pageerror', () => pageErrors++);
page.on('console', message => { if (message.type() === 'error') { consoleErrors++; if (consoleProbe) console.log(JSON.stringify({ consoleDiagnostic: message.text().replace(/(?:https?|wss?):\/\/\S+/g, '[url]').slice(0, 250) })); const kind = /WebSocket.*127\.0\.0\.1:18793/.test(message.text()) ? 'synthetic-realtime-handshake' : /502|403|404|ERR_BLOCKED|Failed to load resource/.test(message.text()) ? 'http-or-denied-resource' : 'other'; consoleKinds[kind] = (consoleKinds[kind] ?? 0) + 1; } });
await context.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url());
  const fulfill = (payload: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });
  if (![origin, 'http://127.0.0.1:18793'].includes(url.origin)) { externalDenied++; await route.abort(); return; }
  if (url.pathname === '/api/admin/pipeline' && request.method() === 'POST') {
    postsFulfilled++;
    const body = request.postDataJSON() as Record<string, unknown>;
    if (body.phase === 'preview') {
      previewIdentity = body;
      if (phase === 'stale') { await fulfill({ error: 'pipeline_preview_stale' }, 409); return; }
      const input = { action: body.action, target: body.target, profile: body.profile, ...(body.action === 'enqueue' ? { dryRun: body.dryRun } : { runId: body.runId }) };
      await fulfill({ phase: 'preview', requiredConfirmation: true, previewHash: hash(JSON.stringify(input)), operationId: 'synthetic-ticket', revision: 'a'.repeat(64), expiresAt: new Date(Date.now() + 60_000).toISOString() }); return;
    }
    assert.equal(body.phase, 'apply'); assert(previewIdentity);
    assert.equal(body.idempotencyKey, previewIdentity.idempotencyKey); assert.equal(body.correlationId, previewIdentity.correlationId);
    assert.equal(body.operationId, 'synthetic-ticket'); assert.equal(body.revision, 'a'.repeat(64));
    assert.equal(body.confirmationText, GUARDED_MUTATION_CONFIRMATION);
    if (body.action === 'enqueue' && body.dryRun === false) assert.equal(body.liveConfirmationText, 'LIVE_ENQUEUE');
    mutationChecks.push({ action: body.action, dryRun: body.dryRun ?? null, sameIdentity: true, ticketPreserved: true, fulfilledInBrowser: true });
    if (phase === 'apply-unavailable') { await fulfill({ error: 'DO_NOT_RENDER_PRIVATE_RAW' }, 502); return; }
    if (body.action === 'pause') currentJob = { ...currentJob, status: 'Paused' };
    if (body.action === 'resume') currentJob = { ...currentJob, status: 'Fetching' };
    await fulfill({ accepted: true, job: currentJob, readback: currentJob, audit: 'pipeline_control.audit' }); return;
  }
  if (url.pathname === '/api/admin/pipeline' && request.method() === 'GET') {
    gets++;
    if (scenario === 'unavailable') { await fulfill({ error: 'DO_NOT_RENDER_PRIVATE_RAW' }, 502); return; }
    if (scenario === 'malformed') { await fulfill({ jobs: 'unexpected' }); return; }
    if (scenario === 'gha') { await fulfill({ source: 'github_actions', jobs: [{ ...job, id: '99', profile: 'lite_gha', status: 'Failed', error_code: 'github_crawler', dry_run: false }], targets: [], failures: [{ error_code: 'failure' }] }); return; }
    await fulfill({ source: 'job_api', hardware: 'macbook_m5_max', dataEnv: 'local_db', jobs: [currentJob], targets: [{ id: 'tzuyang', status: currentJob.status }], failures: [{ ...job, id: '33333333-3333-4333-8333-333333333333', status: 'Failed', error_code: 'DO_NOT_RENDER_PRIVATE_RAW' }], gauges: { tzudong_pipeline_kafka_lag: 0 } }); return;
  }
  if (url.pathname === '/api/admin/system-status') {
    if (scenario === 'unavailable') { await fulfill({ error: 'DO_NOT_RENDER_PRIVATE_RAW' }, 502); return; }
    await fulfill({ runDaily: { manifestStatus: scenario === 'malformed' ? 'future' : 'available', stale: false, checkedAt: '2026-10-04T00:00:00Z', stepEvents: fixtureEvents }, githubActions: { enabled: true, configured: true, reachable: true, latestRunId: 99, latestRunStatus: 'in_progress', latestRunConclusion: null } }); return;
  }
  if (request.method() === 'POST' && ['/rest/v1/rpc/get_current_privacy_eligibility', '/rest/v1/rpc/is_current_auth_session_active', '/rest/v1/rpc/read_public_profile_summaries', '/api/admin/profile-summaries'].includes(url.pathname)) {
    const ids = request.postDataJSON()?.[url.pathname.includes('/api/') ? 'userIds' : 'p_user_ids'];
    const profiles = Array.isArray(ids) ? ids.slice(0, 100).map((id: string) => ({ user_id: id, nickname: '합성 검증 사용자', avatar_url: null })) : [];
    const value = url.pathname.includes('get_current_privacy') ? { schemaVersion: 1, eligible: true, reasonCode: 'PRIVACY_ELIGIBLE', policyVersionId: '00000000-0000-4000-8000-000000000001', policyVersion: '2026-08-04.1', contentSha256: '6e42ced065a6ea0762b85d9b5e11500fcfc535543ab50d12ffbe6490086a110b' } : url.pathname.includes('is_current_auth') ? true : url.pathname.includes('/api/') ? { rows: profiles.map(p => ({ userId: p.user_id, nickname: p.nickname })) } : profiles;
    await fulfill(value); return;
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { otherPostsDenied++; await fulfill({ error: 'FIXTURE_WRITE_DENIED' }, 403); return; }
  await route.continue();
});
await page.goto(origin + '/__fixture/session', { waitUntil: 'domcontentloaded' });
const panel = page.locator('[data-admin-pipeline-dashboard]');
const controls = page.locator('[data-pipeline-controls-drawer]');
async function ready() {
  await panel.waitFor();
  await page.locator('[data-pipeline-stage="collect"]').waitFor();
  await page.waitForFunction(() => {
    const diagram = document.querySelector('[data-pipeline-flow-diagram]');
    const box = diagram?.getBoundingClientRect();
    const viewBox = diagram?.querySelector('svg')?.getAttribute('viewBox')?.split(' ').map(Number);
    return box && viewBox && viewBox[2] === Math.floor(box.width) && viewBox[3] === Math.floor(box.height);
  });
}
async function closeDrawer(selector: string) {
  await page.keyboard.press('Escape');
  await page.locator(selector).waitFor({ state: 'detached' });
}
const cases: Array<Record<string, unknown>> = [];
for (const width of (statesOnly ? [] : consoleProbe ? [390] : [390, 834, 1423])) for (const colorScheme of (consoleProbe || lightOnly ? ['light'] as const : ['light', 'dark'] as const)) {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 960 });
  await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
  await page.goto(origin + '/admin?module=pipeline', { waitUntil: 'domcontentloaded' }); await ready();
  await page.waitForFunction(() => document.querySelector('[data-pipeline-stage="collect"]')?.getAttribute('data-stage-state') === 'completed');
  assert.equal(await controls.count(), 0);
  assert.equal(await page.locator('[data-pipeline-stage-detail]').count(), 0);
  assert.equal(await page.locator('[data-admin-pipeline-jobs]').count(), 0);
  const observation = await panel.evaluate(root => {
    const title = getComputedStyle(root.querySelector('[data-admin-page-header] h2')!);
    const svg = root.querySelector('[data-pipeline-flow-diagram] svg')!;
    const svgBox = svg.getBoundingClientRect();
    const nodes = [...svg.querySelectorAll('g[role="button"]')];
    const clippedText = nodes.flatMap(node => {
      const box = node.querySelector('rect')!.getBoundingClientRect();
      return [...node.querySelectorAll('text')].filter(text => { const b = text.getBoundingClientRect(); return b.left < box.left + 2 || b.right > box.right - 2 || b.top < box.top || b.bottom > box.bottom; });
    }).length;
    const clippedNodes = nodes.filter(node => { const b = node.getBoundingClientRect(); return b.left < svgBox.left || b.right > svgBox.right || b.top < svgBox.top || b.bottom > svgBox.bottom; }).length;
    const invisibleLabels = nodes.flatMap(node => [...node.querySelectorAll('text')].filter(text => getComputedStyle(text).fill === getComputedStyle(node.querySelector('rect')!).fill)).length;
    const box = root.getBoundingClientRect();
    const visibleText = (root as HTMLElement).innerText.replace(/\s+/g, ' ').trim();
    return {
      panelHeight: Math.round(box.height), diagramHeight: Math.round(svgBox.height), diagramWidth: Math.round(svgBox.width), direction: root.querySelector('[data-flow-direction]')?.getAttribute('data-flow-direction'),
      visibleTextCharacters: visibleText.length, defaultParagraphs: root.querySelectorAll('p').length, defaultAccordions: root.querySelectorAll('details').length,
      defaultChildren: root.children.length, invisibleLabels, nodes: nodes.length, edgePaths: svg.querySelectorAll(':scope > path').length, clippedText, clippedNodes,
      horizontalOverflow: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) - innerWidth,
      heading: { size: title.fontSize, weight: title.fontWeight, lineHeight: title.lineHeight }, rawLeak: root.textContent?.includes('DO_NOT_RENDER_PRIVATE_RAW'), theme: document.documentElement.classList.contains('dark'),
    };
  });
  assert.equal(observation.defaultChildren, 2); assert.equal(observation.defaultParagraphs, 0); assert.equal(observation.defaultAccordions, 0);
  assert.equal(observation.invisibleLabels, 0); assert.equal(observation.nodes, 8); assert.equal(observation.edgePaths, 8); assert.equal(observation.clippedText, 0); assert.equal(observation.clippedNodes, 0);
  assert(observation.diagramHeight >= 420); assert(observation.horizontalOverflow <= 1); assert.equal(observation.rawLeak, false); assert.equal(observation.theme, colorScheme === 'dark');
  assert.deepEqual(observation.heading, { size: '16px', weight: '600', lineHeight: '24px' });
  await page.screenshot({ path: resolve(output, `pipeline-diagram-only-${evidenceId}-${width}-${colorScheme}.png`) });
  const postsBefore = postsFulfilled;
  const trigger = panel.locator('[data-pipeline-open-controls]');
  await trigger.click(); await controls.waitFor();
  assert.equal(await controls.getAttribute('id'), await trigger.getAttribute('aria-controls'));
  assert.equal(await controls.locator('[data-admin-pipeline-enqueue]').isVisible(), true);
  await closeDrawer('[data-pipeline-controls-drawer]');
  assert.equal(await trigger.evaluate(el => document.activeElement === el), true);
  const evaluate = page.locator('[data-pipeline-stage="evaluate"]'); await evaluate.click();
  await page.locator('[data-pipeline-stage-detail="evaluate"]').waitFor();
  assert.equal(await evaluate.getAttribute('aria-pressed'), 'true');
  await closeDrawer('[data-pipeline-stage-detail]');
  assert.equal(await evaluate.evaluate(el => document.activeElement === el), true);
  const collect = page.locator('[data-pipeline-stage="collect"]'); await collect.focus(); await collect.press('ArrowRight');
  const media = page.locator('[data-pipeline-stage="media"]');
  assert.equal(await media.evaluate(el => document.activeElement === el), true);
  assert.equal(await page.locator('[data-pipeline-stage-detail]').count(), 0);
  await media.press('Enter'); await page.locator('[data-pipeline-stage-detail="media"]').waitFor();
  await closeDrawer('[data-pipeline-stage-detail]');
  await page.locator('[data-pipeline-stage="review"]').focus(); await page.keyboard.press('Space'); await page.locator('[data-pipeline-stage-detail="review"]').waitFor();
  assert.equal(await page.locator('[data-pipeline-stage-detail="review"] a').getAttribute('href'), '/admin?module=restaurants');
  await closeDrawer('[data-pipeline-stage-detail]');
  assert.equal(postsFulfilled, postsBefore);
  cases.push({ width, colorScheme, ...observation, controlsInDrawer: true, stepEvidenceInDrawer: true, arrowFocusOnly: true, enterAndSpaceSelection: true, focusRestored: true, manualReviewLink: true, openingDrawersDoesNotPost: true });
}
if (!renderOnly) {
  if (!statesOnly) {
    await panel.locator('[data-pipeline-open-controls]').click();
    await controls.locator('[data-admin-pipeline-pause]').click(); await page.locator('[data-pipeline-preview]').waitFor();
    const apply = page.locator('[data-pipeline-apply]'); assert.equal(await apply.isDisabled(), true); assert.equal(mutationChecks.length, 0);
    await page.getByLabel(`확인 문구 (${GUARDED_MUTATION_CONFIRMATION})`, { exact: true }).fill(GUARDED_MUTATION_CONFIRMATION);
    const readsBefore = gets; await apply.click(); await controls.locator('[data-admin-pipeline-resume]').waitFor(); assert(gets > readsBefore);
    await controls.locator('[data-admin-pipeline-enqueue-live]').click(); await page.locator('[data-pipeline-preview]').waitFor();
    await page.getByLabel(`확인 문구 (${GUARDED_MUTATION_CONFIRMATION})`, { exact: true }).fill(GUARDED_MUTATION_CONFIRMATION); assert.equal(await apply.isDisabled(), true);
    await page.getByLabel('실제 수집 확인 (LIVE_ENQUEUE)', { exact: true }).fill('LIVE_ENQUEUE');
    phase = 'apply-unavailable'; await apply.click(); await page.locator('[data-pipeline-preview]').waitFor({ state: 'detached' });
    assert.equal((await controls.textContent())?.includes('DO_NOT_RENDER_PRIVATE_RAW'), false); assert.equal(mutationChecks.length, 2);
    phase = 'stale'; await controls.locator('[data-admin-pipeline-enqueue]').click(); await controls.getByRole('status').filter({ hasText: '실행 상태가 바뀌었습니다' }).waitFor(); assert.equal(await page.locator('[data-pipeline-preview]').count(), 0);
    phase = 'normal'; await controls.locator('[data-admin-pipeline-enqueue]').click(); await page.locator('[data-pipeline-preview]').waitFor();
    const postsBeforeDismiss = postsFulfilled;
    await closeDrawer('[data-pipeline-controls-drawer]'); await panel.locator('[data-pipeline-open-controls]').click();
    assert.equal(await apply.count(), 0); assert.equal(postsFulfilled, postsBeforeDismiss);
    cases.push({ scenario: 'dismiss-preview', ticketDiscarded: true, noApplyOrReplay: true });
    await closeDrawer('[data-pipeline-controls-drawer]');
  }
  for (const state of ['gha', 'malformed', 'unavailable'] as const) {
    scenario = state; await page.goto(origin + '/admin?module=pipeline', { waitUntil: 'domcontentloaded' }); await ready();
    await panel.locator('[data-pipeline-open-controls]').click();
    if (state === 'gha') {
      await controls.locator('[data-admin-pipeline-job="99"]').waitFor();
      const text = await controls.locator('[data-admin-pipeline-job="99"]').textContent(); assert(text?.includes('수집 중')); assert(text?.includes('실행 모드 미확인')); assert(!text?.includes('실패')); assert(!text?.includes('오류 기록')); assert.equal(await controls.locator('[data-admin-pipeline-pause]').count(), 0);
    } else await controls.getByRole('status').filter({ hasText: '실행 상태를 불러올 수 없습니다' }).waitFor();
    assert.equal(await controls.locator('[data-admin-pipeline-enqueue]').isDisabled(), true);
    assert.equal((await controls.textContent())?.includes('DO_NOT_RENDER_PRIVATE_RAW'), false);
    if (state !== 'gha') assert.equal(await panel.locator('[data-pipeline-stage="collect"]').getAttribute('data-stage-state'), 'unknown');
    cases.push({ scenario: state, controlsDisabled: true, falseHealthyOrLiveClaim: false, rawLeak: false });
    await closeDrawer('[data-pipeline-controls-drawer]');
  }
}
const sourceEnd = sourceHashes(); assert.deepEqual(sourceEnd, sourceStart);
const sharedGeometryEnd = sharedGeometryHashes(); assert.deepEqual(sharedGeometryEnd, sharedGeometryStart); assert.equal(pageErrors, 0);
const report = { kind: 'pipeline-diagram-only-synthetic-browser', observedAt: new Date().toISOString(), browser: browser.version(), node: process.version, sourceStart, sourceEnd, sourceStable: true, sharedGeometryStart, sharedGeometryEnd, cases, mutationChecks, safety: { serverBoundPosts: 0, fixturePostsFulfilled: postsFulfilled, otherPostsDenied, externalDenied, realProviderCalls: 0 }, errors: { pageErrors, consoleErrors, consoleKinds, expectedHttpFailures: !renderOnly }, limitations: ['All pipeline and manifest bodies are synthetic browser fixtures.', 'No real API preview ticket, worker execution, provider output, DB write, deployment or production availability was tested.'] };
const reportFile = `pipeline-diagram-only-${evidenceId}${renderOnly ? '-render' : statesOnly ? '-states' : '-browser'}.json`;
const encoded = JSON.stringify(report, null, 2) + '\n'; writeFileSync(resolve(output, reportFile), encoded); writeFileSync(resolve(output, reportFile + '.sha256'), hash(encoded) + '\n');
console.log(JSON.stringify({ status: 'passed', cases: cases.length, syntheticApplyChecks: mutationChecks.length, pageErrors, consoleErrors, serverBoundPosts: 0, reportFile, evidenceSha256: hash(encoded) }));
await context.unrouteAll({ behavior: 'wait' });
process.exit(0);
