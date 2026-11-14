import { join } from 'node:path';
import { compileResponsiveCss } from './responsive-css';

const appRoot = join(import.meta.dir, '../..');

export type AdminBannersResponsiveMode = 'standalone' | 'embedded';
export const bannerCount = 30;
export const lastBannerTitle = '합성 배너 30';

// The page, data hook, MainLayoutContent, list, inspector and Sheet are real.
// As in admin-responsive-fixture, only the surrounding console menu/sidebar is
// synthetic. Standalone deliberately has no extra height or scrolling wrapper.
const entry = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {MainLayoutContent} from './components/layout/MainLayout';
import BannerManagementRoutePage from './app/admin/banners/page';
import {LoadingProvider} from './components/ui/loading-surface';

const embedded=location.pathname==='/admin';
const fixture={reads:0,forbidden:[],deny(operation){this.forbidden.push(operation);throw new Error('FIXTURE_OPERATION_FORBIDDEN:'+operation)}};
globalThis.__adminBannersResponsiveFixture=fixture;
const banners=Array.from({length:${bannerCount}},(_,index)=>({
  id:'00000000-0000-4000-8000-'+String(index+1).padStart(12,'0'),
  title:'합성 배너 '+String(index+1).padStart(2,'0'),
  description:'실제 계정이나 데이터를 사용하지 않는 배너 목록 검증 자료입니다.',
  image_url:null,video_url:null,media_type:'none',link_url:null,
  is_active:true,priority:1000-index,display_target:['sidebar','mobile_popup'],
  created_at:'2026-11-01T00:00:00Z',updated_at:'2026-11-02T00:00:00Z',created_by:null,
}));
globalThis.fetch=async(input,init)=>{
  const method=(init?.method||(input instanceof Request?input.method:'GET')).toUpperCase();
  const url=new URL(input instanceof Request?input.url:String(input),location.origin);
  if(method!=='GET')return fixture.deny('fetch:'+method+':'+url.pathname);
  if(url.origin!==location.origin||url.pathname!=='/api/admin/banners')return fixture.deny('unexpected-read:'+url.pathname);
  fixture.reads++;
  return Response.json({banners});
};
const client=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}});

