/* global Bun */
import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const root = join(import.meta.dir, '..');
// Match the project's pinned Playwright browser rather than the user's app.
const executablePath = chromium.executablePath();

// Import the real pool and markup. Only the provider is substituted; HTML is
// parsed and compared by Chromium, not by a copy of the production patcher.
const entry = `
import { markerPool } from './lib/marker-pool';
import { syncRetainedMarkerAccessibility } from './lib/retained-marker-accessibility';
import { wrapMarkerWithPopularityTier } from './lib/evidence-engineering/popularity-marker';
import { wrapNaverMarkerContentWithReviewBubble } from './lib/visible-marker-review-bubbles';
const map = document.body.appendChild(document.createElement('main'));
let clicks = [];
let cloneIcons = false;
let deferIcons = false;
class Marker {
  constructor({position, icon, map: target}) {
    this.position = position; this.icon = icon; this.map = target;
    this.element = document.createElement('div'); this.element.innerHTML = icon.content;
    target.append(this.element); this.iconChanges = 0;
  }
  getMap() { return this.map; }
  setMap(target) { if (this.failDetach && target === null) throw Error('provider unavailable');
    this.map = target; this.element.remove(); target?.append(this.element); }
  getPosition() { return this.position; }
  setPosition(position) { this.position = position; }
  getIcon() { return cloneIcons ? {...this.icon} : this.icon; }
  setIcon(icon) {
    this.icon = icon; this.iconChanges++;
    if (deferIcons) {
      this.element.remove();
      queueMicrotask(() => {
        this.element = document.createElement('div'); this.element.innerHTML = icon.content;
        this.map?.append(this.element);
      });
    } else this.element.innerHTML = icon.content;
  }
  getElement() { return this.element; }
  setZIndex() {}
}
window.naver = { maps: { Marker, Event: {
  addListener(marker, event, callback) { marker.providerClick = callback; return marker; },
  removeListener(marker) { marker.providerClick = undefined; },
} } };
const position = { equals: other => other === position };
const tiers = ['standard', 'rainbow', 'ember', 'fire'];
const variants = tiers.flatMap(tier => [0, 1].flatMap(alt => [1, 2].flatMap(visits => [0, 1, 2].map(bubble => ({tier, alt, visits, bubble})))));
let reuseBubbleIdentity = false;
const mutableBubbles = new Map();
const reviewContent = value => value.bubble === 1 ? '처음 리뷰' : '갱신 리뷰';
function html(id, value) {
  const content = wrapMarkerWithPopularityTier('<div data-testid="marker" data-restaurant-id="' + id + '" style="width:32px" role="button" tabindex="0" aria-label="식당">'
    + '<span data-tzuyang-visit-count-badge="true">' + value.visits + '</span><img src="/same.webp" alt="설명 ' + value.alt + '"></div>', value.tier);
  let bubble = value.bubble ? {
    restaurantId: id, reviewId: 'review-' + value.bubble, userName: '검증 사용자', content: reviewContent(value), photoUrl: value.bubble === 2 ? 'https://example.com/p.webp' : null,
  } : undefined;
  if (bubble && reuseBubbleIdentity) {
    const previous = mutableBubbles.get(id);
    if (previous) { Object.assign(previous, bubble); bubble = previous; }
    else mutableBubbles.set(id, bubble);
  }
  return wrapNaverMarkerContentWithReviewBubble(content, bubble, false);
}
function acquire(id, value) {
  return markerPool.acquire(id, position, {content: html(id, value), anchor: {x: 1, y: 1}}, map, () => clicks.push(id + ':' + value.tier));
}
function view(marker, requested) {
  const element = marker.getElement();
  return { tier: element.querySelector('[data-popularity-tier]')?.getAttribute('data-popularity-tier'),
    flames: element.querySelectorAll('svg.tz-popularity-flame').length,
    alt: element.querySelector('[data-testid="marker"] img')?.getAttribute('alt'),
    visits: element.querySelector('[data-tzuyang-visit-count-badge]')?.textContent,
    bubbles: element.querySelectorAll('[data-visible-marker-review-bubble]').length,
    currentReview: !requested.bubble || Boolean(element.querySelector('[data-visible-marker-review-bubble]')?.textContent.includes(reviewContent(requested))) };
}
window.__formal = {
  visualPairs() {
    let checked = 0;
    for (const before of variants) for (const after of variants) for (const released of [false, true]) for (const sameBubbleIdentity of [false, true]) {
      reuseBubbleIdentity = sameBubbleIdentity; mutableBubbles.clear();
      markerPool.clear();
      const marker = acquire('a', before);
      if (released) markerPool.release('a');
      const next = acquire('a', after); const actual = view(next, after);
      const expected = {tier: after.tier, flames: after.tier === 'standard' ? 0 : 1,
        alt: '설명 ' + after.alt, visits: String(after.visits), bubbles: after.bubble ? 1 : 0, currentReview: true};
      checked++;
      if (next !== marker || JSON.stringify(actual) !== JSON.stringify(expected)) return {checked, before, after, released, sameBubbleIdentity, actual, expected};
    }
    markerPool.clear(); return {checked};
  },
  bubbleIdentity() {
    markerPool.clear(); const marker = acquire('a', {...variants[0], bubble: 1});
    const image = marker.getElement().querySelector('[data-testid="marker"] img');
    const changes = marker.iconChanges;
    const after = {...variants[0], bubble: 2};
    acquire('a', after);
    const retained = image === marker.getElement().querySelector('[data-testid="marker"] img');
    const result = {retained, iconChanges: marker.iconChanges - changes, ...view(marker, after)};
    markerPool.clear(); return result;
  },
  reviewBoundaries() {
    markerPool.clear(); reuseBubbleIdentity = false; cloneIcons = true;
    const first = {...variants[0], bubble: 1};
    const second = {...variants[0], bubble: 2};
    const marker = acquire('a', first);
    syncRetainedMarkerAccessibility(marker, false, map);
    marker.getElement().querySelector('[data-visible-marker-review-bubble]').style.marginLeft = '23px';
    acquire('a', second);
    const root = marker.getElement().querySelector('[data-visible-marker-review-bubble-anchor]');
    const hiddenAfterPatch = root?.getAttribute('aria-hidden');
    const clampAfterPatch = marker.getElement().querySelector('[data-visible-marker-review-bubble]').style.marginLeft;
    const photoAfterPatch = marker.getElement().querySelector('[data-visible-marker-review-bubble] img')?.getAttribute('src');
    acquire('a', first);
    const reverted = view(marker, first).currentReview;
    markerPool.update('a', {icon: {content: html('a', second), anchor: {x: 18, y: 18}}});
    const hiddenAfterReplacement = marker.getElement().querySelector('[data-visible-marker-review-bubble-anchor]')?.getAttribute('aria-hidden');
    const anchor = marker.getIcon().anchor;
    marker.failDetach = true; markerPool.release('a');
    const evicted = markerPool.getStats().poolSize === 0 && marker.providerClick === undefined;
    cloneIcons = false; markerPool.clear();
    return {hiddenAfterPatch, clampAfterPatch, photoAfterPatch, reverted, hiddenAfterReplacement, anchor, evicted};
  },
  async delayedRootMask() {
    markerPool.clear(); cloneIcons = false; reuseBubbleIdentity = false;
    const marker = acquire('delayed', {...variants[0], bubble: 1});
    syncRetainedMarkerAccessibility(marker, false, map);
    deferIcons = true;
    markerPool.update('delayed', {icon: {content: html('delayed', {...variants[0], bubble: 2, alt: 1}), anchor: {x: 18, y: 18}}});
    deferIcons = false;
    await Promise.resolve(); await Promise.resolve();
    const root = marker.getElement().querySelector('[data-visible-marker-review-bubble-anchor]');
    const result = {connected: root?.isConnected, hidden: root?.getAttribute('aria-hidden'), owner: root?.getAttribute('data-tzudong-retained-marker-hidden')};
    markerPool.clear(); return result;
  },
  clusterReacquisition() {
    markerPool.clear();
    const icon = (frame, count) => ({content: '<div data-testid="marker" data-restaurant-id="cluster" role="button" tabindex="0" aria-label="cluster"><picture><source srcset="/' + frame + '.webp"><img src="/fallback.webp"></picture><b>' + count + '</b></div>', anchor: {x: 14, y: 14}});
    const marker = markerPool.acquire('cluster', position, icon('a', 2), map);
    markerPool.update('cluster', {icon: icon('b', 3)});
    markerPool.acquire('cluster', position, icon('a', 4), map);
    const result = {srcset: marker.getElement().querySelector('source').getAttribute('srcset'), count: marker.getElement().querySelector('b').textContent};
    markerPool.clear(); return result;
  },
  ownershipTraces() {
    const actions = ['a:fire', 'a:standard', 'b:ember', 'release:a', 'release:b', 'click:a', 'click:b', 'clear'];
    let checked = 0;
    function replay(trace) {
      markerPool.clear(); clicks = []; const active = new Map(); const handles = new Map();
      for (const action of trace) {
        const [id, tier] = action.split(':');
        if (id === 'release') { markerPool.release(tier); active.delete(tier); }
        else if (id === 'clear') { markerPool.clear(); active.clear(); }
        else if (id === 'click') {
          const before = clicks.length; handles.get(tier)?.providerClick?.();
          // A recycled provider handle now belongs to its current restaurant.
          // Clicking that object is not an event for its former restaurant ID.
          const owner = [...active.keys()].find(id => handles.get(id) === handles.get(tier));
          const expected = owner && active.get(owner);
          if (clicks.length !== before + (expected ? 1 : 0) || (expected && clicks.at(-1) !== owner + ':' + expected)) return {trace, action, clicks, expected};
        } else {
          const marker = acquire(id, {...variants[0], tier}); handles.set(id, marker); active.set(id, tier);
        }
        if (markerPool.getStats().activeCount !== active.size) return {trace, action, activeCount: markerPool.getStats().activeCount, expected: active.size};
        checked++;
      }
      return null;
    }
    function visit(trace) {
      const failure = replay(trace); if (failure) return failure;
      if (trace.length === 4) return null;
      for (const action of actions) { const failure = visit([...trace, action]); if (failure) return failure; }
      return null;
    }
    const failure = visit([]); markerPool.clear(); return {checked, failure};
  },
};
`;

