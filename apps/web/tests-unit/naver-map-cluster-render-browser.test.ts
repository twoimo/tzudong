import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect as browserExpect, type Browser, type Page } from '@playwright/test';
import { chromeForTestingExecutable } from './fixtures/chrome-for-testing';

const app = join(import.meta.dir, '..');
const chrome = chromeForTestingExecutable();
const browserTest = existsSync(chrome) ? test : test.skip;
const ui = browserExpect.configure({ timeout: 10_000 });

type FixtureRestaurant = { id: string; name: string; lat: number; lng: number; categories: string[]; road_address: string };
type ContextualPayload = { renderMode: string; zoom: number; ids: string[] };
type ClusterIO = { markerClicks: string[]; contextual: ContextualPayload[]; reviewReads: number };

const busan: FixtureRestaurant[] = [
    { id: 'busan-a', name: '합성 해운대 A', lat: 35.1587, lng: 129.1604, categories: ['한식'], road_address: '부산광역시 해운대구 합성로 1' },
    { id: 'busan-b', name: '합성 해운대 B', lat: 35.1592, lng: 129.1621, categories: ['일식'], road_address: '부산광역시 해운대구 합성로 2' },
    { id: 'busan-c', name: '합성 해운대 C', lat: 35.1579, lng: 129.1589, categories: ['중식'], road_address: '부산광역시 해운대구 합성로 3' },
    { id: 'busan-d', name: '합성 해운대 D', lat: 35.1601, lng: 129.1597, categories: ['양식'], road_address: '부산광역시 해운대구 합성로 4' },
    { id: 'busan-e', name: '합성 해운대 E', lat: 35.1574, lng: 129.1615, categories: ['분식'], road_address: '부산광역시 해운대구 합성로 5' },
];
const daegu: FixtureRestaurant = { id: 'daegu-a', name: '합성 대구 A', lat: 35.8714, lng: 128.6014, categories: ['한식'], road_address: '대구광역시 중구 합성로 4' };
const fixtureRestaurants = [...busan, daegu];
// Five points 0.005 degrees apart span 0.02 degrees: inside one 40px cluster radius at index zoom 10, wider than it at index zoom 12.
const daejeon: FixtureRestaurant[] = ['A', 'B', 'C', 'D', 'E'].map((letter, index) => ({
    id: `daejeon-${letter.toLowerCase()}`, name: `합성 대전 ${letter}`, lat: 36.35, lng: 127.38 + index * 0.005,
    categories: ['한식'], road_address: `대전광역시 서구 합성로 ${index + 1}`,
}));

const entry = `
import React, {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {AnonymousHomeAuthProvider} from './contexts/AuthContextBase';
import {LayoutProvider} from './contexts/LayoutContext';
import NaverMapView from './components/map/NaverMapView';
const io=globalThis.__clusterIO={markerClicks:[],contextual:[],reviewReads:0};
const store=globalThis.__restaurantStore;
const filters={categories:[],minRating:0,minReviews:0,minUserVisits:0,minJjyangVisits:0,featuredTheme:null};
const client=new QueryClient();
function Fixture(){
  const [selectedId,setSelectedId]=useState(null);
  const [restaurants,setRestaurants]=useState(store.get());
  useEffect(()=>store.subscribe(()=>setRestaurants(store.get())),[]);
  useEffect(()=>{globalThis.__selectRestaurant=setSelectedId;},[]);
  useEffect(()=>{globalThis.__committedSelectedId=selectedId;},[selectedId]);
  const selected=restaurants.find(r=>r.id===selectedId)??null;
  return <NaverMapView filters={filters} selectedRegion={null} searchedRestaurant={null} selectedRestaurant={selected} refreshTrigger={0}
    onMarkerClick={r=>{io.markerClicks.push(r.id);setSelectedId(r.id);}}
    onContextualRestaurantsChange={p=>io.contextual.push({renderMode:p.renderMode,zoom:p.zoom,ids:p.restaurants.map(r=>r.id).sort()})}/>;
}
createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><AnonymousHomeAuthProvider><LayoutProvider><Fixture/></LayoutProvider></AnonymousHomeAuthProvider></QueryClientProvider>);
`;

