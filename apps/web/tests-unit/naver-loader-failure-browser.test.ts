import { chromeForTestingExecutable } from './fixtures/chrome-for-testing';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium, expect as browserExpect, type Browser, type Page } from '@playwright/test';

const app = join(import.meta.dir, '..');
const chromeAvailable = existsSync(chromium.executablePath());
const browserTest = chromeAvailable ? test : test.skip;
const ui = browserExpect.configure({ timeout: 1500 });
const baselineInput = process.env.NAVER_LOADER_BASELINE ?? '';
const baseline = ['056a86600f412eb42df4304e3206841679012f3e', '7a9b19b19416ce098f2f1a6fa5d36c8674b409b0'].includes(baselineInput)
  ? baselineInput : null;
let browser: Browser;
const scripts: Record<string, string> = {};
const fakeSdk = 'window.naver={maps:{Map:function(){},LatLng:function(){},Point:function(){},Event:{}}};';
const fixture = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {useNaverMaps} from './hooks/use-naver-maps';
import {NaverMapLoadErrorState} from './components/map/map-view-status-panels';
import {AdminMapLoadErrorState} from './components/admin/admin-map-load-error-state';
function Consumer({id}) {
  const strategy=new URLSearchParams(location.search).get('strategy')==='lazyOnload'?'lazyOnload':'afterInteractive';
  const {isLoaded,isLoading,loadError,load}=useNaverMaps({autoLoad:true,strategy});
  const admin=new URLSearchParams(location.search).get('ui')==='admin';
  return <section data-testid={'consumer-'+id}>
    <output data-testid={'state-'+id}>{loadError?'error':isLoaded?'ready':isLoading?'loading':'idle'}</output>
    {loadError&&(admin?<AdminMapLoadErrorState onRetry={load}/>:<NaverMapLoadErrorState message={loadError.message} onRetry={load}/>)}
  </section>;
}
const count=Number(new URLSearchParams(location.search).get('consumers')||1);
const root=createRoot(document.getElementById('root'));
window.__unmountNaverFixture=()=>root.unmount();
root.render(<>{Array.from({length:count},(_,i)=><Consumer id={i} key={i}/>)}</>);
`;

beforeAll(async () => {
  if (!chromeAvailable) return;
  for (const mode of ['live', 'local', 'configured']) {
    const bundle = await Bun.build({ entrypoints: ['naver-loader-fixture'], target: 'browser', format: 'iife', write: false,
      define: { 'process.env': JSON.stringify({ NODE_ENV: 'production', NEXT_PUBLIC_NAVER_CLIENT_ID: mode !== 'local' ? 'browser-fixture-client' : '', NEXT_PUBLIC_TZUDONG_LOCAL_RUNTIME: mode === 'local' ? '1' : '0', NEXT_PUBLIC_NAVER_MAPS_SCRIPT_URL: mode === 'configured' ? 'https://sdk.fixture.test/naver.js' : undefined }) },
      plugins: [{ name: 'naver-loader-fixture', setup(builder) {
        builder.onResolve({ filter: /^naver-loader-fixture$/ }, () => ({ path: 'fixture.tsx', namespace: 'fixture' }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: fixture, loader: 'tsx', resolveDir: app }));
        if (baseline) {
          builder.onResolve({ filter: /hooks\/use-naver-maps$/ }, () => ({ path: 'use-naver-maps.tsx', namespace: 'baseline' }));
          builder.onLoad({ filter: /.*/, namespace: 'baseline' }, () => ({ contents: execFileSync('git', ['show', baseline + ':apps/web/hooks/use-naver-maps.tsx'], { cwd: app, encoding: 'utf8' }), loader: 'tsx', resolveDir: app }));
        }
        builder.onResolve({ filter: /^@\// }, ({ path }) => {
          const resolved = ['', '.ts', '.tsx'].map(suffix => join(app, path.slice(2)) + suffix).find(existsSync);
          return resolved ? { path: resolved } : undefined;
        });
      } }] });
    expect(bundle.success).toBe(true);
    scripts[mode] = await bundle.outputs[0].text();
  }
  browser = await chromium.launch({ executablePath: chromeForTestingExecutable(), headless: true });
});
afterAll(async () => { await browser?.close(); });

type Outcome = 'network-error' | 'missing-api' | 'success';
async function run(outcomes: Outcome[], check: (page: Page, counts: { live: number; stub: number }) => Promise<void>, consumers = 1, mode = 'live', uiMode = 'public', strategy = 'afterInteractive') {
  const context = await browser.newContext();
  const page = await context.newPage();
  const counts = { live: 0, stub: 0 };
  if (strategy === 'lazyOnload') await page.addInitScript(() => {
    let id = 0;
    const callbacks = new Map<number, IdleRequestCallback>();
    Object.assign(window, {
      requestIdleCallback: (callback: IdleRequestCallback) => { callbacks.set(++id, callback); return id; },
      cancelIdleCallback: (handle: number) => { callbacks.delete(handle); },
      __idleCallbackCount: () => callbacks.size,
      __flushIdle: () => {
        const pending = [...callbacks.values()]; callbacks.clear();
        pending.forEach(callback => callback({ didTimeout: false, timeRemaining: () => 50 }));
      },
    });
  });
  await page.addInitScript(() => {
    const active = new Map<string, Set<EventListenerOrEventListenerObject>>();
    const add = document.addEventListener.bind(document);
    const remove = document.removeEventListener.bind(document);
    document.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
      if (type === 'load' || type === 'error') {
        const listeners = active.get(type) ?? new Set();
        listeners.add(listener); active.set(type, listeners);
      }
      add(type, listener, options);
    }) as typeof document.addEventListener;
    document.removeEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => {
      active.get(type)?.delete(listener); remove(type, listener, options);
    }) as typeof document.removeEventListener;
    Object.assign(window, { __documentScriptListenerCount: () => [...active.values()].reduce((sum, listeners) => sum + listeners.size, 0) });
  });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (route.request().isNavigationRequest()) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><div id="root"></div></body></html>' });
    if ((url.hostname === 'oapi.map.naver.com' && url.pathname === '/openapi/v3/maps.js')
      || (url.hostname === 'sdk.fixture.test' && url.pathname === '/naver.js')) {
      const outcome = outcomes[Math.min(counts.live++, outcomes.length - 1)];
      if (outcome === 'network-error') return route.abort('failed');
      return route.fulfill({ contentType: 'application/javascript', body: outcome === 'success' ? fakeSdk : '/* provider loaded without an API */' });
    }
    if (url.pathname === '/__local/naver-maps.js') {
      counts.stub++;
      return route.fulfill({ contentType: 'application/javascript', body: fakeSdk });
    }
    return route.abort();
  });
  try {
    await page.goto(`http://naver-loader.fixture.test/?consumers=${consumers}&ui=${uiMode}&strategy=${strategy}`);
    await page.addScriptTag({ content: scripts[mode] });
    await check(page, counts);
  } catch (error) {
    console.error(JSON.stringify({ mode, consumers, strategy, uiMode, liveRequests: counts.live, stubRequests: counts.stub }));
    throw error;
  } finally { await context.close(); }
}

