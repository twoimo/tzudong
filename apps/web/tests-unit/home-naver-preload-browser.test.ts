import { afterAll, beforeAll, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect as browserExpect, type Browser, type Page } from '@playwright/test';
import { chromeForTestingExecutable } from './fixtures/chrome-for-testing';

const app = join(import.meta.dir, '..');
const browserTest = existsSync(chromium.executablePath()) ? test : test.skip;
const ui = browserExpect.configure({ timeout: 2000 });
let browser: Browser;
let bundle: string;
let closed = false;
const fixture = `
import React, {StrictMode, useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {useHomeNaverPreload} from './hooks/use-home-naver-preload';
import {useNaverMaps} from './hooks/use-naver-maps';
function Consumer() {
  const {isLoaded,loadError,load}=useNaverMaps({autoLoad:true,strategy:'afterInteractive'});
  return <section><output data-testid="consumer">{loadError?'error':isLoaded?'ready':'pending'}</output>
    <button onClick={load}>retry</button></section>;
}
function Preloader({enabled,mode}) {
  useHomeNaverPreload(enabled,mode);return null;
}
function App() {
  const params=new URLSearchParams(location.search);
  const [enabled,setEnabled]=useState(params.get('viewport')!=='pending');
  const [mode,setMode]=useState(params.get('stateMode')==='overseas'?'overseas':'domestic');
  const [consumer,setConsumer]=useState(false);
  const [preloading,setPreloading]=useState(true);
  const [generation,setGeneration]=useState(0);
  useEffect(()=>{window.__fixtureMounted=true;},[]);
  function changeMode(next) {
    const url=new URL(location.href);url.searchParams.set('mapMode',next);
    history.replaceState(null,'',url);setMode(next);
  }
  return <><output data-testid="generation">{generation}</output>
    {preloading&&<Preloader enabled={enabled} mode={mode}/>}
    <button onClick={()=>setEnabled(true)}>resolve viewport</button>
    <button onClick={()=>changeMode('domestic')}>domestic</button>
    <button onClick={()=>changeMode('overseas')}>overseas</button>
    <button onClick={()=>setConsumer(true)}>mount consumer</button>
    <button onClick={()=>setPreloading(false)}>unmount preloader</button>
    <button onClick={()=>setGeneration(x=>x+1)}>rerender</button>
    {consumer&&<Consumer/>}</>;
}
const root=createRoot(document.getElementById('root'));
window.__unmountFixture=()=>root.unmount();
root.render(<StrictMode><App/></StrictMode>);
`;

beforeAll(async () => {
    if (!existsSync(chromium.executablePath())) return;
    const result = await Bun.build({
        entrypoints: ['home-naver-preload-fixture'], target: 'browser', format: 'iife', write: false,
        define: { 'process.env': JSON.stringify({ NODE_ENV: 'production', NEXT_PUBLIC_NAVER_CLIENT_ID: 'public-browser-fixture' }) },
        plugins: [{ name: 'home-naver-preload-fixture', setup(builder) {
            builder.onResolve({ filter: /^home-naver-preload-fixture$/ }, () => ({ path: 'fixture.tsx', namespace: 'fixture' }));
            builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: fixture, loader: 'tsx', resolveDir: app }));
            // Only the large component chunk is held. The provider hook and its
            // script insertion/event/failure code are the actual source.
            builder.onResolve({ filter: /^@\/lib\/naver-map-loader$/ }, () => ({ path: 'chunk.ts', namespace: 'chunk' }));
            builder.onLoad({ filter: /.*/, namespace: 'chunk' }, () => ({ loader: 'ts', contents: `
              let pending;
              export function preloadNaverMap(){
                if(!pending){window.__moduleRequests=(window.__moduleRequests||0)+1;
                  pending=new Promise(resolve=>window.__releaseModule=()=>{window.__moduleReady=true;resolve();});}
              }` }));
            if (process.env.HOME_NAVER_PRELOAD_CONTROL === 'module-only') {
                builder.onResolve({ filter: /hooks\/use-home-naver-preload$/ }, () => ({ path: 'control.ts', namespace: 'control' }));
                builder.onLoad({ filter: /.*/, namespace: 'control' }, () => ({
                    contents: readFileSync(join(app, 'hooks/use-home-naver-preload.ts'), 'utf8')
                        .replace('if (!isLoaded && !loadError) load();', 'void load;'),
                    loader: 'ts', resolveDir: app,
                }));
            }
            builder.onResolve({ filter: /^@\// }, ({ path }) => {
                const resolved = ['', '.ts', '.tsx'].map(suffix => join(app, path.slice(2)) + suffix).find(existsSync);
                return resolved ? { path: resolved } : undefined;
            });
        } }],
    });
    expect(result.success).toBe(true);
    bundle = await result.outputs[0].text();
    browser = await chromium.launch({ executablePath: chromeForTestingExecutable(), headless: true });
});
afterAll(async () => {
    await browser?.close();
    closed = !browser?.isConnected();
    expect(closed).toBe(true);
});

