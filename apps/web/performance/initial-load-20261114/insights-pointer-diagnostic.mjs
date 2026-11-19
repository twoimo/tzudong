import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// A diagnostic copy preserves the original failure. This is neither a performance
// trial nor a replacement for the unchanged required insights test.
const taskRoot = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(taskRoot, '../..');
const repoRoot = resolve(appRoot, '../..');
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--output') throw new Error('DIAGNOSTIC_OUTPUT_REQUIRED');
const output = resolve(args[1]);
const allowedRoot = join(taskRoot, 'insights-pointer-runs') + '/';
if (!output.startsWith(allowedRoot)) throw new Error('DIAGNOSTIC_OUTPUT_OUTSIDE_CANONICAL_ROOT');
await mkdir(output, { recursive: true });
const sha256 = value => createHash('sha256').update(value).digest('hex');
const testRelative = 'tests-unit/insights-responsive-browser.test.ts';
const original = await readFile(join(appRoot, testRelative), 'utf8');
const fixtures = ['chrome-for-testing.ts', 'insights-responsive-fixture.ts', 'responsive-css.ts'];
const needle = "  const help = page.getByRole('button', { name: '트리맵 읽는 법', exact: true });\n  await expectReachable(help);";
if (original.split(needle).length !== 2) throw new Error('DIAGNOSTIC_INSERTION_CONTRACT_CHANGED');
const instrumentation = String.raw`  const help = page.getByRole('button', { name: '트리맵 읽는 법', exact: true });
  const snapshot = async () => help.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const box = ({ x, y, width, height }: DOMRect) => ({ x, y, width, height });
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    const preview = document.querySelector('[data-insights-hover-preview]');
    let left = 0, top = 0, right = innerWidth, bottom = innerHeight;
    let hiddenAncestorScrolled = false;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
      hiddenAncestorScrolled ||= (/(hidden|clip)/.test(style.overflowX) && Math.abs(parent.scrollLeft) > 1)
        || (/(hidden|clip)/.test(style.overflowY) && Math.abs(parent.scrollTop) > 1);
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
        left = Math.max(left, bounds.left + parent.clientLeft);
        right = Math.min(right, bounds.left + parent.clientLeft + parent.clientWidth);
      }
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
        top = Math.max(top, bounds.top + parent.clientTop);
        bottom = Math.min(bottom, bounds.top + parent.clientTop + parent.clientHeight);
      }
    }
    return {
      mode: location.pathname === '/admin' ? 'admin' : 'member',
      viewport: [innerWidth, innerHeight], target: box(rect),
      clip: { left, top, right, bottom }, hiddenAncestorScrolled,
      hitTag: hit?.tagName ?? null, hitInsideTarget: hit !== null && element.contains(hit),
      hitInsidePreview: hit !== null && preview !== null && preview.contains(hit),
      preview: preview ? box(preview.getBoundingClientRect()) : null,
      pointerEvents: (window as unknown as { __insightsPointerEvents?: unknown[] }).__insightsPointerEvents ?? [],
    };
  });
  try {
    await expectReachable(help);
  } catch (originalError) {
    const before = await snapshot();
    let recovery = 'FAIL';
    try {
      // Normal pointer movement only. Keep the same reachability assertion.
      await page.mouse.move(0, 0);
      await ui(previewFor(page)).toHaveCount(0);
      await expectReachable(help);
      recovery = 'PASS';
    } catch { /* The original failure remains the thrown test result below. */ }
    console.log('INSIGHTS_POINTER_DIAGNOSTIC=' + JSON.stringify({
      original: 'FAIL', recovery, before, after: await snapshot(),
    }));
    throw originalError;
  }
  console.log('INSIGHTS_POINTER_DIAGNOSTIC=' + JSON.stringify({
    original: 'PASS', recovery: 'NOT_ATTEMPTED', before: await snapshot(), after: null,
  }));`;
const popoverEntry = 'async function exercisePopovers(page: Page) {';
if (original.split(popoverEntry).length !== 2) throw new Error('DIAGNOSTIC_EVENT_INSERTION_CONTRACT_CHANGED');
const eventObservation = String.raw`async function exercisePopovers(page: Page) {
  await page.evaluate(() => {
    const events: unknown[] = [];
    (window as unknown as { __insightsPointerEvents: unknown[] }).__insightsPointerEvents = events;
    const observe = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return;
      const target = event.target instanceof Element ? event.target : null;
      const pointer = event instanceof PointerEvent ? event : null;
      const dialog = target?.closest('[role="dialog"]');
      events.push({ type: event.type, at: performance.now(), x: pointer?.clientX ?? null,
        y: pointer?.clientY ?? null, pointerType: pointer?.pointerType ?? null,
        escape: event instanceof KeyboardEvent && event.key === 'Escape',
        inChart: !!target?.closest('[data-insights-chart]'),
        inPreview: !!target?.closest('[data-insights-hover-preview]'),
        inDetail: !!dialog?.getAttribute('aria-label')?.startsWith('영상 상세:'),
        previewPresent: !!document.querySelector('[data-insights-hover-preview]'),
      });
      if (events.length > 96) events.shift();
    };
    for (const type of ['pointerenter', 'pointerleave', 'pointermove', 'keydown']) {
      document.addEventListener(type, observe, { capture: true, passive: true });
    }
  });`;