let bundle;
let reportedBrowser = false;
async function withFixture(run) {
  if (!existsSync(executablePath)) throw new Error('FORMAL_BROWSER_REQUIRED: install the project Playwright Chromium or Google Chrome');
  bundle ??= (async () => {
    const build = await Bun.build({ entrypoints: ['marker-formal-fixture'], target: 'browser', format: 'iife', write: false,
      plugins: [{ name: 'marker-formal', setup(builder) {
        builder.onResolve({ filter: /^marker-formal-fixture$/ }, () => ({ path: 'entry', namespace: 'formal' }));
        builder.onLoad({ filter: /.*/, namespace: 'formal' }, () => ({ contents: entry, loader: 'ts', resolveDir: root }));
        builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync('./' + args.path.slice(2), root) }));
      } }],
    });
    if (!build.success) throw new Error(build.logs.map(String).join('\n'));
    return build.outputs[0].text();
  })();
  const browser = await chromium.launch({ executablePath, headless: true });
  if (!reportedBrowser) { console.log('FORMAL_BROWSER', browser.version()); reportedBrowser = true; }
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.request().url() === 'https://marker-formal.test/'
      ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }) : route.abort());
    await page.goto('https://marker-formal.test/');
    await page.addScriptTag({ content: await bundle });
    await run(page);
  } finally { await browser.close(); }
}