type Outcome = 'pending' | 'error' | 'success';
async function run(query: string, outcomes: Outcome[], check: (page: Page, requests: () => number, finish: () => void) => Promise<void>) {
    const context = await browser.newContext();
    const page = await context.newPage();
    let requests = 0;
    let finish: (() => void) | undefined;
    const errors: string[] = [];
    page.on('pageerror', () => errors.push('PAGE_ERROR'));
    const sdk = 'window.__mapInstances=0;window.naver={maps:{Map:function(){window.__mapInstances++},LatLng:function(){},Point:function(){},Event:{}}};';
    await page.route('**/*', async route => {
        if (route.request().isNavigationRequest()) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><div id="root"></div>' });
        const url = new URL(route.request().url());
        if (url.hostname !== 'oapi.map.naver.com' || url.pathname !== '/openapi/v3/maps.js') {
            errors.push('UNEXPECTED_EGRESS');
            return route.abort();
        }
        const outcome = outcomes[Math.min(requests++, outcomes.length - 1)];
        if (outcome === 'error') return route.abort('failed');
        if (outcome === 'pending') await new Promise<void>(resolve => { finish = resolve; });
        return route.fulfill({ contentType: 'application/javascript', body: sdk });
    });
    try {
        await page.goto(`https://home.fixture.test/${query}`);
        await page.addScriptTag({ content: bundle });
        await page.waitForFunction('window.__fixtureMounted===true');
        await check(page, () => requests, () => { expect(finish).toBeDefined(); finish?.(); });
        expect(errors).toEqual([]);
    } finally {
        finish?.();
        await context.close();
    }
}

browserTest('starts the shared SDK while the component chunk is still pending without creating a map', async () => run('', ['pending'], async (page, requests, finish) => {
    await ui.poll(requests).toBe(1);
    expect(await page.evaluate('window.__moduleRequests')).toBe(1);
    expect(await page.evaluate('Boolean(window.__moduleReady)')).toBe(false);
    await page.getByRole('button', { name: 'mount consumer', exact: true }).click();
    await ui(page.getByTestId('consumer')).toHaveText('pending');
    expect(requests()).toBe(1);
    finish();
    await ui(page.getByTestId('consumer')).toHaveText('ready');
    expect(await page.evaluate('window.__mapInstances')).toBe(0);
    expect(await page.evaluate('Boolean(window.__moduleReady)')).toBe(false);
    await page.evaluate('window.__releaseModule()');
    expect(await page.evaluate('window.__moduleReady')).toBe(true);
}));

