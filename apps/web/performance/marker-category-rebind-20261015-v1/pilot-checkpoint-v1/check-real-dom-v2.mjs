import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const root = '/Users/twoimo/.codex/worktrees/mobile-nav-read-20261012/tzudong/apps/web';
const cache = '/Users/twoimo/.codex/runtime-cache/marker-category-real-dom-20261015-v2';
await mkdir(cache);
const entry = `${cache}/entry.ts`, bundle = `${cache}/entry.js`;
await writeFile(entry, `import { markerPool } from '${root}/lib/marker-pool.ts';\nimport { getNaverIndividualMarkerVisual } from '${root}/lib/naver-map-marker-visuals.ts';\nwindow.__markerTest = { markerPool, visual: getNaverIndividualMarkerVisual };\n`, { flag: 'wx' });
execFileSync('/Users/twoimo/.bun/bin/bun', ['build', entry, '--target=browser', '--format=iife', `--outfile=${bundle}`], { cwd: root, stdio: 'pipe' });
const { chromium } = createRequire(`${root}/package.json`)('@playwright/test');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const result = { sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), browser: await browser.version(), realBrowserDom: true, actualNaverSdk: false, performanceAdmission: 0, startedAtUtc: new Date().toISOString() };
try {
  const page = await browser.newPage();
  await page.setContent('<main></main>');
  await page.evaluate(() => {
    window.__listeners = { added: 0, removed: 0 };
    class Marker {
      constructor({ map, position, icon }) {
        Object.assign(this, { map, position, icon, setIconCalls: 0 });
        this.element = document.createElement('div');
        this.element.innerHTML = icon.content;
        this.element.addEventListener('click', event => this.listener?.(event));
        document.querySelector('main').append(this.element);
      }
      getMap() { return this.map; }
      setMap(map) { this.map = map; if (map) document.querySelector('main').append(this.element); else this.element.remove(); }
      getPosition() { return this.position; }
      setPosition(position) { this.position = position; }
      getIcon() { return this.icon; }
      setIcon(icon) { this.icon = icon; this.element.innerHTML = icon.content; this.setIconCalls++; }
      getElement() { return this.element; }
      setZIndex() {}
    }
    window.naver = { maps: { Marker, Event: {
      addListener(marker, type, listener) { if (type !== 'click') throw Error('unexpected_event'); marker.listener = listener; window.__listeners.added++; return { marker }; },
      removeListener({ marker }) { marker.listener = undefined; window.__listeners.removed++; },
    } } };
  });
  await page.addScriptTag({ path: bundle });
  result.cases = await page.evaluate(() => {
    const { markerPool: pool, visual } = window.__markerTest;
    const oldId = '00000000-0000-4000-8000-000000000001', newId = '00000000-0000-4000-8000-000000000002';
    const base = id => visual({ id, categories: ['한식'] }, false);
    const overlay = content => `<div data-visible-marker-review-bubble-anchor="true"><span data-visible-marker-review-bubble="true">2</span>${content}</div>`;
    const cases = [
      { name: 'category', replace: false },
      { name: 'category-overlay', overlay: true, replace: false },
      { name: 'visit-count', next: id => visual({ id, categories: ['한식'], mergedYoutubeLinks: ['https://youtu.be/one', 'https://youtu.be/two'] }, false), replace: true },
      { name: 'category-changed', next: id => visual({ id, categories: ['분식'] }, false), replace: true },
      { name: 'selected-anchor', next: id => visual({ id, categories: ['한식'] }, true), replace: true },
      { name: 'asset-version', edit: s => s.replace('restaurant-marker-assets-', 'changed-assets-'), replace: true },
      { name: 'source-changed', edit: s => s.replace('.webp', '-updated.webp'), replace: true },
      { name: 'aria-changed', edit: s => s.replace('data-testid="marker"', 'aria-label="다른 식당" data-testid="marker"'), replace: true },
      { name: 'wrapper-mutation', mutate: el => el.querySelector('[data-restaurant-marker-kind]').setAttribute('data-external', 'changed'), replace: true },
      { name: 'picture-mutation', mutate: el => el.querySelector('source').setAttribute('srcset', '/changed.webp'), replace: true },
      { name: 'style-mutation', mutate: el => el.querySelector('[data-testid="marker"]').style.width = '60px', replace: true },
      { name: 'alt-mutation', mutate: el => el.querySelector('img').alt = '외부 변경', replace: true },
      { name: 'overlay-mutation', overlay: true, mutate: el => el.querySelector('[data-visible-marker-review-bubble="true"]').textContent = '99', replace: true },
      ...['user-submitted', 'trend', 'seasonal'].map(kind => ({ name: kind, both: id => visual({ id, categories: ['한식'], ...(kind === 'user-submitted' ? { source_type: 'user_submission_new' } : {}) }, false, kind === 'user-submitted' ? [] : [kind]), replace: true })),
    ];
    return cases.map(scenario => {
      pool.clear(); document.querySelector('main').replaceChildren();
      const before = (scenario.both ?? base)(oldId), after = (scenario.next ?? scenario.both ?? base)(newId);
      const oldIcon = { ...before, content: scenario.overlay ? overlay(before.content) : before.content };
      const nextIcon = { ...after, content: scenario.edit ? scenario.edit(after.content) : scenario.overlay ? overlay(after.content) : after.content };
      const clicks = [], listenerStart = window.__listeners.added;
      const marker = pool.acquire(oldId, { equals: () => false }, oldIcon, 'map', () => clicks.push('old'));
      const oldImage = marker.getElement().querySelector('img');
      scenario.mutate?.(marker.getElement());
      pool.release(oldId); marker.getElement().click();
      if (clicks.length) throw Error('stale_click_after_release');
      const next = pool.acquire(newId, { equals: () => false }, nextIcon, 'map', () => clicks.push('new'));
      const template = document.createElement('template'); template.innerHTML = nextIcon.content;
      if (next !== marker || marker.setIconCalls !== Number(scenario.replace)) throw Error('replacement_contract_' + scenario.name);
      if (marker.getElement().innerHTML !== template.innerHTML) throw Error('dom_contract_' + scenario.name);
      if (!scenario.replace && marker.getElement().querySelector('img') !== oldImage) throw Error('image_identity_lost');
      marker.getElement().querySelector('[data-testid="marker"]').click();
      if (clicks.join(',') !== 'new' || window.__listeners.added !== listenerStart + 1) throw Error('current_click_contract');
      pool.release(newId); marker.getElement().click();
      if (clicks.length !== 1 || pool.has(oldId)) throw Error('release_contract');
      pool.clear();
      return { name: scenario.name, passed: true, sdkSetIconCalls: marker.setIconCalls, reusedImage: !scenario.replace };
    });
  });
  assert.equal(result.cases.length, 16);
  result.listeners = await page.evaluate(() => window.__listeners);
  assert.equal(result.listeners.added, result.listeners.removed);
  result.passed = true;
} catch (error) {
  result.passed = false;
  result.failure = 'synthetic_dom_contract_failure';
  result.syntheticOnlyMessage = String(error?.message ?? '').slice(0, 500);
} finally { await browser.close(); }
result.bundleSha256 = createHash('sha256').update(await readFile(bundle)).digest('hex');
result.endedAtUtc = new Date().toISOString();
await writeFile(new URL('real-dom-check-v2.json', import.meta.url), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(result));
if (!result.passed) process.exitCode = 1;
