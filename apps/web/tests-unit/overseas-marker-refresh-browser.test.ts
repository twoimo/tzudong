import { chromeForTestingExecutable } from './fixtures/chrome-for-testing';
import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect as ui } from '@playwright/test';

const appRoot = join(import.meta.dir, '..');
const chrome = chromium.executablePath();

async function fixtureBundle() {
  const entry = `
    import React, { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import OverseasMap from './components/map/OverseasMap';
    const initial = { id: 'refresh-marker', name: '처음 식당', lat: 35, lng: 139, categories: ['한식'], popularity_tier: 'fire' };
    globalThis.__rows = [initial]; globalThis.__sdk = { creations: 0, additions: 0, visibleIds: [], jumps: [], clicks: [] };
    function App() {
      const [version, update] = useState(0);
      globalThis.__refresh = patch => { globalThis.__rows = [{ ...globalThis.__rows[0], ...patch }]; update(v => v + 1); };
      return <OverseasMap filters={{ categories: [], minRating: 0, minReviews: 0, minUserVisits: 0, minJjyangVisits: 0 }} selectedCountry={null} searchedRestaurant={null}
        selectedRestaurant={globalThis.__rows[0]} refreshTrigger={version} mapFocusZoom={12 + version}
        onMapReady={move => { globalThis.__externalMove = move; }}
        onVisibleRestaurantsChange={rows => { globalThis.__sdk.visibleIds = rows.map(row => row.id); }}
        onRestaurantSelect={row => globalThis.__sdk.clicks.push({ kind: 'select', name: row.name, version })}
        onMarkerClick={row => globalThis.__sdk.clicks.push({ kind: 'marker', name: row.name, version })} />;
    }
    createRoot(document.body.appendChild(document.createElement('div'))).render(<App />);
  `;
  const sdk = `
    export const setWorkerUrl = () => {};
    export class AttributionControl {}
    export class Map {
      constructor(options) { this.container = options.container; }
      on(event, callback) { if (event === 'load') setTimeout(callback, 0); return this; }
      addControl() {} resize() {} remove() {} getZoom() { return 5; }
      jumpTo(value) { globalThis.__sdk.jumps.push(value); } easeTo() {}
    }
    export class Marker {
      constructor({element}) { this.element = element; globalThis.__sdk.creations++; }
      getElement() { return this.element; }
      setLngLat(value) { this.element.dataset.coordinates = JSON.stringify(value); return this; }
      addTo(map) { globalThis.__sdk.additions++; map.container.append(this.element); return this; }
      remove() { this.element.remove(); }
    }
  `;
  const result = await Bun.build({ entrypoints: ['overseas-refresh-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"', 'process.env.NEXT_PUBLIC_MAPLIBRE_WORKER_URL': '""' }, plugins: [{ name: 'overseas-refresh', setup(builder) {
      builder.onResolve({ filter: /^overseas-refresh-fixture$/ }, () => ({ path: 'entry', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: appRoot }));
      builder.onResolve({ filter: /^maplibre-gl$/ }, () => ({ path: 'sdk', namespace: 'stub' }));
      builder.onResolve({ filter: /hooks\/use-restaurants$/ }, () => ({ path: 'rows', namespace: 'stub' }));
      builder.onResolve({ filter: /\.css$/ }, () => ({ path: 'css', namespace: 'stub' }));
      builder.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ loader: 'ts', contents: args.path === 'sdk' ? sdk
        : args.path === 'rows' ? 'export const useRestaurants = () => ({ data: globalThis.__rows, isLoading: false });' : '' }));
      builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync('./' + args.path.slice(2), appRoot) }));
    }}] });
  expect(result.success).toBe(true);
  return result.outputs[0].text();
}