for (const query of ['?stateMode=overseas&mapMode=overseas', '?mapMode=overseas', '?viewport=pending']) {
    browserTest(`does not start Naver work for inactive entry ${query}`, async () => run(query, ['success'], async (page, requests) => {
        await page.getByRole('button', { name: 'rerender', exact: true }).click();
        await ui(page.getByTestId('generation')).toHaveText('1');
        expect(requests()).toBe(0);
        expect(await page.evaluate('window.__moduleRequests||0')).toBe(0);
        expect(await page.locator('script[data-tzudong-naver-maps]').count()).toBe(0);
    }));
}

browserTest('starts once after viewport resolution and keeps one request across rerenders and mode changes', async () => run('?viewport=pending', ['pending'], async (page, requests, finish) => {
    await page.getByRole('button', { name: 'resolve viewport', exact: true }).click();
    await ui.poll(requests).toBe(1);
    for (const name of ['overseas', 'domestic', 'rerender']) await page.getByRole('button', { name, exact: true }).click();
    expect(requests()).toBe(1);
    expect(await page.locator('script[data-tzudong-naver-maps]').count()).toBe(1);
    finish();
}));

browserTest('an overseas entry starts Naver only after an explicit domestic transition', async () => run('?stateMode=overseas&mapMode=overseas', ['success'], async (page, requests) => {
    expect(requests()).toBe(0);
    await page.getByRole('button', { name: 'domestic', exact: true }).click();
    await ui.poll(requests).toBe(1);
    expect(await page.evaluate('window.__moduleRequests')).toBe(1);
}));

browserTest('unmounting the early consumer during a request preserves the shared SDK for the remaining consumer', async () => run('', ['pending'], async (page, requests, finish) => {
    await ui.poll(requests).toBe(1);
    await page.getByRole('button', { name: 'mount consumer', exact: true }).click();
    await ui(page.getByTestId('consumer')).toHaveText('pending');
    await page.getByRole('button', { name: 'unmount preloader', exact: true }).click();
    expect(await page.locator('script[data-tzudong-naver-maps]').count()).toBe(1);
    expect(requests()).toBe(1);
    finish();
    await ui(page.getByTestId('consumer')).toHaveText('ready');
    expect(requests()).toBe(1);
    expect(await page.evaluate('window.__mapInstances')).toBe(0);
    await page.evaluate('window.__unmountFixture()');
}));

browserTest('mounted consumers keep a failed request failed until explicit retry and recover together', async () => run('?viewport=pending', ['error', 'success'], async (page, requests) => {
    await page.getByRole('button', { name: 'mount consumer', exact: true }).click();
    await ui(page.getByTestId('consumer')).toHaveText('error');
    expect(requests()).toBe(1);
    await page.getByRole('button', { name: 'resolve viewport', exact: true }).click();
    await page.getByRole('button', { name: 'rerender', exact: true }).click();
    expect(requests()).toBe(1);
    await ui(page.getByTestId('consumer')).toHaveText('error');
    await page.getByRole('button', { name: 'retry', exact: true }).click();
    await ui(page.getByTestId('consumer')).toHaveText('ready');
    expect(requests()).toBe(2);
    await page.getByRole('button', { name: 'rerender', exact: true }).click();
    expect(requests()).toBe(2);
}));

browserTest('a failed early request and later consumer retry are bounded, then explicit retry recovers', async () => run('', ['error', 'error', 'success'], async (page, requests) => {
    await ui.poll(requests).toBe(1);
    await ui.poll(() => page.locator('script[data-tzudong-naver-maps]').count()).toBe(0);
    await page.getByRole('button', { name: 'rerender', exact: true }).click();
    expect(requests()).toBe(1);
    await page.getByRole('button', { name: 'mount consumer', exact: true }).click();
    await ui(page.getByTestId('consumer')).toHaveText('error');
    expect(requests()).toBe(2);
    await page.getByRole('button', { name: 'rerender', exact: true }).click();
    expect(requests()).toBe(2);
    await page.getByRole('button', { name: 'retry', exact: true }).click();
    await ui(page.getByTestId('consumer')).toHaveText('ready');
    expect(requests()).toBe(3);
}));
