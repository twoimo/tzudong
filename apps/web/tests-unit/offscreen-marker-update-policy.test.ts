import { test, expect } from 'bun:test';
import { Transpiler } from 'bun';
import { readFileSync } from 'node:fs';
import { shouldRenderExpandedClusterMarker } from '../lib/naver-map-render-plan';
import type { Restaurant } from '../types/restaurant';

const source = readFileSync(new URL('../components/map/NaverMapView.tsx', import.meta.url), 'utf8');
const start = source.indexOf('const inInitialViewport = shouldRenderExpandedClusterMarker(');
const end = source.indexOf('\n            });', start);
const js = new Transpiler({ loader: 'tsx' }).transformSync(`function run() { ${source.slice(start, end)} }`);
const bounds = { south: 37.5, north: 37.6, west: 126.9, east: 127.0 };

test.each([
    { name: 'new offscreen', lat: 35, old: null, selected: false, defer: true },
    { name: 'existing offscreen', lat: 35, old: 35, selected: false, defer: true },
    { name: 'new visible', lat: 37.55, old: null, selected: false, defer: false },
    { name: 'selected offscreen', lat: 35, old: 35, selected: true, defer: false },
    { name: 'data moves a previously visible marker offscreen', lat: 35, old: 37.55, selected: false, defer: false },
])('$name keeps current visible data immediate and slices the offscreen tail', row => {
    const jobs: Array<() => void> = [];
    let rendered = 0;
    const bindings = {
        restaurant: { id: 'synthetic', lat: row.lat, lng: 126.95 } as Restaurant,
        markerVisibleSelectedRestaurant: row.selected ? { id: 'synthetic' } : null,
        markerVisibleActiveSearchedRestaurant: null,
        shouldRenderExpandedClusterMarker,
        extendedBounds: bounds,
        VIEWPORT_FILTER_ENABLED: true,
        retainSmallExpandedDesktop: true,
        markerPool: { get: () => row.old === null ? undefined : { getPosition: () => ({ lat: () => row.old, lng: () => 126.95 }) } },
        deferredMarkerRenders: jobs,
        render: () => rendered++,
    };
    new Function(...Object.keys(bindings), `${js}\nreturn run();`)(...Object.values(bindings));
    expect(jobs.length).toBe(row.defer ? 1 : 0);
    expect(rendered).toBe(row.defer ? 0 : 1);
    if (row.defer) { jobs[0](); expect(rendered).toBe(1); }
});