const inert: Record<string, string> = {
    'next/navigation': `export const usePathname=()=>'/';export const useRouter=()=>({push(){},replace(){},refresh(){},prefetch(){}});export const useSearchParams=()=>new URLSearchParams(location.search);`,
    '@/hooks/use-naver-maps': `export const useNaverMaps=()=>({isLoaded:true,loadError:null,load(){}});`,
    '@/hooks/use-home-map-results': `import {useSyncExternalStore} from 'react';
      export function useHomeMapResults(){const store=globalThis.__restaurantStore;const restaurants=useSyncExternalStore(store.subscribe,store.get);
        return {data:restaurants,isFetching:false,isLoading:false,refetch:async()=>({}),summary:{active:false,status:'ready',restaurants,count:restaurants.length,regionCounts:{},countryCounts:{},categoryCounts:{}}};}`,
    '@/lib/supabase-rest-client': `export const postgrestIn=values=>'in.('+values.join(',')+')';
      export async function fetchSupabaseRows(){globalThis.__clusterIO.reviewReads++;return [];}
      export const supabaseRestRpcClient={rpc:async()=>({data:[],error:null})};`,
    '@/components/map/NaverMapAnnouncementRuntime': 'export default function NaverMapAnnouncementRuntime(){return null}',
    '@/components/map/NaverMapPresenceRuntime': 'export default function NaverMapPresenceRuntime(){return null}',
    '@/components/home/HydratedDetailRestaurant': 'export default function HydratedDetailRestaurant(){return null}',
};

const naverStub = readFileSync(join(app, 'public/__local/naver-maps.js'), 'utf8');
const captureMaps = 'window.__maps=[];{const Base=window.naver.maps.Map;window.naver.maps.Map=class extends Base{constructor(...args){super(...args);window.__maps.push(this);}};}';

let bundle: string;
let browser: Browser;

beforeAll(async () => {
    const output = await Bun.build({
        entrypoints: ['naver-map-cluster-render-fixture'], target: 'browser', format: 'iife', write: false,
        define: { 'process.env': JSON.stringify({ NODE_ENV: 'test' }) },
        plugins: [{ name: 'naver-map-cluster-render-fixture', setup(builder) {
            builder.onResolve({ filter: /^naver-map-cluster-render-fixture$/ }, () => ({ path: 'entry.tsx', namespace: 'fixture' }));
            builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: app }));
            builder.onResolve({ filter: /^next\/navigation$/ }, args => ({ path: args.path, namespace: 'inert' }));
            builder.onResolve({ filter: /^@\// }, args => inert[args.path]
                ? { path: args.path, namespace: 'inert' }
                : { path: Bun.resolveSync('./' + args.path.slice(2), app) });
            builder.onLoad({ filter: /.*/, namespace: 'inert' }, args => ({ contents: inert[args.path], loader: 'tsx', resolveDir: app }));
            builder.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'css' }));
        } }],
    });
    if (!output.success) throw new Error(output.logs.map(String).join('\n'));
    bundle = await output.outputs.find(file => file.path.endsWith('.js'))!.text();
    browser = await chromium.launch({ executablePath: chrome, headless: true });
});
afterAll(async () => { await browser?.close(); });

async function openMap(camera: { lat: number; lng: number; z: number }, restaurants = fixtureRestaurants) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'ko-KR' });
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'hardwareConcurrency', { value: 8 });
        Object.defineProperty(navigator, 'deviceMemory', { value: 8 });
    });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.request().resourceType() === 'document'
        ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><head><style>html,body,#root{margin:0;width:1440px;height:900px}[data-testid="map-container"]{width:1200px;height:800px}</style></head><body><div id="root"></div></body></html>' })
        : route.abort());
    await page.goto(`https://naver-map-cluster-render.test/?lat=${camera.lat}&lng=${camera.lng}&z=${camera.z}`);
    await page.evaluate(initial => {
        let list = initial;
        const listeners = new Set<() => void>();
        (globalThis as unknown as { __restaurantStore: unknown }).__restaurantStore = {
            get: () => list,
            subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
            set: (next: typeof initial) => { list = next; listeners.forEach(listener => listener()); },
        };
    }, restaurants);
    await page.addScriptTag({ content: naverStub });
    await page.addScriptTag({ content: captureMaps });
    await page.evaluate(() => {
        const frames: number[] = [];
        (window as unknown as { __markerCountFrames: number[] }).__markerCountFrames = frames;
        new MutationObserver(() => frames.push(document.querySelectorAll('button.tzudong-individual-marker').length))
            .observe(document.body, { childList: true, subtree: true });
    });
    await page.addScriptTag({ content: bundle });
    await ui(page.getByTestId('mock-naver-overlay')).toHaveCount(1);
    return { page, errors };
}

