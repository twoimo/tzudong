import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { panMockMap } from '../../tests/mobile-home-map-helpers.ts';
import { catalog, launch, origin, ready, setup } from './runtime.mjs';

const EXPECTED_ORIGIN = 'http://localhost:3310';
const CANDIDATE_BUILD = process.env.RENDER_CANDIDATE_BUILD || 'v7';
const FIXTURE_COUNT = 735;
const SWIPE_COUNT = 5;
const TOUCH_MOVE_STEPS = 7;
const TOUCH_STEP_DELAY_MS = 16;
const MAX_FAILURES = 24;
const OUTPUT_ROOT = new URL('native-touch-final-v2/', import.meta.url);
const SWIPE_TARGET = '[data-restaurant-detail-swipe-area="content"]';

if (origin !== EXPECTED_ORIGIN) {
  throw new Error(`Native-touch runtime origin mismatch: ${origin}`);
}

const fixtureNames = catalog(FIXTURE_COUNT).map((row) => row.name);
const fixtureNameSet = new Set(fixtureNames);

const sourceFiles = [
  ['native-touch.mjs.txt', new URL('native-touch.mjs', import.meta.url)],
  ['runtime.mjs.txt', new URL('runtime.mjs', import.meta.url)],
  ['plan-v6.json.txt', new URL('plan-v6.json', import.meta.url)],
];
const frozenSources = await Promise.all(sourceFiles.map(async ([outputName, sourceUrl]) => {
  const contents = await readFile(sourceUrl);
  return {
    outputName,
    contents,
    sha256: createHash('sha256').update(contents).digest('hex'),
  };
}));

// mkdir is intentionally exclusive, and every evidence file below uses wx.
await mkdir(OUTPUT_ROOT);
for (const source of frozenSources) {
  await writeFile(new URL(source.outputName, OUTPUT_ROOT), source.contents, { flag: 'wx' });
}

const result = {
  schema: 'native-touch-final-v2',
  status: 'running',
  scope: {
    build: `candidate-${CANDIDATE_BUILD}`,
    route: 'production standalone route at localhost:3310',
    viewport: { width: 390, height: 844, mobile: true, hasTouch: true },
    fixture: { kind: 'synthetic-local', count: FIXTURE_COUNT },
    provider: 'mocked Naver provider API',
    inputKinds: {
      clusterAndCard: 'trusted Playwright native pointer input',
      swipes: 'trusted CDP Input.dispatchTouchEvent touchStart/move/touchEnd',
      setupPan: 'panMockMap mocked-provider API input',
    },
    persistedData: 'fixture names and bounded counters/geometry only; no cookies, headers, request bodies, credentials, or provider payloads',
  },
  frozenSources: Object.fromEntries(frozenSources.map((source) => [source.outputName, source.sha256])),
  receipt: null,
  browser: null,
  checks: 0,
  failures: [],
  observations: {
    ready: null,
    cluster: null,
    boundedList: null,
    initialCandidateName: null,
    swipes: [],
    final: null,
    requestSummary: null,
    errors: null,
  },
  limitations: [
    'requestAnimationFrame cannot sample while a main-thread long task is blocking; cadence gaps are bounded observations, not complete frame capture.',
    'DOM existence and getBoundingClientRect positions do not prove physical pixels or compositor paint.',
    'The provider and 735 restaurant rows are local deterministic mocks; this is not a live SDK, hosted-data, or field-timing claim.',
    'A single final screenshot is retained; no tracing filmstrip is collected, avoiding trace overhead in this supplemental correctness flow.',
  ],
};

function bounded(value, depth = 0) {
  if (typeof value === 'string') return value.slice(0, 240);
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'boolean' || value == null) return value;
  if (depth >= 3) return '[bounded]';
  if (Array.isArray(value)) return value.slice(0, 16).map((item) => bounded(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value).slice(0, 20).map(([key, item]) => [key, bounded(item, depth + 1)]),
  );
}