(existsSync(chrome) ? test : test.skip)('retained overseas markers refresh content, location and click data without recreating or losing selection', async () => {
  const browser = await chromium.launch({ executablePath: chromeForTestingExecutable(), headless: true });
  try {
    const script = await fixtureBundle();
    for (const width of [390, 820, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 950 } });
      try {
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', route => route.request().url().startsWith('https://marker-refresh.test/')
          ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }) : route.abort());
        await page.goto('https://marker-refresh.test/'); await page.addScriptTag({ content: script });
        const marker = page.locator('#marker-refresh-marker');
        try { await ui(marker.locator('img')).toHaveAttribute('alt', '처음 식당'); }
        catch (error) { throw new Error(JSON.stringify({ errors, body: await page.locator('body').innerText() }), { cause: error }); }
        await marker.evaluate(element => { (window as unknown as { __retained: Element }).__retained = element; });
        await page.evaluate(() => (window as unknown as { __refresh: (row: object) => void }).__refresh({ name: '최신 식당', categories: ['고기'], lat: 36, lng: 140 }));
        await ui(marker.locator('img')).toHaveAttribute('alt', '최신 식당');
        await ui(marker.locator('img')).toHaveAttribute('src', /meat_bbq/);
        await ui(marker).toHaveAttribute('data-coordinates', '[140,36]');
        await ui(marker).toHaveClass(/selected/);
        await marker.click();
        expect(await page.evaluate(() => (window as unknown as { __sdk: unknown }).__sdk)).toMatchObject({
          creations: 1, additions: 1, visibleIds: ['refresh-marker'], clicks: [{ kind: 'select', name: '최신 식당', version: 1 }, { kind: 'marker', name: '최신 식당', version: 1 }],
        });
        await marker.locator('img').evaluate(element => { (window as unknown as { __image: Element }).__image = element; });
        await page.evaluate(() => (window as unknown as { __refresh: (row: object) => void }).__refresh({}));
        await ui(marker).toHaveAttribute('data-coordinates', '[140,36]');
        expect(await marker.locator('img').evaluate(element => element === (window as unknown as { __image: Element }).__image)).toBe(true);
        await page.evaluate(() => (window as unknown as { __refresh: (row: object) => void }).__refresh({ popularity_tier: 'rainbow' }));
        await ui(marker.locator('[data-popularity-tier]')).toHaveAttribute('data-popularity-tier', 'rainbow');
        await ui(marker).toHaveClass(/selected/);
        expect(await marker.evaluate(element => element === (window as unknown as { __retained: Element }).__retained)).toBe(true);
        await marker.click();
        const state = await page.evaluate(() => (window as unknown as { __sdk: { creations: number; clicks: unknown[]; jumps: { center: number[]; zoom: number }[] } }).__sdk);
        expect(state.creations).toBe(1); expect(state.clicks).toHaveLength(4);
        expect(state.jumps.at(-1)).toMatchObject({ center: [140, 36], zoom: 15 });
        const beforeInvalidMoves = state.jumps.length;
        await page.evaluate(() => {
          const fixture = window as unknown as { __externalMove: (row: object) => void };
          for (const coordinates of [{ lat: null, lng: null }, { lat: 0, lng: 0 }, { lat: 91, lng: 140 },
            { lat: 35, lng: 181 }, { lat: '', lng: ' ' }, { lat: Number.NaN, lng: 140 }]) {
            fixture.__externalMove({ id: 'external-invalid', ...coordinates });
          }
        });
        expect(await page.evaluate(() => (window as unknown as { __sdk: { jumps: unknown[] } }).__sdk.jumps.length)).toBe(beforeInvalidMoves);
        await page.evaluate(() => (window as unknown as { __externalMove: (row: object) => void }).__externalMove({ id: 'external-valid', lat: 37, lng: 126 }));
        expect(await page.evaluate(() => (window as unknown as { __sdk: { jumps: object[] } }).__sdk.jumps.at(-1))).toMatchObject({ center: [126, 37], zoom: 15 });
        await page.evaluate(() => (window as unknown as { __refresh: (row: object) => void }).__refresh({ lat: 0, lng: 0 }));
        await ui(marker).toHaveCount(0);
        expect(await page.evaluate(() => (window as unknown as { __sdk: { visibleIds: string[]; additions: number } }).__sdk)).toMatchObject({ visibleIds: [], additions: 1 });
        expect(errors).toEqual([]);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
}, 60000);
