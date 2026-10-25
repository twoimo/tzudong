import { chromeForTestingExecutable } from '../tests-unit/fixtures/chrome-for-testing.ts';
/**
 * Loopback-only browser verification for explicit receipt OCR recovery.
 *
 * This renders the real admin review workspace while replacing only the OCR
 * status/recovery endpoints with deterministic in-memory responses. No request
 * reaches a hosted database, GitHub, or an OCR provider.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect } from '@playwright/test';
import { chromium, type Dialog, type Route } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const origin = 'http://127.0.0.1:18794';
const fakeSupabaseOrigin = 'http://127.0.0.1:18793';
const allowedOrigins = new Set([origin, fakeSupabaseOrigin]);
const outputDirectory = resolve(root, 'performance/cross-audit-20261019/ocr-recovery-ui-browser-verification/final-simple-confirmation-node24-20261019');
mkdirSync(outputDirectory, { recursive: true });

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const sourcePaths = [
  'components/admin/SubmissionListView.tsx',
  'lib/admin/ocr-recovery-confirmation.ts',
  'app/api/admin/ocr-receipts/rerun/route.ts',
  'lib/ocr/admin-receipt-recovery.ts',
  'lib/runtime-feature-readiness-contract.ts',
  'tsconfig.json',
  'scripts/preview-design-fixtures.mjs',
  'scripts/verify-admin-receipt-ocr-recovery-browser.ts',
];
const readSources = () => sourcePaths.map((path) => ({
  path,
  bytes: readFileSync(resolve(root, path)).byteLength,
  sha256: hash(readFileSync(resolve(root, path))),
}));
const sourceStart = readSources();
const sourceHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

const reviewId = '00000000-0000-4000-a400-000000000001';
const expectedGeneration = '11111111-1111-4111-8111-111111111111';
const recoveredGeneration = '33333333-3333-4333-8333-333333333333';
const persistedOperationId = '22222222-2222-4222-8222-222222222222';
const inputSnapshotHash = 'a'.repeat(64);
const guardedMutationConfirmation = 'Preview -> Confirm -> Apply -> Readback -> Audit';
const verificationPhotoObjectPath = `00000000-0000-4000-9000-000000000001/reviews/${reviewId}/verification/fixture-receipt.webp`;
const transparentPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEAQH/CFNqGQAAAABJRU5ErkJggg==',
  'base64',
);

type Phase =
  | 'setup'
  | 'cancelled-confirmation'
  | 'ack-loss-first'
  | 'ack-loss-retry'
  | 'recovery-in-progress-reload'
  | 'processing-refusal'
  | 'preview-conflict'
  | 'apply-stale-conflict';

type RecoveryRequest = {
  phase: Phase;
  kind: 'preview' | 'apply';
  body: Record<string, unknown>;
  outcome: string;
};

const assertions: Array<{ name: string; passed: boolean }> = [];
function check(name: string, passed: boolean) {
  assertions.push({ name, passed });
  if (!passed) throw new Error(name);
}

let phase: Phase = 'setup';
const recoveryRequests: RecoveryRequest[] = [];
const confirmationMessages: Array<{ phase: Phase; message: string; accepted: boolean }> = [];
let externalBlocked = 0;
let unexpectedMutationsBlocked = 0;
let expectedAckLossNetworkFailures = 0;
let unexpectedLocalNetworkFailures = 0;
let pageErrorCount = 0;
let unexpectedConsoleErrors = 0;
let expectedFixtureRealtimeConsoleErrors = 0;
let expectedModuleSwitchAborts = 0;
let expectedStaleConflictConsoleErrors = 0;
const localNetworkFailureDetails: Array<{ phase: Phase; method: string; pathname: string; error: string | null }> = [];
const consoleErrorDetails: Array<{ phase: Phase; text: string }> = [];

function recoveryPreview(status: 'eligible' | 'processing' | 'recovery_in_progress' | 'conflict') {
  const hasSnapshot = status === 'eligible' || status === 'recovery_in_progress';
  return {
    schemaVersion: 1,
    reviewId,
    status,
    expectedGeneration: hasSnapshot ? expectedGeneration : null,
    inputSnapshotHash: hasSnapshot ? inputSnapshotHash : null,
    recoveryOperationId: status === 'recovery_in_progress' ? persistedOperationId : null,
  };
}

async function fulfillJson(route: Route, status: number, body: unknown) {
  await route.fulfill({
    status,
    contentType: 'application/json; charset=utf-8',
    headers: { 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  });
}

const browser = await chromium.launch({
  headless: true,
  // Playwright's package points at a pruned cache entry in this workspace.
  // Launch the installed system Chrome with Playwright's isolated temporary
  // profile; the user's interactive Chrome profile/session is never opened.
  executablePath: chromeForTestingExecutable(),
});
const context = await browser.newContext({
  viewport: { width: 1423, height: 954 },
  colorScheme: 'light',
  locale: 'ko-KR',
  extraHTTPHeaders: {
    'x-e2e-admin-bypass': '1',
    'x-e2e-admin-bypass-token': 'design-fixture-local-only',
  },
});
await context.addInitScript(() => {
  localStorage.setItem('tzudong:e2e-admin-shell-bypass', '1');
  localStorage.setItem('tzudong-admin-theme', 'system');
  localStorage.setItem('tzudong-admin-sidebar-collapsed', 'false');
  localStorage.removeItem('adminEvaluationPageState');
});

await context.route('**/*', async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  if (!allowedOrigins.has(url.origin)) {
    externalBlocked++;
    await route.abort('blockedbyclient');
    return;
  }

  if (url.origin === origin && url.pathname === '/api/admin/ocr-receipts' && request.method() === 'GET') {
    await fulfillJson(route, 200, {
      pending: 3,
      duplicate: 0,
      processed: 0,
      readiness: { schemaVersion: 1, status: 'ready', code: 'FEATURE_DATABASE_READY' },
    });
    return;
  }

  if (url.origin === fakeSupabaseOrigin && url.pathname === '/rest/v1/reviews' && request.method() === 'GET') {
    const response = await route.fetch();
    const rows = await response.json() as Array<Record<string, unknown>>;
    const withReceipt = rows.map((row) => row.id === reviewId
      ? { ...row, verification_photo: verificationPhotoObjectPath }
      : row);
    await route.fulfill({
      status: response.status(),
      contentType: 'application/json; charset=utf-8',
      headers: { 'Access-Control-Allow-Origin': origin, 'Cache-Control': 'no-store' },
      body: JSON.stringify(withReceipt),
    });
    return;
  }

  if (url.origin === origin && url.pathname.startsWith('/api/admin/review-verification/') && request.method() === 'GET') {
    await route.fulfill({ status: 200, contentType: 'image/png', body: transparentPng });
    return;
  }

  if (url.origin === origin && url.pathname === '/api/admin/ocr-receipts/rerun' && request.method() === 'POST') {
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(request.postData() ?? '{}') as Record<string, unknown>;
    } catch {
      await fulfillJson(route, 400, { error: 'SYNTHETIC_INVALID_JSON' });
      return;
    }

    if (body.action === 'preview_provider_indeterminate') {
      const status = phase === 'recovery-in-progress-reload'
        ? 'recovery_in_progress'
        : phase === 'processing-refusal'
          ? 'processing'
          : phase === 'preview-conflict'
            ? 'conflict'
            : 'eligible';
      recoveryRequests.push({ phase, kind: 'preview', body, outcome: status });
      await fulfillJson(route, 200, { success: true, recovery: recoveryPreview(status) });
      return;
    }

    if (body.action === 'recover_provider_indeterminate') {
      if (phase === 'ack-loss-first') {
        recoveryRequests.push({ phase, kind: 'apply', body, outcome: 'response_lost_after_synthetic_commit' });
        await route.abort('failed');
        return;
      }
      if (phase === 'apply-stale-conflict') {
        recoveryRequests.push({ phase, kind: 'apply', body, outcome: 'stale_conflict' });
        await fulfillJson(route, 409, {
          code: 'OCR_RECOVERY_STALE',
          error: 'OCR 복구 상태가 변경되었습니다. 최신 상태를 다시 확인해 주세요.',
          dispatchSkipped: true,
        });
        return;
      }
      recoveryRequests.push({ phase, kind: 'apply', body, outcome: 'accepted' });
      await fulfillJson(route, 200, {
        success: true,
        message: 'OCR 복구 요청이 접수되었습니다. 처리 상태에서 결과를 확인해 주세요.',
        recoveryOperationId: body.recoveryOperationId,
        previousGeneration: expectedGeneration,
        generation: recoveredGeneration,
        inputSnapshotHash,
        recoveryIdempotent: phase === 'ack-loss-retry' || phase === 'recovery-in-progress-reload',
      });
      return;
    }

    recoveryRequests.push({ phase, kind: 'apply', body, outcome: 'unexpected_action' });
    await fulfillJson(route, 400, { error: 'SYNTHETIC_UNEXPECTED_ACTION' });
    return;
  }

  if (url.origin === origin && url.pathname.startsWith('/api/') && request.method() !== 'GET') {
    if (url.pathname === '/api/admin/profile-summaries' && request.method() === 'POST') {
      await route.continue();
      return;
    }
    unexpectedMutationsBlocked++;
    await fulfillJson(route, 405, { error: 'SYNTHETIC_WRITES_DISABLED' });
    return;
  }

  await route.continue();
});