function check(at, condition, expected, observed) {
  result.checks += 1;
  if (condition || result.failures.length >= MAX_FAILURES) return condition;
  result.failures.push({ at, expected: bounded(expected), observed: bounded(observed) });
  return false;
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitUntil(label, predicate, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(25);
  }
  const suffix = lastError instanceof Error ? ` (${lastError.message.slice(0, 160)})` : '';
  throw new Error(`Timed out waiting for ${label}${suffix}`);
}

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

function round(value) {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : null;
}

function summarizeFrames(frames) {
  const gaps = frames.slice(1).map((frame, index) => frame.t - frames[index].t);
  const panelRects = frames.map((frame) => frame.panel).filter(Boolean);
  const targetRects = frames.map((frame) => frame.target).filter(Boolean);
  const rectSummary = (rects) => rects.length === 0 ? null : {
    first: rects[0],
    last: rects.at(-1),
    minX: round(Math.min(...rects.map((rect) => rect.x))),
    maxX: round(Math.max(...rects.map((rect) => rect.x))),
    minY: round(Math.min(...rects.map((rect) => rect.y))),
    maxY: round(Math.max(...rects.map((rect) => rect.y))),
    minWidth: round(Math.min(...rects.map((rect) => rect.width))),
    maxWidth: round(Math.max(...rects.map((rect) => rect.width))),
    minHeight: round(Math.min(...rects.map((rect) => rect.height))),
    maxHeight: round(Math.max(...rects.map((rect) => rect.height))),
  };
  return {
    count: frames.length,
    detailPresentFrames: frames.filter((frame) => frame.detailCount === 1).length,
    detailCounts: [...new Set(frames.map((frame) => frame.detailCount))].sort(),
    cadenceMs: {
      min: gaps.length ? round(Math.min(...gaps)) : null,
      median: round(percentile(gaps, 0.5)),
      p95: round(percentile(gaps, 0.95)),
      max: gaps.length ? round(Math.max(...gaps)) : null,
    },
    panelPosition: rectSummary(panelRects),
    swipeAreaPosition: rectSummary(targetRects),
  };
}

function summarizeTouchCadence(events) {
  const gaps = events.slice(1).map((event, index) => event.t - events[index].t);
  return {
    eventCount: events.length,
    min: gaps.length ? round(Math.min(...gaps)) : null,
    median: round(percentile(gaps, 0.5)),
    max: gaps.length ? round(Math.max(...gaps)) : null,
  };
}

async function currentFixtureName(page) {
  return page.evaluate((names) => {
    const text = document.querySelector('[data-testid="restaurant-detail-panel"]')?.textContent || '';
    return names.find((name) => text.includes(name)) || null;
  }, fixtureNames);
}

async function readUiSnapshot(page) {
  return page.evaluate(() => {
    const probe = window.__NATIVE_TOUCH_PROBE__;
    const map = window.__TZUDONG_DEBUG_MAP__;
    return {
      mainCount: document.querySelectorAll('main#main-content').length,
      horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      mapContainerCount: document.querySelectorAll('[data-testid="map-container"]').length,
      mapCreates: window.__viewportMapCreates ?? null,
      mapIdentityStable: Boolean(
        probe?.mapReference
        && probe.mapReference === map
        && probe.mapElement === document.querySelector('[data-testid="map-container"]')
      ),
      zoom: Number(map?.getZoom?.() ?? NaN),
      sdkMarkerCount: document.querySelectorAll('[data-testid="map-container"] [data-testid="marker"]').length,
      clusterCount: document.querySelectorAll('.cluster-marker-container').length,
      detailCount: document.querySelectorAll('[data-testid="restaurant-detail-panel"]').length,
    };
  });
}

