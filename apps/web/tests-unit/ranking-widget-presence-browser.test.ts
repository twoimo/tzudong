import { chromeForTestingExecutable } from './fixtures/chrome-for-testing';
import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect as ui } from '@playwright/test';

const appRoot = join(import.meta.dir, '..');
const chrome = chromeForTestingExecutable();
const AUTH_USER_ID = 'auth-user-7f3c2a91';

const mocks: Record<string, string> = {
  '@/contexts/AuthContext': `import { useSyncExternalStore } from 'react';
    const listeners = new Set();
    let state = { user: { id: ${JSON.stringify(AUTH_USER_ID)} } };
    globalThis.refreshAuthUser = () => { state = { user: { ...state.user } }; listeners.forEach((listener) => listener()); };
    export const useAuth = () => useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => state);`,
  '@/hooks/useLeaderboard': 'export const useLeaderboard = () => ({ data: [] });',
  '@/integrations/supabase/client': `const probe = globalThis.presenceProbe = { joins: [], tracked: [], removed: 0 };
    export const supabase = {
      channel(name) {
        probe.joins.push(name);
        let onSync = () => {};
        let state = {};
        const channel = {
          on(type, filter, callback) { if (type === 'presence' && filter.event === 'sync') onSync = callback; return channel; },
          subscribe(callback) { queueMicrotask(() => callback('SUBSCRIBED')); return channel; },
          async track(payload) {
            probe.tracked.push(payload);
            state = { ['key-' + probe.tracked.length]: [{ ...payload, presence_ref: 'ref-' + probe.tracked.length }] };
            onSync();
            return 'ok';
          },
          presenceState() { return state; },
        };
        return channel;
      },
      async removeChannel() { probe.removed += 1; return 'ok'; },
    };`,
};

async function bundle() {
  const entry = `import React from 'react'; import { createRoot } from 'react-dom/client';
    import { RankingWidget } from './components/layout/RankingWidget';
    createRoot(document.body.appendChild(document.createElement('div'))).render(<RankingWidget />);`;
  const built = await Bun.build({ entrypoints: ['ranking-presence-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' }, plugins: [{ name: 'ranking-presence', setup(builder) {
      builder.onResolve({ filter: /^ranking-presence-fixture$/ }, () => ({ path: 'entry', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: appRoot }));
      builder.onResolve({ filter: /^@\// }, args => args.path in mocks
        ? { path: args.path, namespace: 'ranking-presence-mock' }
        : { path: Bun.resolveSync('./' + args.path.slice(2), appRoot) });
      builder.onLoad({ filter: /.*/, namespace: 'ranking-presence-mock' }, args => ({ contents: mocks[args.path], loader: 'tsx', resolveDir: appRoot }));
    }}] });
  expect(built.success).toBe(true); return built.outputs[0].text();
}

(existsSync(chrome) ? test : test.skip)('header presence broadcasts no auth user id and keeps one channel across token refreshes', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const script = await bundle();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.request().url() === 'https://ranking-presence.test/'
      ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' })
      : route.abort());
    await page.goto('https://ranking-presence.test/'); await page.addScriptTag({ content: script });
    await ui(page.getByText('1명')).toBeVisible();

    for (let refresh = 0; refresh < 3; refresh += 1) {
      await page.evaluate(() => (globalThis as any).refreshAuthUser());
    }
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 50)));

    const probe = await page.evaluate(() => (globalThis as any).presenceProbe);
    expect(JSON.stringify(probe.tracked)).not.toContain(AUTH_USER_ID);
    expect(probe.joins).toEqual(['online-users']);
    expect(probe.removed).toBe(0);
    await ui(page.getByText('1명')).toBeVisible();
    expect(errors).toEqual([]);
  } finally { await browser.close(); }
}, 60000);
