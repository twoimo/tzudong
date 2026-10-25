import { expect, test } from 'bun:test';
import { chromium } from '@playwright/test';
import path from 'node:path';

interface Probe {
  capture(): ReturnType<typeof import('../lib/auth/browser-logout').captureBrowserLogout>;
  migrate(): void;
}
const root = path.resolve(import.meta.dir, '..');
async function bundle() {
  const built = await Bun.build({
    entrypoints: ['logout-cookie-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NEXT_PUBLIC_SUPABASE_URL': '"https://current.supabase.co"' },
    plugins: [{ name: 'fixture', setup(builder) {
      builder.onResolve({ filter: /^logout-cookie-fixture$/ }, () => ({ path: 'entry', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
        contents: "import {captureBrowserLogout} from './lib/auth/browser-logout';import {migrateBrowserAuthCookies} from './lib/auth/session-cookies';globalThis.__logout={capture:captureBrowserLogout,migrate:()=>migrateBrowserAuthCookies('https://current.supabase.co')};",
        loader: 'ts', resolveDir: root,
      }));
    } }],
  });
  if (!built.success) throw new Error('COOKIE_FIXTURE_BUILD_FAILED');
  return built.outputs[0].text();
}

for (const mode of ['clear', 'pending-migration', 'replaced-before', 'replaced-during-prepare', 'owner-rejected', 'cookie-write-denied'] as const) {
  test(`native cookies + actual SSR chunk cleanup: ${mode}`, async () => {
    const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
    try {
      const page = await browser.newPage();
      await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><div>local synthetic cookies</div>' }));
      await page.goto('https://logout-cookie.test/');
      await page.addScriptTag({ content: await bundle() });
      const result = await page.evaluate(async mode => {
        for (const name of ['sb-current-v2-auth-token.0', 'sb-current-v2-auth-token.1', 'sb-current-v2-auth-token-user', 'sb-current-v2-auth-token-code-verifier', 'sb-current-v2-auth-token-code-verifier-flow.0', 'sb-other-auth-token', 'sb-current-v2-auth-token.1x']) {
          document.cookie = `${name}=synthetic; Path=/; SameSite=Lax`;
        }
        if (mode === 'pending-migration') {
          document.cookie = 'tz-auth-v2-current=pending; Path=/';
          document.cookie = 'sb-current-auth-token.0=legacy-synthetic; Path=/';
        }
        const captured = (globalThis as unknown as { __logout: Probe }).__logout.capture();
        if (mode === 'replaced-before') document.cookie = 'sb-current-v2-auth-token.0=new-synthetic; Path=/';
        if (mode === 'cookie-write-denied') {
          const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')!;
          Object.defineProperty(document, 'cookie', { get: () => descriptor.get!.call(document), set() {} });
        }
        const clearing = captured.clearIfCurrent(() => mode !== 'owner-rejected');
        if (mode === 'replaced-during-prepare') queueMicrotask(() => { document.cookie = 'sb-current-v2-auth-token.0=new-synthetic; Path=/'; });
        let cleared = false, fixedFailure = false;
        try { cleared = await clearing; } catch (error) { fixedFailure = error instanceof Error && error.message === 'AUTH_LOCAL_LOGOUT_FAILED'; }
        if (mode === 'pending-migration') (globalThis as unknown as { __logout: Probe }).__logout.migrate();
        return {
          cleared, fixedFailure, targetAbsent: captured.isCleared(),
          replacementPreserved: document.cookie.includes('sb-current-v2-auth-token.0=new-synthetic'),
          originalPreserved: document.cookie.includes('sb-current-v2-auth-token.0=synthetic'),
          unrelatedPreserved: document.cookie.includes('sb-other-auth-token=synthetic') && document.cookie.includes('sb-current-v2-auth-token.1x=synthetic'),
          migrationSuppressed: document.cookie.includes('tz-auth-v2-current=1') && document.cookie.includes('sb-current-auth-token.0=legacy-synthetic'),
        };
      }, mode);
      expect(result.unrelatedPreserved).toBe(true);
      if (mode === 'clear' || mode === 'pending-migration') {
        expect(result).toMatchObject({ cleared: true, fixedFailure: false, targetAbsent: true });
        if (mode === 'pending-migration') expect(result.migrationSuppressed).toBe(true);
      }
      else if (mode === 'cookie-write-denied') expect(result).toMatchObject({ cleared: false, fixedFailure: true, originalPreserved: true });
      else if (mode === 'owner-rejected') expect(result).toMatchObject({ cleared: false, originalPreserved: true });
      else expect(result).toMatchObject({ cleared: false, replacementPreserved: true });
    } finally { await browser.close(); }
  }, 20000);
}