const marker = (page: Page, name: string) => page.getByRole('button', { name: `${name} 상세 보기`, exact: true });
const cluster = (page: Page, count: number) => page.getByRole('button', { name: `맛집 ${count}곳 모아보기, 지도 확대`, exact: true });
const anyCluster = (page: Page) => page.getByRole('button', { name: /모아보기, 지도 확대$/ });
const individualMarkers = (page: Page) => page.locator('[data-testid="mock-naver-overlay"] button.tzudong-individual-marker');
const markerWidth = (page: Page, name: string) => marker(page, name).evaluate(element => getComputedStyle(element).width);
const mapZoom = (page: Page) => page.evaluate(() => (window as unknown as { __maps: Array<{ getZoom(): number }> }).__maps.at(-1)!.getZoom());
const mapCenter = (page: Page) => page.evaluate(() => {
    const center = (window as unknown as { __maps: Array<{ getCenter(): { lat(): number; lng(): number } }> }).__maps.at(-1)!.getCenter();
    return { lat: center.lat(), lng: center.lng() };
});
const setMapZoom = (page: Page, zoom: number) => page.evaluate(value => {
    (window as unknown as { __maps: Array<{ setZoom(zoom: number): void }> }).__maps.at(-1)!.setZoom(value);
}, zoom);
const setRestaurants = (page: Page, restaurants: FixtureRestaurant[]) => page.evaluate(next => {
    (globalThis as unknown as { __restaurantStore: { set(next: unknown): void } }).__restaurantStore.set(next);
}, restaurants);
async function selectRestaurant(page: Page, id: string | null) {
    await page.evaluate(value => {
        (globalThis as unknown as { __selectRestaurant(id: string | null): void }).__selectRestaurant(value);
    }, id);
    await ui.poll(() => page.evaluate(() => (globalThis as unknown as { __committedSelectedId: string | null }).__committedSelectedId)).toBe(id);
}
const markerCountFrames = (page: Page) => page.evaluate(() =>
    (window as unknown as { __markerCountFrames: number[] }).__markerCountFrames);
const readIO = (page: Page) => page.evaluate(() => (globalThis as unknown as { __clusterIO: ClusterIO }).__clusterIO);
const lastContextual = async (page: Page) => (await readIO(page)).contextual.at(-1);