function ConsoleBoundary({children}){
  return <div data-admin-console-shell="true" data-design-surface="admin" className="h-[var(--full-height,100vh)] min-h-0 min-w-0 w-full overflow-hidden bg-background font-sans text-foreground tracking-normal">
    <div data-admin-console-layout="sidebar-content" data-admin-console-mobile-header-visible="true" className="grid h-full min-h-0 w-full grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden md:grid-cols-[auto_minmax(0,1fr)] md:grid-rows-1">
      <div data-admin-console-mobile-header="true" className="flex h-14 shrink-0 items-center overflow-hidden bg-card px-3 py-2 md:hidden">합성 관리자 메뉴</div>
      <aside data-admin-left-panel-expanded="true" className="hidden h-full shrink-0 md:block">합성 메뉴</aside>
      <section id="admin-console-canvas" data-admin-console-content="true" data-scroll-owner="admin-canvas" className="admin-surface h-full min-h-0 min-w-0 overflow-x-hidden overflow-y-auto bg-background p-2 md:p-4" style={{paddingBottom:innerWidth<768?'calc(env(safe-area-inset-bottom) + 0.75rem)':'1rem'}}>
        <div className="h-full min-h-0">
          <section data-admin-console-inline-module-frame="true" className="admin-surface flex min-h-full min-w-0 flex-col md:h-full md:min-h-0">
            <div data-admin-console-inline-module-panel="true" className="admin-surface min-h-[360px] flex-1 bg-background shadow-none md:min-h-0 overflow-visible md:overflow-hidden">{children}</div>
          </section>
        </div>
      </section>
    </div>
  </div>;
}
createRoot(document.getElementById('root')).render(
  <QueryClientProvider client={client}><LoadingProvider><MainLayoutContent>
    {embedded?<ConsoleBoundary><BannerManagementRoutePage.Embedded embedded/></ConsoleBoundary>:<BannerManagementRoutePage/>}
  </MainLayoutContent></LoadingProvider></QueryClientProvider>
);
`;

export async function buildAdminBannersResponsiveFixture(): Promise<{ script: string; css: string }> {
  const mocks: Record<string, string> = {
    'next/navigation': `const params=new URLSearchParams(location.search);const deny=operation=>globalThis.__adminBannersResponsiveFixture.deny(operation);const router={push:()=>deny('navigation.push'),replace:()=>deny('navigation.replace'),back:()=>deny('navigation.back'),refresh:()=>deny('navigation.refresh'),prefetch(){}};export const useRouter=()=>router;export const usePathname=()=>location.pathname;export const useSearchParams=()=>params;`,
    'next/dynamic': `import React from 'react';export default function dynamic(loader){const Component=React.lazy(()=>loader().then(value=>({default:value.default||value})));return props=><React.Suspense fallback={null}><Component {...props}/></React.Suspense>}`,
    'next/link': `import React from 'react';export default function Link({prefetch,...props}){return <a {...props}/>}`,
    'next/image': `import React from 'react';export default function Image({unoptimized,fill,priority,...props}){return <img {...props}/>}`,
    '@/contexts/AuthContext': `const auth={user:{id:'00000000-0000-4000-8000-000000000099'},isAdmin:true,isLoading:false,profileNickname:'합성 관리자',needsNicknameSetup:false,completeNicknameSetup(){}};export const useAuth=()=>auth;`,
    '@/contexts/AuthContextBase': `export {useAuth} from '@/contexts/AuthContext';`,
    '@/integrations/supabase/client': `const deny=operation=>globalThis.__adminBannersResponsiveFixture.deny(operation);export const supabase={from:()=>deny('supabase.from'),rpc:()=>deny('supabase.rpc'),storage:{from:()=>deny('storage.from')},auth:{getSession:async()=>({data:{session:null}})}};export const getSupabaseBrowserClient=()=>supabase;`,
    '@/components/layout/NavigationPrefetcher': 'export default function Prefetcher(){return null;}',
    '@/components/layout/UserDataPrefetcher': 'export default function Prefetcher(){return null;}',
    '@/components/layout/CombinedPopup': 'export default function Popup(){return null;}',
    '@/components/layout/OverlayLayout': 'export default function Overlay({children}){return children;}',
    '@/components/auth/AuthModal': 'export default function AuthModal(){return null;}',
    '@/components/profile/ProfileModal': 'export function ProfileModal(){return null;}',
    '@/components/profile/NicknameSetupModal': 'export function NicknameSetupModal(){return null;}',
    '@/components/admin/AdminRestaurantModal': 'export function AdminRestaurantModal(){return null;}',
    '@/hooks/use-toast': 'export const toast=()=>{};',
  };
  const result = await Bun.build({
    entrypoints: ['admin-banners-responsive-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env': JSON.stringify({ NODE_ENV: 'test' }) },
    plugins: [{ name: 'admin-banners-responsive-fixture', setup(builder) {
      builder.onResolve({ filter: /^admin-banners-responsive-fixture$/ }, () => ({ path: 'entry', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: appRoot }));
      builder.onResolve({ filter: /^(?:next\/|@\/)/ }, args => mocks[args.path]
        ? { path: args.path, namespace: 'mock' }
        : args.path.startsWith('@/') ? { path: Bun.resolveSync('./' + args.path.slice(2), appRoot) } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], loader: 'tsx', resolveDir: appRoot }));
    } }],
  });
  if (!result.success) throw new Error(result.logs.map(String).join('\n'));
  const script = result.outputs.find(output => output.path.endsWith('.js'));
  if (!script) throw new Error('ADMIN_BANNERS_RESPONSIVE_FIXTURE_BUNDLE_MISSING');
  // Preserve the actual CSS Modules and their scoped class names; never replace
  // AdminFeaturePolish with a hand-written fixture stylesheet.
  const css = await Promise.all([
    compileResponsiveCss(['globals.css', 'app-globals.css', '../styles/product-ui.css', '../styles/admin-ui.css']),
    ...result.outputs.filter(output => output.path.endsWith('.css')).map(output => output.text()),
  ]);
  return { script: await script.text(), css: css.join('\n') };
}