async function dispatchTrustedLeftSwipe(page, cdp) {
  const geometry = await page.locator(SWIPE_TARGET).evaluate((target) => {
    const rect = target.getBoundingClientRect();
    const y = Math.min(rect.bottom - 24, Math.max(rect.top + 24, rect.top + rect.height * 0.35));
    return {
      startX: Math.min(innerWidth - 24, rect.right - 40),
      endX: Math.max(24, rect.left + 40),
      y,
      rect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        right: rect.right,
        bottom: rect.bottom,
      },
    };
  });

  if (!(geometry.startX - geometry.endX > 10) || geometry.rect.width <= 0 || geometry.rect.height <= 0) {
    throw new Error(`Swipe target has invalid geometry: ${JSON.stringify(bounded(geometry))}`);
  }

  const touchPoint = (x) => ({
    x,
    y: geometry.y,
    id: 1,
    radiusX: 1,
    radiusY: 1,
    rotationAngle: 0,
    force: 1,
  });

  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [touchPoint(geometry.startX)],
    modifiers: 0,
  });
  await page.waitForTimeout(TOUCH_STEP_DELAY_MS);

  for (let step = 1; step <= TOUCH_MOVE_STEPS; step += 1) {
    const progress = step / TOUCH_MOVE_STEPS;
    const x = geometry.startX + (geometry.endX - geometry.startX) * progress;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [touchPoint(x)],
      modifiers: 0,
    });
    await page.waitForTimeout(TOUCH_STEP_DELAY_MS);
  }

  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
    modifiers: 0,
  });

  return {
    startX: round(geometry.startX),
    endX: round(geometry.endX),
    y: round(geometry.y),
    distanceX: round(geometry.endX - geometry.startX),
    moveSteps: TOUCH_MOVE_STEPS,
    requestedStepDelayMs: TOUCH_STEP_DELAY_MS,
    targetRect: Object.fromEntries(Object.entries(geometry.rect).map(([key, value]) => [key, round(value)])),
  };
}

async function installProbe(page) {
  await page.addInitScript((names) => {
    const selector = '[data-restaurant-detail-swipe-area="content"]';
    const probe = {
      active: false,
      frames: [],
      touchEvents: [],
      clicks: [],
      mapReference: null,
      mapElement: null,
    };
    window.__NATIVE_TOUCH_PROBE__ = probe;

    const fixtureName = () => {
      const text = document.querySelector('[data-testid="restaurant-detail-panel"]')?.textContent || '';
      return names.find((name) => text.includes(name)) || null;
    };
    const roundedRect = (element) => {
      if (!(element instanceof Element)) return null;
      const rect = element.getBoundingClientRect();
      return {
        x: Number(rect.x.toFixed(2)),
        y: Number(rect.y.toFixed(2)),
        width: Number(rect.width.toFixed(2)),
        height: Number(rect.height.toFixed(2)),
        right: Number(rect.right.toFixed(2)),
        bottom: Number(rect.bottom.toFixed(2)),
      };
    };

    document.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      const cluster = target.closest('.cluster-marker-container');
      const cardButton = target.closest('[data-mobile-visible-marker-restaurants-sheet="true"] button,[data-mobile-visible-marker-restaurants-sheet="true"] [role="button"]');
      const cardName = cardButton ? names.find((name) => cardButton.textContent?.includes(name)) || null : null;
      if (!cluster && !cardName) return;
      probe.clicks.push({
        kind: cluster ? 'cluster' : 'fixture-card',
        isTrusted: event.isTrusted,
        t: Number(performance.now().toFixed(2)),
        candidateName: cardName,
      });
      if (probe.clicks.length > 24) probe.clicks.shift();
    }, true);

    for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
      document.addEventListener(type, (event) => {
        const target = event.target instanceof Element ? event.target.closest(selector) : null;
        if (!target) return;
        const point = event.touches?.[0] || event.changedTouches?.[0] || null;
        probe.touchEvents.push({
          type,
          isTrusted: event.isTrusted,
          t: Number(performance.now().toFixed(2)),
          touches: event.touches?.length ?? 0,
          changedTouches: event.changedTouches?.length ?? 0,
          x: point ? Number(point.clientX.toFixed(2)) : null,
          y: point ? Number(point.clientY.toFixed(2)) : null,
          candidateName: fixtureName(),
        });
        if (probe.touchEvents.length > 128) probe.touchEvents.shift();
      }, true);
    }

    const frame = (timestamp) => {
      if (probe.active && probe.frames.length < 1_200) {
        const panel = document.querySelector('[data-testid="restaurant-detail-panel"]');
        const target = document.querySelector(selector);
        probe.frames.push({
          t: Number(timestamp.toFixed(2)),
          detailCount: document.querySelectorAll('[data-testid="restaurant-detail-panel"]').length,
          panel: roundedRect(panel),
          target: roundedRect(target),
        });
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }, fixtureNames);
}