const page = await context.newPage();
page.on('pageerror', () => { pageErrorCount++; });
page.on('console', (message) => {
  if (message.type() !== 'error') return;
  const text = message.text();
  if (phase === 'ack-loss-first' && /Failed to load resource|ERR_FAILED/i.test(text)) return;
  if (/WebSocket connection to 'ws:\/\/127\.0\.0\.1:18793\/realtime\/v1\/websocket[^']*' failed:/i.test(text)) {
    expectedFixtureRealtimeConsoleErrors++;
    return;
  }
  if (phase === 'apply-stale-conflict'
    && /Failed to load resource: the server responded with a status of 409 \(Conflict\)/i.test(text)) {
    expectedStaleConflictConsoleErrors++;
    return;
  }
  unexpectedConsoleErrors++;
  consoleErrorDetails.push({ phase, text: text.slice(0, 300) });
});
page.on('requestfailed', (request) => {
  const url = new URL(request.url());
  if (!allowedOrigins.has(url.origin)) return;
  if (phase === 'ack-loss-first' && url.pathname === '/api/admin/ocr-receipts/rerun') {
    expectedAckLossNetworkFailures++;
    return;
  }
  if (url.pathname === '/realtime/v1/websocket') return;
  if (url.pathname === '/api/admin/evaluations' && request.failure()?.errorText === 'net::ERR_ABORTED') {
    expectedModuleSwitchAborts++;
    return;
  }
  unexpectedLocalNetworkFailures++;
  localNetworkFailureDetails.push({
    phase,
    method: request.method(),
    pathname: url.pathname,
    error: request.failure()?.errorText ?? null,
  });
});