browserTest('live SDK success becomes ready without requesting the local stub', async () => run(['success'], async (page, counts) => {
  await ui(page.getByTestId('state-0')).toHaveText('ready');
  expect(counts).toEqual({ live: 1, stub: 0 });
}));

for (const failure of ['network-error', 'missing-api'] as const) {
  browserTest(`live ${failure} remains a visible error and never becomes a simulated map`, async () => run([failure], async (page, counts) => {
    await ui(page.getByTestId('state-0')).toHaveText('error');
    await ui(page.getByRole('heading', { name: '지도를 불러오지 못했어요' })).toBeVisible();
    await page.waitForTimeout(250); // Observe automatic retries; no product delay.
    expect(counts).toEqual({ live: 1, stub: 0 });
    expect(await page.locator('script[data-local-naver-maps="true"]').count()).toBe(0);
  }));

  browserTest(`explicit retry recovers after ${failure} without a page reload`, async () => run([failure, 'success'], async (page, counts) => {
    await ui(page.getByTestId('state-0')).toHaveText('error');
    await page.getByRole('button', { name: '다시 시도', exact: true }).click();
    await ui(page.getByTestId('state-0')).toHaveText('ready');
    expect(counts).toEqual({ live: 2, stub: 0 });
  }));
}

for (const failure of ['network-error', 'missing-api'] as const) {
browserTest(`one retry after ${failure} recovers every concurrent consumer`, async () => run([failure, 'success'], async (page, counts) => {
  await ui(page.getByTestId('state-0')).toHaveText('error');
  await ui(page.getByTestId('state-1')).toHaveText('error');
  expect(counts).toEqual({ live: 1, stub: 0 });
  await page.getByRole('button', { name: '다시 시도', exact: true }).first().click();
  await ui(page.getByTestId('state-0')).toHaveText('ready');
  await ui(page.getByTestId('state-1')).toHaveText('ready');
  expect(counts).toEqual({ live: 2, stub: 0 });
}, 2));

browserTest(`admin error control recovers after ${failure}`, async () => run([failure, 'success'], async (page, counts) => {
  await ui(page.getByTestId('state-0')).toHaveText('error');
  await ui(page.getByRole('alert')).toContainText('네이버 지도를 불러오지 못했습니다');
  await page.getByRole('button', { name: '다시 시도', exact: true }).click();
  await ui(page.getByTestId('state-0')).toHaveText('ready');
  await ui(page.getByRole('alert')).toHaveCount(0);
  expect(counts).toEqual({ live: 2, stub: 0 });
}, 1, 'live', 'admin'));

browserTest(`configured SDK URL shares one retry after ${failure}`, async () => run([failure, 'success'], async (page, counts) => {
  await ui(page.getByTestId('state-0')).toHaveText('error');
  await ui(page.getByTestId('state-1')).toHaveText('error');
  expect(counts).toEqual({ live: 1, stub: 0 });
  await page.getByRole('button', { name: '다시 시도', exact: true }).first().click();
  await ui(page.getByTestId('state-0')).toHaveText('ready');
  await ui(page.getByTestId('state-1')).toHaveText('ready');
  expect(counts).toEqual({ live: 2, stub: 0 });
}, 2, 'configured'));
}