const generated = original.replace(needle, instrumentation).replace(popoverEntry, eventObservation);
const temp = await mkdtemp(join(appRoot, '.tmp-insights-pointer-'));
const identity = {};
const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' });
identity.sourceSha = /^[a-f0-9]{40}$/.test(git.stdout?.trim() ?? '') ? git.stdout.trim() : null;
identity.originalTestSha256 = sha256(original);
identity.generatedTestSha256 = sha256(generated);
identity.fixtureHashes = {};
const runs = [];
const pattern = '^(admin insights keeps the chart, controls and popovers reachable at 1024x768|member insights remeasures the loaded chart from portrait to short landscape)$';
try {
  await mkdir(join(temp, 'fixtures'));
  for (const name of fixtures) {
    const bytes = await readFile(join(appRoot, 'tests-unit/fixtures', name));
    identity.fixtureHashes[name] = sha256(bytes);
    await writeFile(join(temp, 'fixtures', name), bytes, { flag: 'wx' });
  }
  identity.homeClientSha256 = sha256(await readFile(join(appRoot, 'app/home-client.tsx')));
  identity.browserContract = JSON.parse(await readFile(join(repoRoot, '.github/chrome-for-testing.v1.json'), 'utf8'));
  await writeFile(join(temp, 'diagnostic.test.ts'), generated, { flag: 'wx' });
  await writeFile(join(output, 'identity.json'), JSON.stringify({
    schemaVersion: 'insights-pointer-diagnostic.v1', scope: 'synthetic-read-only-input-order-diagnosis',
    requiredTestUnchanged: true, exactBrowserHelperUnchanged: true,
    performanceEvidence: false, ...identity,
  }, null, 2) + '\n', { flag: 'wx' });
  for (let repeat = 1; repeat <= 4; repeat++) {
    const result = spawnSync('bun', ['test', join(temp, 'diagnostic.test.ts'), '--test-name-pattern', pattern], {
      cwd: appRoot, encoding: 'utf8', timeout: 120_000, maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: '1' },
    });
    // Never retain raw process/browser/provider output. Only our bounded numeric
    // fixture observations and fixed process outcome codes cross this boundary.
    const observations = [];
    for (const line of ((result.stdout ?? '') + '\n' + (result.stderr ?? '')).split('\n')) {
      const clean = line.replace(/\u001b\[[0-9;]*m/g, '').trim();
      if (!clean.startsWith('INSIGHTS_POINTER_DIAGNOSTIC=')) continue;
      try { observations.push(JSON.parse(clean.slice('INSIGHTS_POINTER_DIAGNOSTIC='.length))); }
      catch { throw new Error('DIAGNOSTIC_RECORD_INVALID'); }
    }
    const expectedFailures = observations.filter(item => item.original === 'FAIL').length;
    const rawOutcome = ((result.stdout ?? '') + '\n' + (result.stderr ?? '')).replace(/\u001b\[[0-9;]*m/g, '');
    const bunFailures = Number(rawOutcome.match(/^\s*(\d+) fail\s*$/m)?.[1] ?? -1);
    const completed = observations.length === 2 && result.signal === null
      && bunFailures === expectedFailures && result.status === (expectedFailures > 0 ? 1 : 0);
    const record = {
      repeat, expectedCases: 2, processExitCode: result.status, signal: result.signal,
      processErrorCode: result.error?.code ?? null, completed,
      originalFailures: expectedFailures, bunFailures,
      pointerRecoveryPasses: observations.filter(item => item.original === 'FAIL' && item.recovery === 'PASS').length,
      observations,
    };
    runs.push(record);
    await writeFile(join(output, 'repeat-' + String(repeat).padStart(2, '0') + '.json'), JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ repeat, completed, originalFailures: record.originalFailures, pointerRecoveryPasses: record.pointerRecoveryPasses }));
    if (!completed) break;
  }
} finally {
  await rm(temp, { recursive: true, force: true });
  const summary = {
    schemaVersion: 'insights-pointer-diagnostic-summary.v1', scope: 'diagnostic-only-not-required-test-pass',
    sourceSha: identity.sourceSha, repeatsPlanned: 4, repeatsCompleted: runs.filter(run => run.completed).length,
    casesObserved: runs.reduce((sum, run) => sum + run.observations.length, 0),
    originalFailures: runs.reduce((sum, run) => sum + run.originalFailures, 0),
    pointerRecoveryPasses: runs.reduce((sum, run) => sum + run.pointerRecoveryPasses, 0),
    allOriginalFailuresRetained: true, officialTestModified: false,
    complete: runs.length === 4 && runs.every(run => run.completed),
  };
  await writeFile(join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
  if (!summary.complete) process.exitCode = 1;
}
