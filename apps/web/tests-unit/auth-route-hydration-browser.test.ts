import { expect, test } from 'bun:test';
import { chromium, expect as ui } from '@playwright/test';
import path from 'node:path';
import { chromeForTestingExecutable } from './fixtures/chrome-for-testing';

const root = path.resolve(import.meta.dir, '..');

for (const mode of ['callback', 'rejected', 'invalid', 'recovery'] as const) {
  test(`one-use auth page survives layout hydration and resize: ${mode}`, async () => {
    const route = mode === 'recovery' ? '/auth/reset-password' : '/auth/complete';
    const mocks: Record<string, string> = {
      'next/dynamic': 'export default () => ({ children }) => children ?? null;',
      'next/navigation': 'export const usePathname=()=>location.pathname; export const useRouter=()=>({push(){}});',
      'next/link': 'export default ({children,...props})=><a {...props}>{children}</a>;',
      '@tanstack/react-query': 'export const useQueryClient=()=>({invalidateQueries(){}});',
      '@/contexts/AuthContext': 'export const useAuth=()=>({user:null,needsNicknameSetup:false,completeNicknameSetup(){}});',
      '@/contexts/LayoutContext': 'export const LayoutProvider=({children})=>children;',
      '@/components/ui/dialog': `export const Dialog=({children})=>children;
        export const DialogContent=({children})=><div>{children}</div>;
        export const DialogHeader=DialogContent;
        export const DialogDescription=({children})=><p>{children}</p>;
        export const DialogTitle=({children})=><h2>{children}</h2>;`,
      '@/lib/auth/browser-oauth-commit': `export async function completeBrowserOAuthCallback(code,next,signal){
        probe.calls++; await new Promise(r=>setTimeout(r,400)); probe.aborted=signal.aborted;
        if(signal.aborted || ${JSON.stringify(mode)}==='rejected')throw Error('fixture-rejection');
        return next;
      }`,
      '@/lib/auth/isolated-browser-pkce': `export async function openBrowserPasswordRecovery(){
        probe.calls++; return {async updatePassword(){probe.updates++},async dispose(){probe.disposals++;return true}};
      }`,
    };
    const built = await Bun.build({
      entrypoints: ['auth-hydration-entry'], target: 'browser', format: 'iife', write: false,
      plugins: [{ name: 'auth-hydration', setup(builder) {
        builder.onResolve({ filter: /^auth-hydration-entry$/ }, () => ({ path: 'entry', namespace: 'auth-hydration' }));
        builder.onResolve({ filter: /.*/ }, args => {
          if (args.path in mocks) return { path: args.path, namespace: 'auth-hydration-mock' };
          if (args.importer.endsWith('/components/layout/MainLayout.tsx') && args.path.startsWith('@/components/')) {
            return { path: args.path, external: true };
          }
          if (args.path.startsWith('@/')) return { path: Bun.resolveSync('./' + args.path.slice(2), root) };
          return undefined;
        });
        builder.onLoad({ filter: /.*/, namespace: 'auth-hydration-mock' }, args => ({
          loader: 'tsx', resolveDir: root, contents: mocks[args.path],
        }));
        builder.onLoad({ filter: /.*/, namespace: 'auth-hydration' }, () => ({ loader: 'tsx', resolveDir: root, contents: `
          import {createRoot} from 'react-dom/client';
          import {MainLayoutContent} from './components/layout/MainLayout';
          import AuthComplete from './app/auth/complete/page';
          import Recovery from './app/auth/reset-password/page';
          globalThis.probe={calls:0,aborted:false,updates:0,disposals:0};
          createRoot(document.getElementById('root')).render(<MainLayoutContent>${mode === 'recovery' ? '<Recovery/>' : '<AuthComplete/>'}</MainLayoutContent>);
        ` }));
      } }],
    });
    if (!built.success) throw new Error('AUTH_HYDRATION_FIXTURE_BUILD_FAILED');
    const script = await built.outputs[0].text();
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === '/fixture.js') return new Response(script, { headers: { 'Content-Type': 'text/javascript; charset=utf-8' } });
      if (url.pathname === '/mypage/submissions/new') return new Response('<h1>연결 완료</h1>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      return new Response('<!doctype html><div id="root"></div><script src="/fixture.js"></script>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    } });
    const browser = await chromium.launch({ executablePath: chromeForTestingExecutable(), headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      const query = mode === 'invalid' ? '?code=one&code=two' : '?code=one-use-fixture&next=%2Fmypage%2Fsubmissions%2Fnew';
      await page.goto(`http://127.0.0.1:${server.port}${route}${query}`);
      if (mode === 'invalid') {
        await ui(page.getByRole('heading', { name: '로그인을 완료하지 못했어요' })).toBeVisible();
        expect(await page.evaluate(() => (globalThis as any).probe.calls)).toBe(0);
      } else {
        await page.waitForFunction(() => (globalThis as any).probe.calls === 1);
        await page.setViewportSize({ width: 390, height: 844 });
        await page.setViewportSize({ width: 1600, height: 1000 });
        if (mode === 'callback') {
          await ui(page.getByRole('heading', { name: '연결 완료' })).toBeVisible();
          expect(new URL(page.url()).pathname).toBe('/mypage/submissions/new');
        } else if (mode === 'rejected') {
          await ui(page.getByRole('heading', { name: '로그인을 완료하지 못했어요' })).toBeVisible();
          const retry = await page.getByRole('link', { name: '다시 로그인' }).getAttribute('href');
          expect(new URL(retry!, page.url()).searchParams.get('next')).toBe('/mypage/submissions/new');
          expect(await page.evaluate(() => (globalThis as any).probe)).toMatchObject({ calls: 1, aborted: false });
        } else {
          await ui.poll(() => errors).toEqual([]);
          await ui(page.getByLabel('새 비밀번호', { exact: true })).toBeVisible();
          expect(await page.evaluate(() => (globalThis as any).probe)).toMatchObject({ calls: 1, disposals: 0 });
        }
      }
    } finally {
      await browser.close();
      await server.stop(true);
    }
  }, 20000);
}