browserTest('explicit local offline mode still uses its deterministic stub', async () => run([], async (page, counts) => {
  await ui(page.getByTestId('state-0')).toHaveText('ready');
  expect(counts).toEqual({ live: 0, stub: 1 });
}, 1, 'local'));

browserTest('unmount releases provider subscriptions and settled script callbacks', async () => run(['success'], async page => {
  await ui(page.getByTestId('state-0')).toHaveText('ready');
  expect(await page.evaluate('window.__documentScriptListenerCount()')).toBe(2);
  expect(await page.evaluate(() => {
    const script = document.querySelector<HTMLScriptElement>('script[src*="oapi.map.naver.com"]');
    return Boolean(script?.onload || script?.onerror);
  })).toBe(false);
  await page.evaluate('window.__unmountNaverFixture()');
  expect(await page.evaluate('window.__documentScriptListenerCount()')).toBe(0);
}));

browserTest('lazy consumers share one deferred request and one explicit retry', async () => run(['network-error', 'success'], async (page, counts) => {
  await page.waitForFunction('window.__idleCallbackCount() === 2');
  await page.evaluate('window.__flushIdle()');
  await ui(page.getByTestId('state-0')).toHaveText('error');
  await ui(page.getByTestId('state-1')).toHaveText('error');
  expect(counts).toEqual({ live: 1, stub: 0 });
  await page.getByRole('button', { name: '다시 시도', exact: true }).first().click();
  await page.waitForFunction('window.__idleCallbackCount() === 1');
  await page.evaluate('window.__flushIdle()');
  await ui(page.getByTestId('state-0')).toHaveText('ready');
  await ui(page.getByTestId('state-1')).toHaveText('ready');
  expect(counts).toEqual({ live: 2, stub: 0 });
}, 2, 'live', 'public', 'lazyOnload'));

browserTest('unmount cancels deferred provider work before script injection', async () => run(['success'], async (page, counts) => {
  await page.waitForFunction('window.__idleCallbackCount() === 1');
  await page.evaluate('window.__unmountNaverFixture()');
  expect(await page.evaluate('window.__idleCallbackCount()')).toBe(0);
  await page.evaluate('window.__flushIdle()');
  expect(counts).toEqual({ live: 0, stub: 0 });
}, 1, 'live', 'public', 'lazyOnload'));
