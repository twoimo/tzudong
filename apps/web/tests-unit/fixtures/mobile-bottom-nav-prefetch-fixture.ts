import { join } from 'node:path';

// Only router/auth context boundaries are mocked. The rendered navigation,
// intent handlers, auth request dispatcher and height observer are real code.
export async function buildMobileBottomNavPrefetchFixture() {
  const root = join(import.meta.dir, '../..');
  const mocks: Record<string, string> = {
    'next/navigation': `
      const router = {
        prefetch(path) {
          const state = window.__bottomNavFixture;
          state.events.push({kind:'prefetch',path});
          if (state.throwPrefetch) throw new Error('SYNTHETIC_PREFETCH_FAILURE');
        },
        push(path) { window.__bottomNavFixture.events.push({kind:'push',path}); },
      };
      export const useRouter = () => router;
      export const usePathname = () => window.__bottomNavFixture.pathname;
    `,
    '@/contexts/AuthContextBase': 'export const useAuth = () => ({user:window.__bottomNavFixture.user});',
  };
  const entry = `
    import React, {useEffect} from 'react';
    import {createRoot} from 'react-dom/client';
    import MobileBottomNav from './components/layout/MobileBottomNav';
    import {AUTH_UI_REQUEST_EVENT} from './lib/auth-ui-events';
    window.addEventListener(AUTH_UI_REQUEST_EVENT, event => {
      window.__bottomNavFixture.authRequests.push(event.detail);
    });
    function Fixture() {
      useEffect(() => { window.__bottomNavFixture.effectsReady = true; }, []);
      return <MobileBottomNav />;
    }
    createRoot(document.getElementById('root')).render(<Fixture />);
  `;
  const result = await Bun.build({
    entrypoints: ['mobile-bottom-nav-prefetch-entry'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env': JSON.stringify({ NODE_ENV: 'production' }) },
    plugins: [{ name: 'mobile-bottom-nav-prefetch', setup(builder) {
      builder.onResolve({ filter: /^mobile-bottom-nav-prefetch-entry$/ }, () => ({ path: 'entry', namespace: 'nav-fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'nav-fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: root }));
      builder.onResolve({ filter: /^(?:next\/|@\/)/ }, args => mocks[args.path]
        ? { path: args.path, namespace: 'nav-mock' }
        : args.path.startsWith('@/') ? { path: Bun.resolveSync('./' + args.path.slice(2), root) } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'nav-mock' }, args => ({ contents: mocks[args.path], loader: 'tsx', resolveDir: root }));
    } }],
  });
  if (!result.success) throw new Error(result.logs.map(String).join('\n').slice(0, 2000));
  const script = result.outputs.find(output => output.path.endsWith('.js'));
  if (!script) throw new Error('MOBILE_BOTTOM_NAV_FIXTURE_BUILD_MISSING');
  return script.text();
}