const toast = (text: string) => page.locator('.t-toast').filter({ hasText: text }).last();
const reviewPanel = () => page.getByRole('region', { name: '리뷰 상세 작업 패널' });
const recoveryButton = () => reviewPanel().locator('button').filter({ hasText: 'OCR 복구' }).first();
const previewCount = () => recoveryRequests.filter((request) => request.kind === 'preview').length;
const applyCount = () => recoveryRequests.filter((request) => request.kind === 'apply').length;

async function openPendingReview() {
  await page.goto(`${origin}/admin?module=reviews`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-admin-review-row]').first().waitFor();
  await page.locator(`[data-admin-review-row="${reviewId}"]`).click();
  await expect(reviewPanel()).toBeVisible();
  await expect(recoveryButton()).toBeVisible();
  await expect(recoveryButton()).toBeEnabled();
}

async function clickWithConfirmation(accepted: boolean) {
  const messagePromise = new Promise<string>((resolveMessage) => {
    page.once('dialog', async (dialog) => {
      const message = dialog.message();
      confirmationMessages.push({ phase, message, accepted });
      resolveMessage(message);
      if (accepted) await dialog.accept(); else await dialog.dismiss();
    });
  });
  await recoveryButton().click();
  return messagePromise;
}

async function waitForRequestCount(kind: 'preview' | 'apply', count: number) {
  await expect.poll(() => kind === 'preview' ? previewCount() : applyCount()).toBe(count);
}