test('all 9,216 active/reacquired visual transitions show the current static marker and bubble', async () => {
  await withFixture(async page => {
    const result = await page.evaluate(() => window.__formal.visualPairs());
    expect(result).toEqual({ checked: 9216 });
    console.log('FORMAL_VISUAL_TRANSITIONS', result.checked);
  });
}, 60000);

test('a review-only transition retains the image and avoids an SDK icon replacement', async () => {
  await withFixture(async page => {
    expect(await page.evaluate(() => window.__formal.bubbleIdentity()))
      .toMatchObject({ retained: true, iconChanges: 0, bubbles: 1 });
  });
}, 60000);

test('every pool/click action sequence through depth four keeps current callback ownership', async () => {
  await withFixture(async page => {
    const result = await page.evaluate(() => window.__formal.ownershipTraces());
    expect(result.failure).toBeNull();
    expect(result.checked).toBe(18056);
    console.log('FORMAL_OWNERSHIP_STEPS', result.checked);
  });
}, 60000);

test('review patches preserve retained masking, clamp and clone-descriptor round trips', async () => {
  await withFixture(async page => {
    expect(await page.evaluate(() => window.__formal.reviewBoundaries())).toEqual({
      hiddenAfterPatch: 'true', clampAfterPatch: '23px', photoAfterPatch: 'https://example.com/p.webp',
      reverted: true, hiddenAfterReplacement: 'true', anchor: {x: 18, y: 18}, evicted: true,
    });
  });
}, 60000);

test('cluster frames updated through the pool restore the requested frame and count', async () => {
  await withFixture(async page => {
    expect(await page.evaluate(() => window.__formal.clusterReacquisition())).toEqual({srcset: '/a.webp', count: '4'});
  });
}, 60000);

test('a deferred SDK root receives the retained mask after disconnected-root replacement', async () => {
  await withFixture(async page => {
    expect(await page.evaluate(() => window.__formal.delayedRootMask())).toEqual({connected: true, hidden: 'true', owner: 'true'});
  });
}, 60000);