async function runFlow(execution) {
  const test = await setup(execution.browser, {
    mobile: true,
    count: FIXTURE_COUNT,
    cpu: 4,
    delay: 120,
    throttle: false,
  });
  let screenshot = null;

  try {
    await installProbe(test.page);
    await ready(test.page);

    result.observations.ready = await test.page.evaluate(() => {
      const probe = window.__NATIVE_TOUCH_PROBE__;
      probe.mapReference = window.__TZUDONG_DEBUG_MAP__;
      probe.mapElement = document.querySelector('[data-testid="map-container"]');
      return {
        mapCreates: window.__viewportMapCreates ?? null,
        mapContainerCount: document.querySelectorAll('[data-testid="map-container"]').length,
        clusterCount: document.querySelectorAll('.cluster-marker-container').length,
        horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      };
    });
    check('ready.map-count', result.observations.ready.mapCreates === 1, 1, result.observations.ready.mapCreates);
    check('ready.single-map-container', result.observations.ready.mapContainerCount === 1, 1, result.observations.ready.mapContainerCount);
    check('ready.cluster-present', result.observations.ready.clusterCount > 0, '> 0', result.observations.ready.clusterCount);
    check('ready.no-horizontal-overflow', result.observations.ready.horizontalOverflow === 0, 0, result.observations.ready.horizontalOverflow);

    await panMockMap(test.page, 0, -180);
    await test.page.waitForTimeout(350);
    const cluster = test.page.locator('.cluster-marker-container').first();
    await cluster.waitFor({ state: 'visible', timeout: 12_000 });
    const clusterLabel = (await cluster.innerText()).trim();
    await cluster.click();
    await test.page.waitForFunction(() => Number(window.__TZUDONG_DEBUG_MAP__?.getZoom?.()) >= 14, undefined, { timeout: 12_000 });
    await test.page.waitForFunction(() => document.querySelectorAll('[data-testid="marker"]').length > 0, undefined, { timeout: 12_000 });
    await test.page.waitForFunction(() => document.querySelectorAll('.cluster-marker-container').length === 0, undefined, { timeout: 12_000 });

    const clusterClick = await test.page.evaluate(() => window.__NATIVE_TOUCH_PROBE__?.clicks.find((click) => click.kind === 'cluster') || null);
    const expanded = await readUiSnapshot(test.page);
    result.observations.cluster = { label: clusterLabel, click: clusterClick, expanded };
    check('cluster.fixture-count-label', clusterLabel === String(FIXTURE_COUNT), String(FIXTURE_COUNT), clusterLabel);
    check('cluster.native-click-is-trusted', clusterClick?.isTrusted === true, true, clusterClick);
    check('cluster.expands-to-individual-markers', expanded.sdkMarkerCount > 0, '> 0', expanded.sdkMarkerCount);
    check('cluster.offscreen-sdk-markers-bounded', expanded.sdkMarkerCount < FIXTURE_COUNT, `< ${FIXTURE_COUNT}`, expanded.sdkMarkerCount);
    check('cluster.map-identity', expanded.mapIdentityStable && expanded.mapCreates === 1, { stable: true, count: 1 }, expanded);
    check('cluster.no-horizontal-overflow', expanded.horizontalOverflow === 0, 0, expanded.horizontalOverflow);

    const listBadge = test.page.locator(`[aria-label="맛집 목록 ${FIXTURE_COUNT}곳"]:visible`).first();
    await listBadge.waitFor({ state: 'visible', timeout: 8_000 });
    const sheet = test.page.locator('[data-mobile-visible-marker-restaurants-sheet="true"]');
    if (!await sheet.isVisible()) {
      await test.page.getByRole('button', { name: /맛집 목록/ }).first().click();
    }
    await sheet.waitFor({ state: 'visible', timeout: 8_000 });
    const fixtureCards = sheet.getByRole('button').filter({ hasText: /실험맛집\d{4}/ });
    const cardCount = await fixtureCards.count();
    const firstCard = fixtureCards.first();
    const firstCardName = await firstCard.evaluate((button, names) => names.find((name) => button.textContent?.includes(name)) || null, fixtureNames);
    check('list.full-candidate-badge', await listBadge.count() === 1, `${FIXTURE_COUNT} candidates`, await listBadge.count());
    check('list.mobile-card-bound', cardCount === 20, 20, cardCount);
    check('list.first-card-is-fixture', fixtureNameSet.has(firstCardName), 'fixture name', firstCardName);

    await firstCard.click();
    const detail = test.page.getByTestId('restaurant-detail-panel').first();
    await detail.waitFor({ state: 'visible', timeout: 8_000 });
    const initialCandidateName = await waitUntil('first fixture card detail', () => currentFixtureName(test.page));
    const cardClick = await test.page.evaluate(() => window.__NATIVE_TOUCH_PROBE__?.clicks.find((click) => click.kind === 'fixture-card') || null);
    result.observations.boundedList = { badgeCount: FIXTURE_COUNT, cardCount, firstCardName, click: cardClick };
    result.observations.initialCandidateName = initialCandidateName;
    check('list.first-card-native-click-is-trusted', cardClick?.isTrusted === true, true, cardClick);
    check('detail.matches-first-card', initialCandidateName === firstCardName, firstCardName, initialCandidateName);

    await test.page.evaluate(() => {
      window.__NATIVE_TOUCH_PROBE__.active = true;
    });

    let candidateName = initialCandidateName;
    for (let index = 0; index < SWIPE_COUNT; index += 1) {
      await test.page.locator(SWIPE_TARGET).waitFor({ state: 'visible', timeout: 8_000 });
      const bracket = await test.page.evaluate(() => ({
        start: performance.now(),
        eventIndex: window.__NATIVE_TOUCH_PROBE__.touchEvents.length,
        frameIndex: window.__NATIVE_TOUCH_PROBE__.frames.length,
      }));
      const gesture = await dispatchTrustedLeftSwipe(test.page, test.cdp);
      const nextCandidateName = await waitUntil(
        `candidate change after native swipe ${index + 1}`,
        async () => {
          const current = await currentFixtureName(test.page);
          return current && current !== candidateName ? current : null;
        },
      );
      await test.page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const capture = await test.page.evaluate(({ eventIndex, frameIndex, start }) => {
        const probe = window.__NATIVE_TOUCH_PROBE__;
        const end = performance.now();
        const longTasks = (window.__perf?.longTasks || []).filter((task) => task.start < end && task.start + task.duration > start);
        return {
          start,
          end,
          events: probe.touchEvents.slice(eventIndex, eventIndex + 24),
          frames: probe.frames.slice(frameIndex, frameIndex + 180),
          longTasks: {
            count: longTasks.length,
            totalOverlapMs: longTasks.reduce(
              (total, task) => total + Math.max(0, Math.min(end, task.start + task.duration) - Math.max(start, task.start)),
              0,
            ),
          },
        };
      }, bracket);
      const ui = await readUiSnapshot(test.page);
      const frameSummary = summarizeFrames(capture.frames);
      const eventTypes = capture.events.map((event) => event.type);
      const allTrusted = capture.events.length > 0 && capture.events.every((event) => event.isTrusted === true);
      const startsCorrectly = eventTypes[0] === 'touchstart';
      const hasMove = eventTypes.includes('touchmove');
      const endsCorrectly = eventTypes.at(-1) === 'touchend';
      const panelRectsInsideViewport = capture.frames.every((frame) => !frame.panel || (
        frame.panel.width > 0
        && frame.panel.height > 0
        && frame.panel.right > 0
        && frame.panel.x < 390
        && frame.panel.bottom > 0
        && frame.panel.y < 844
      ));

      const observation = {
        index: index + 1,
        beforeName: candidateName,
        afterName: nextCandidateName,
        changed: nextCandidateName !== candidateName,
        gesture,
        touchEvents: capture.events,
        touchCadenceMs: summarizeTouchCadence(capture.events),
        rAF: frameSummary,
        longTasks: {
          count: capture.longTasks.count,
          totalOverlapMs: round(capture.longTasks.totalOverlapMs),
        },
        elapsedObservationMs: round(capture.end - capture.start),
        map: {
          identityStable: ui.mapIdentityStable,
          count: ui.mapCreates,
          containerCount: ui.mapContainerCount,
          sdkMarkerCount: ui.sdkMarkerCount,
          zoom: ui.zoom,
        },
        detailCount: ui.detailCount,
        horizontalOverflow: ui.horizontalOverflow,
      };
      result.observations.swipes.push(observation);

      check(`swipe-${index + 1}.candidate-changed`, nextCandidateName !== candidateName, 'different fixture name', { before: candidateName, after: nextCandidateName });
      check(`swipe-${index + 1}.candidate-is-fixture`, fixtureNameSet.has(nextCandidateName), 'fixture name', nextCandidateName);
      check(`swipe-${index + 1}.trusted-touch-sequence`, allTrusted && startsCorrectly && hasMove && endsCorrectly, { trusted: true, sequence: 'touchstart,touchmove+,touchend' }, capture.events);
      check(`swipe-${index + 1}.detail-present-in-raf`, frameSummary.count >= 2 && frameSummary.detailPresentFrames === frameSummary.count, { frames: '>= 2', detailCountEachFrame: 1 }, frameSummary);
      check(`swipe-${index + 1}.detail-position-intersects-viewport`, panelRectsInsideViewport, true, frameSummary.panelPosition);
      check(`swipe-${index + 1}.map-identity-count`, ui.mapIdentityStable && ui.mapCreates === 1 && ui.mapContainerCount === 1, { stable: true, count: 1, containers: 1 }, observation.map);
      check(`swipe-${index + 1}.single-detail`, ui.detailCount === 1, 1, ui.detailCount);
      check(`swipe-${index + 1}.no-horizontal-overflow`, ui.horizontalOverflow === 0, 0, ui.horizontalOverflow);
      candidateName = nextCandidateName;
    }

    await test.page.evaluate(() => {
      window.__NATIVE_TOUCH_PROBE__.active = false;
    });
    const finalUi = await readUiSnapshot(test.page);
    result.observations.final = {
      candidateName,
      ui: finalUi,
      candidateSequence: [initialCandidateName, ...result.observations.swipes.map((swipe) => swipe.afterName)],
    };
    check('final.five-swipes-recorded', result.observations.swipes.length === SWIPE_COUNT, SWIPE_COUNT, result.observations.swipes.length);
    check('final.candidate-sequence-unique', new Set(result.observations.final.candidateSequence).size === SWIPE_COUNT + 1, SWIPE_COUNT + 1, result.observations.final.candidateSequence);
    check('final.map-identity-count', finalUi.mapIdentityStable && finalUi.mapCreates === 1, { stable: true, count: 1 }, finalUi);
    check('final.no-horizontal-overflow', finalUi.horizontalOverflow === 0, 0, finalUi.horizontalOverflow);

    screenshot = await test.page.screenshot({ type: 'png', animations: 'disabled' });
    result.observations.errors = { ...test.errors };
    result.observations.requestSummary = {
      count: test.requests.length,
      completed: test.requests.filter((request) => request.completed).length,
      aborted: test.requests.filter((request) => request.aborted).length,
      search: test.requests.filter((request) => request.search).length,
      maximumFixtureRows: Math.max(0, ...test.requests.map((request) => request.rows || 0)),
    };
    check('errors.no-page-errors', test.errors.page === 0, 0, test.errors.page);
    check('errors.no-unexpected-console', test.errors.unexpectedConsole === 0, 0, test.errors.unexpectedConsole);
    check('errors.blocked-transport-accounting', test.errors.console === test.errors.blockedTransport + test.errors.unexpectedConsole, 'console = blockedTransport + unexpectedConsole', test.errors);
  } finally {
    if (!screenshot && !test.page.isClosed()) {
      try {
        screenshot = await test.page.screenshot({ type: 'png', animations: 'disabled' });
      } catch {
        // The bounded JSON failure remains the primary diagnostic if capture is unavailable.
      }
    }
    result.observations.errors ||= { ...test.errors };
    result.observations.requestSummary ||= {
      count: test.requests.length,
      completed: test.requests.filter((request) => request.completed).length,
      aborted: test.requests.filter((request) => request.aborted).length,
      search: test.requests.filter((request) => request.search).length,
      maximumFixtureRows: Math.max(0, ...test.requests.map((request) => request.rows || 0)),
    };
    await test.context.close();
  }

  return screenshot;
}