let failureCode: string | null = null;
const screenshots: Array<{ phase: Phase; path: string; sha256: string }> = [];
async function capture(name: string) {
  const path = resolve(outputDirectory, `${name}.png`);
  await page.screenshot({ path, fullPage: false });
  screenshots.push({ phase, path: `performance/cross-audit-20261019/ocr-recovery-ui-browser-verification/final-simple-confirmation-node24-20261019/${name}.png`, sha256: hash(readFileSync(path)) });
}

try {
  const sessionResponse = await context.request.get(`${origin}/__fixture/session`, { maxRedirects: 0 });
  check('synthetic-session-cookie-created', sessionResponse.status() === 303);
  await openPendingReview();
  check('pending-review-renders-explicit-recovery-label', await recoveryButton().innerText() === 'OCR 복구');
  const buttonBox = await recoveryButton().boundingBox();
  const panelBox = await reviewPanel().boundingBox();
  check('recovery-button-has-visible-geometry', Boolean(buttonBox && buttonBox.width >= 44 && buttonBox.height >= 28));
  check('review-panel-has-visible-geometry', Boolean(panelBox && panelBox.width > 300 && panelBox.height > 300));

  phase = 'cancelled-confirmation';
  const beforeCancelPreview = previewCount();
  const beforeCancelApply = applyCount();
  const cancelMessage = await clickWithConfirmation(false);
  await waitForRequestCount('preview', beforeCancelPreview + 1);
  check('cancel-dialog-includes-additional-api-use-warning', cancelMessage.includes('추가 API 사용이 발생할 수 있습니다.'));
  check('cancel-dialog-includes-simple-confirmation', cancelMessage.endsWith('계속하시겠습니까?'));
  check('cancel-dialog-hides-internal-guarded-contract', !cancelMessage.includes(guardedMutationConfirmation));
  check('cancel-sends-no-apply-or-rotation', applyCount() === beforeCancelApply);
  await expect(recoveryButton()).toBeEnabled();
  await capture('01-cancelled-confirmation');

  phase = 'ack-loss-first';
  const firstMessage = await clickWithConfirmation(true);
  await waitForRequestCount('apply', beforeCancelApply + 1);
  await expect(toast('OCR 재실행 중 오류가 발생했습니다.')).toBeVisible();
  check('confirmed-dialog-repeats-cost-warning', firstMessage.includes('추가 API 사용이 발생할 수 있습니다.'));
  check('confirmed-dialog-includes-simple-confirmation', firstMessage.endsWith('계속하시겠습니까?'));
  check('confirmed-dialog-hides-internal-guarded-contract', !firstMessage.includes(guardedMutationConfirmation));
  const firstApply = recoveryRequests.filter((request) => request.kind === 'apply').at(-1)!;
  check('first-apply-has-exact-review-id', firstApply.body.reviewId === reviewId);
  check('first-apply-has-recovery-action', firstApply.body.action === 'recover_provider_indeterminate');
  check('first-apply-has-guarded-confirmation', firstApply.body.guardedMutationConfirmation === guardedMutationConfirmation);
  check('first-apply-has-preview-generation', firstApply.body.expectedGeneration === expectedGeneration);
  check('first-apply-has-preview-snapshot', firstApply.body.inputSnapshotHash === inputSnapshotHash);
  check('first-apply-has-uuid-operation', typeof firstApply.body.recoveryOperationId === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(firstApply.body.recoveryOperationId));
  await capture('02-ack-loss-preserves-retry');

  phase = 'ack-loss-retry';
  let retryDialogCount = 0;
  const retryDialogListener = async (dialog: Dialog) => {
    retryDialogCount++;
    await dialog.dismiss();
  };
  page.on('dialog', retryDialogListener);
  const beforeRetryPreview = previewCount();
  const beforeRetryApply = applyCount();
  await recoveryButton().click();
  await waitForRequestCount('preview', beforeRetryPreview + 1);
  await waitForRequestCount('apply', beforeRetryApply + 1);
  page.off('dialog', retryDialogListener);
  const retryApply = recoveryRequests.filter((request) => request.kind === 'apply').at(-1)!;
  check('ack-loss-retry-reuses-operation-id', retryApply.body.recoveryOperationId === firstApply.body.recoveryOperationId);
  check('ack-loss-retry-does-not-reconfirm-paid-operation', retryDialogCount === 0);
  await expect(toast('OCR 복구 요청이 접수되었습니다.')).toBeVisible();
  const resultCheckingButton = reviewPanel().locator('button').filter({ hasText: '결과 확인 중' }).first();
  await expect(resultCheckingButton).toBeVisible();
  await expect(resultCheckingButton).toBeDisabled();
  await expect(reviewPanel().getByText('OCR 결과를 확인하고 있습니다.', { exact: true })).toBeVisible();
  const resultCheckingText = await reviewPanel().innerText();
  check('accepted-recovery-renders-neutral-result-checking-button', (await resultCheckingButton.innerText()) === '결과 확인 중');
  check('accepted-recovery-renders-neutral-result-checking-copy', resultCheckingText.includes('OCR 결과를 확인하고 있습니다.'));
  check('accepted-recovery-renders-no-fixed-eta', !/40초|\d+초 후 완료 예정/.test(resultCheckingText));
  await capture('03-neutral-result-checking');

  phase = 'recovery-in-progress-reload';
  const beforeReloadPreview = previewCount();
  const beforeReloadApply = applyCount();
  let reloadDialogCount = 0;
  await openPendingReview();
  const reloadDialogListener = async (dialog: Dialog) => {
    reloadDialogCount++;
    await dialog.dismiss();
  };
  page.on('dialog', reloadDialogListener);
  await recoveryButton().click();
  await waitForRequestCount('preview', beforeReloadPreview + 1);
  await waitForRequestCount('apply', beforeReloadApply + 1);
  page.off('dialog', reloadDialogListener);
  const reloadApply = recoveryRequests.filter((request) => request.kind === 'apply').at(-1)!;
  check('reload-restores-db-operation-id', reloadApply.body.recoveryOperationId === persistedOperationId);
  check('reload-restores-db-generation', reloadApply.body.expectedGeneration === expectedGeneration);
  check('reload-restores-db-snapshot', reloadApply.body.inputSnapshotHash === inputSnapshotHash);
  check('recovery-in-progress-reload-does-not-reconfirm', reloadDialogCount === 0);
  await capture('04-recovery-in-progress-reload');

  phase = 'processing-refusal';
  const beforeProcessingApply = applyCount();
  await openPendingReview();
  await recoveryButton().click();
  await expect(toast('기존 OCR 처리가 진행 중입니다. 처리 상태를 확인해 주세요.')).toBeVisible();
  check('processing-refusal-sends-no-apply', applyCount() === beforeProcessingApply);
  await capture('05-processing-refusal');

  phase = 'preview-conflict';
  const beforeConflictApply = applyCount();
  await openPendingReview();
  await recoveryButton().click();
  await expect(toast('OCR 복구 상태가 변경되었습니다. 최신 상태를 다시 확인해 주세요.')).toBeVisible();
  check('preview-conflict-sends-no-apply', applyCount() === beforeConflictApply);
  await capture('06-preview-conflict');

  phase = 'apply-stale-conflict';
  const beforeStaleApply = applyCount();
  await openPendingReview();
  const staleDialog = await clickWithConfirmation(true);
  await waitForRequestCount('apply', beforeStaleApply + 1);
  await expect(toast('OCR 재실행 실패: OCR 복구 상태가 변경되었습니다. 최신 상태를 다시 확인해 주세요.')).toBeVisible();
  check('stale-apply-keeps-explicit-confirmation', staleDialog.includes('추가 API 사용이 발생할 수 있습니다.'));
  check('stale-apply-dispatches-once', applyCount() === beforeStaleApply + 1);
  await page.waitForTimeout(250);
  check('stale-apply-does-not-auto-retry', applyCount() === beforeStaleApply + 1);
  await capture('07-apply-stale-conflict');

  check('ack-loss-produces-one-expected-local-network-failure', expectedAckLossNetworkFailures === 1);
  check('no-unexpected-local-network-failures', unexpectedLocalNetworkFailures === 0);
  check('no-unexpected-browser-page-errors', pageErrorCount === 0);
  check('no-unexpected-console-errors', unexpectedConsoleErrors === 0);
  check('no-unexpected-mutations-forwarded', unexpectedMutationsBlocked === 0);
  check('all-preview-bodies-are-minimal', recoveryRequests.filter((request) => request.kind === 'preview').every((request) => {
    const keys = Object.keys(request.body).sort();
    return keys.length === 2 && keys[0] === 'action' && keys[1] === 'reviewId'
      && request.body.reviewId === reviewId;
  }));
  check('all-apply-bodies-match-guarded-shape', recoveryRequests.filter((request) => request.kind === 'apply').every((request) => {
    const keys = Object.keys(request.body).sort();
    return JSON.stringify(keys) === JSON.stringify([
      'action', 'expectedGeneration', 'guardedMutationConfirmation', 'inputSnapshotHash', 'recoveryOperationId', 'reviewId',
    ].sort());
  }));
  check('source-stable-during-browser-run', JSON.stringify(readSources()) === JSON.stringify(sourceStart));
} catch (error) {
  failureCode = assertions.at(-1)?.passed === false
    ? assertions.at(-1)!.name
    : `${phase}:${error instanceof Error ? error.message : 'UNKNOWN_ERROR'}`;
  await page.screenshot({ path: resolve(outputDirectory, 'failure.png'), fullPage: false }).catch(() => undefined);
} finally {
  const sourceEnd = readSources();
  const report = {
    schemaVersion: 1,
    passed: failureCode === null,
    failureCode,
    kind: 'actual-admin-ui-with-loopback-synthetic-ocr-endpoints',
    story: 'pending review OCR recovery button -> preview -> explicit confirmation -> guarded recovery request -> rendered success/refusal/conflict state',
    sourceHead,
    sourceStart,
    sourceEnd,
    environment: {
      origin,
      fakeSupabaseOrigin,
      browser: browser.version(),
      node: process.version,
      viewport: { width: 1423, height: 954 },
      loopbackOnly: true,
    },
    counts: {
      assertions: assertions.length,
      previews: previewCount(),
      applies: applyCount(),
      confirmations: confirmationMessages.length,
      externalBlocked,
      unexpectedMutationsBlocked,
      expectedAckLossNetworkFailures,
      unexpectedLocalNetworkFailures,
      pageErrorCount,
      unexpectedConsoleErrors,
      expectedFixtureRealtimeConsoleErrors,
      expectedModuleSwitchAborts,
      expectedStaleConflictConsoleErrors,
      forwardedExternalRequests: 0,
      realProviderCalls: 0,
      hostedDatabaseCalls: 0,
      hostedMutations: 0,
    },
    geometry: {
      recoveryButton: await recoveryButton().boundingBox().catch(() => null),
      reviewPanel: await reviewPanel().boundingBox().catch(() => null),
    },
    assertions,
    confirmationMessages,
    recoveryRequests,
    localNetworkFailureDetails,
    consoleErrorDetails,
    screenshots,
    limitations: {
      browserUiAndRequestContractOnly: true,
      realRouteHandlerExecution: false,
      sqlRpcExecution: false,
      githubWorkflowDispatch: false,
      providerAccuracyEvaluated: false,
      hostedDeploymentEvaluated: false,
    },
  };
  const reportBody = `${JSON.stringify(report, null, 2)}\n`;
  writeFileSync(resolve(outputDirectory, 'report.json'), reportBody);
  writeFileSync(resolve(outputDirectory, 'report.json.sha256'), `${hash(reportBody)}\n`);
  await context.close().catch(() => undefined);
  await browser.close().catch(() => undefined);
  console.log(JSON.stringify({ passed: report.passed, failureCode, assertions: assertions.length, outputDirectory }));
  if (failureCode) process.exitCode = 1;
}