describe('NaverMapView cluster and marker rendering', () => {
    browserTest('a national zoom shows regional clusters and a street zoom shows one marker per restaurant', async () => {
        const { page, errors } = await openMap({ lat: 35.5, lng: 128.9, z: 7 });
        try {
            await ui(cluster(page, 5)).toHaveCount(1);
            await ui(cluster(page, 1)).toHaveCount(1);
            await ui(individualMarkers(page)).toHaveCount(0);
            expect(await lastContextual(page)).toEqual({ renderMode: 'regional-cluster', zoom: 7, ids: [] });

            await page.evaluate(() => {
                (window as unknown as { __maps: Array<{ setCenter(c: unknown): void }> }).__maps.at(-1)!
                    .setCenter(new window.naver.maps.LatLng(35.1587, 129.1604));
            });
            await setMapZoom(page, 16);
            for (const restaurant of busan) await ui(marker(page, restaurant.name)).toHaveCount(1);
            await ui(marker(page, daegu.name)).toHaveCount(0);
            await ui(anyCluster(page)).toHaveCount(0);
            await ui.poll(() => lastContextual(page)).toEqual({ renderMode: 'individual', zoom: 16, ids: busan.map(r => r.id).sort() });
            expect(errors).toEqual([]);
        } finally { await page.close(); }
    }, 60_000);

    browserTest('a regional cluster click expands its restaurants and zooms the camera to them', async () => {
        const { page, errors } = await openMap({ lat: 35.5, lng: 128.9, z: 7 });
        try {
            await ui(cluster(page, 5)).toHaveCount(1);
            await cluster(page, 5).click();
            for (const restaurant of busan) await ui(marker(page, restaurant.name)).toHaveCount(1);
            await ui(marker(page, daegu.name)).toHaveCount(0);
            expect(await mapZoom(page)).toBeGreaterThanOrEqual(14);
            const center = await mapCenter(page);
            expect(Math.abs(center.lat - 35.17)).toBeLessThan(0.2);
            expect(Math.abs(center.lng - 129.07)).toBeLessThan(0.2);
            await ui.poll(async () => (await lastContextual(page))?.renderMode).toBe('individual');
            expect((await lastContextual(page))?.ids).toEqual(busan.map(r => r.id).sort());
            expect((await readIO(page)).markerClicks).toEqual([]);
            expect(errors).toEqual([]);
        } finally { await page.close(); }
    }, 60_000);

    browserTest('a supercluster click outside Seoul expands the cluster and zooms past it', async () => {
        const { page, errors } = await openMap({ lat: 35.1587, lng: 129.1604, z: 11 });
        try {
            await ui(cluster(page, 5)).toHaveCount(1);
            await ui(individualMarkers(page)).toHaveCount(0);
            await cluster(page, 5).click();
            for (const restaurant of busan) await ui(marker(page, restaurant.name)).toHaveCount(1);
            await ui(anyCluster(page)).toHaveCount(0);
            expect(await mapZoom(page)).toBeGreaterThanOrEqual(14);

            await setMapZoom(page, 11);
            await ui.poll(async () => (await lastContextual(page))?.zoom).toBe(11);
            await ui(cluster(page, 5)).toHaveCount(0);
            for (const restaurant of busan) await ui(marker(page, restaurant.name)).toHaveCount(1);
            expect(errors).toEqual([]);
        } finally { await page.close(); }
    }, 60_000);

    browserTest('the selected restaurant marker is enlarged and follows a marker click', async () => {
        const { page, errors } = await openMap({ lat: 35.1587, lng: 129.1604, z: 16 });
        try {
            for (const restaurant of busan) await ui(marker(page, restaurant.name)).toHaveCount(1);
            expect(await markerWidth(page, busan[0].name)).toBe('32px');

            await selectRestaurant(page, busan[1].id);
            await ui.poll(() => markerWidth(page, busan[1].name)).toBe('42px');
            expect(await markerWidth(page, busan[0].name)).toBe('32px');
            expect(await markerWidth(page, busan[2].name)).toBe('32px');

            await marker(page, busan[0].name).click();
            await ui.poll(() => markerWidth(page, busan[0].name)).toBe('42px');
            await ui.poll(() => markerWidth(page, busan[1].name)).toBe('32px');
            expect((await readIO(page)).markerClicks).toEqual([busan[0].id]);
            expect(errors).toEqual([]);
        } finally { await page.close(); }
    }, 60_000);

    browserTest('a supercluster splits into markers at zoom 12 and regroups at zoom 11', async () => {
        const { page, errors } = await openMap({ lat: 36.35, lng: 127.39, z: 10 }, daejeon);
        try {
            await ui(cluster(page, 5)).toHaveCount(1);
            await ui(individualMarkers(page)).toHaveCount(0);
            expect((await markerCountFrames(page)).filter(count => count > 0)).toEqual([]);

            await setMapZoom(page, 12);
            for (const restaurant of daejeon) await ui(marker(page, restaurant.name)).toHaveCount(1);
            await ui(anyCluster(page)).toHaveCount(0);

            await setMapZoom(page, 11);
            await ui(cluster(page, 5)).toHaveCount(1);
            await ui(individualMarkers(page)).toHaveCount(0);

            await setMapZoom(page, 13);
            await ui(individualMarkers(page)).toHaveCount(5);
            await ui(anyCluster(page)).toHaveCount(0);
            expect(errors).toEqual([]);
        } finally { await page.close(); }
    }, 60_000);

    browserTest('the selected marker is still enlarged on the first frame after the result set changes', async () => {
        const { page, errors } = await openMap({ lat: 35.1587, lng: 129.1604, z: 16 });
        try {
            for (const restaurant of busan) await ui(marker(page, restaurant.name)).toHaveCount(1);
            await selectRestaurant(page, busan[1].id);
            await ui.poll(() => markerWidth(page, busan[1].name)).toBe('42px');

            await setRestaurants(page, [busan[0], busan[1], busan[2]]);
            await ui(individualMarkers(page)).toHaveCount(3);
            expect(await markerWidth(page, busan[1].name)).toBe('42px');
            expect(await markerWidth(page, busan[0].name)).toBe('32px');
            expect(await markerWidth(page, busan[2].name)).toBe('32px');
            expect(errors).toEqual([]);
        } finally { await page.close(); }
    }, 60_000);

    browserTest('a restaurant selected while clustered is enlarged as soon as its marker appears', async () => {
        const { page, errors } = await openMap({ lat: 35.1587, lng: 129.1604, z: 11 });
        try {
            await ui(cluster(page, 5)).toHaveCount(1);
            await selectRestaurant(page, busan[2].id);

            await setMapZoom(page, 16);
            await ui(individualMarkers(page)).toHaveCount(5);
            expect(await markerWidth(page, busan[2].name)).toBe('42px');
            expect(await markerWidth(page, busan[0].name)).toBe('32px');
            expect(errors).toEqual([]);
        } finally { await page.close(); }
    }, 60_000);

    browserTest('markers leave the map when their restaurants leave the result set', async () => {
        const { page, errors } = await openMap({ lat: 35.1587, lng: 129.1604, z: 16 });
        try {
            for (const restaurant of busan) await ui(marker(page, restaurant.name)).toHaveCount(1);

            await setRestaurants(page, [busan[0], busan[2], daegu]);
            await ui(marker(page, busan[1].name)).toHaveCount(0);
            await ui(marker(page, busan[0].name)).toHaveCount(1);
            await ui(marker(page, busan[2].name)).toHaveCount(1);
            await ui(individualMarkers(page)).toHaveCount(2);
            await ui.poll(() => lastContextual(page)).toEqual({ renderMode: 'individual', zoom: 16, ids: [busan[0].id, busan[2].id].sort() });

            await setRestaurants(page, []);
            await ui(individualMarkers(page)).toHaveCount(0);
            await ui(anyCluster(page)).toHaveCount(0);
            expect(errors).toEqual([]);
        } finally { await page.close(); }
    }, 60_000);
});