let execution = null;
let screenshot = null;
let fatalError = null;

try {
  execution = await launch('candidate');
  const receiptBuild = execution.receipt.distDir?.match(/candidate-(v\d+)/)?.[1] || null;
  result.receipt = {
    buildId: execution.receipt.buildId ?? null,
    candidateBuild: receiptBuild,
    planSha256: execution.receipt.planSha256 ?? null,
    patchSha256: execution.receipt.patchSha256 ?? execution.receipt.patchSha ?? null,
  };
  result.browser = execution.browser.version();
  check('runtime.candidate-build-label', receiptBuild === CANDIDATE_BUILD, CANDIDATE_BUILD, receiptBuild);
  screenshot = await runFlow(execution);
} catch (error) {
  fatalError = error;
  result.failures.push({
    at: 'fatal',
    expected: 'flow completes',
    observed: bounded({
      name: error instanceof Error ? error.name : 'Error',
      message: error instanceof Error ? error.message : String(error),
    }),
  });
} finally {
  if (execution) {
    try {
      await execution.close();
    } catch (error) {
      fatalError ||= error;
      if (result.failures.length < MAX_FAILURES) {
        result.failures.push({
          at: 'runtime.close',
          expected: 'browser and server close cleanly',
          observed: bounded(error instanceof Error ? error.message : String(error)),
        });
      }
    }
  }
}

result.status = !fatalError && result.failures.length === 0 ? 'passed' : 'failed';
await writeFile(new URL('raw.json', OUTPUT_ROOT), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
if (screenshot) {
  await writeFile(new URL('final.png', OUTPUT_ROOT), screenshot, { flag: 'wx' });
}

console.log(JSON.stringify({
  status: result.status,
  build: result.scope.build,
  checks: result.checks,
  failures: result.failures.length,
  swipes: result.observations.swipes.length,
  output: 'native-touch-final-v2',
}));

if (result.status !== 'passed') process.exitCode = 1;
