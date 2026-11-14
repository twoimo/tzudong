import { join } from 'node:path';

const appRoot = join(import.meta.dir, '../..');

export type InsightsResponsiveMode = 'member' | 'admin';

// The chart, its query lifecycle, its embedded module shell and MainLayoutContent
// are production components. Only data/auth and the surrounding admin frame are
// synthetic. In particular, member mode retains the real MobileBottomNav.
const entry = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {MainLayoutContent} from './components/layout/MainLayout';
import {useDeviceType} from './hooks/useDeviceType';
import InsightsClient from './app/insights/insights-client';

const embedded=location.pathname==='/admin';
const fixture={writes:0,reads:0,unexpectedRequests:0,lastMetric:null,navigation:[]};
globalThis.__insightsResponsiveFixture=fixture;
const videos=Array.from({length:8},(_,index)=>({
  id:'responsive-video-'+index,
  title:'반응형 검증용 합성 영상 '+(index+1)+': 짧은 화면에서도 마지막 설명과 수치를 읽을 수 있도록 긴 제목을 사용하는 차트 검증 자료입니다. 화면 높이와 방향을 바꾸어도 영상 탐색, 기간 선택, 도움말과 하단 탐색을 계속 이용할 수 있어야 합니다.',
  publishedAt:'2026-11-01T00:00:00Z',category:'한식',
  viewCount:(8-index)*245000,likeCount:(8-index)*1200,
  commentCount:(8-index)*120,duration:(8-index)*180,
  previousViewCount:(8-index)*200000,previousLikeCount:(8-index)*1000,
  previousCommentCount:(8-index)*100,previousDuration:(8-index)*150,
}));
const payload=period=>({asOf:'2026-11-14T00:00:00Z',period,totalVideos:videos.length,videos});
globalThis.fetch=async(input,init)=>{
  const method=(init?.method||(input instanceof Request?input.method:'GET')).toUpperCase();
  if(method!=='GET'){fixture.writes++;return new Response('FIXTURE_WRITE_FORBIDDEN',{status:405})}
  const url=new URL(input instanceof Request?input.url:String(input),location.origin);
  if(url.origin!==location.origin||url.pathname!=='/api/insights/treemap'){
    fixture.unexpectedRequests++;return new Response('FIXTURE_UNEXPECTED_READ',{status:503});
  }
  fixture.reads++;
  fixture.lastMetric=url.searchParams.get('metricMode');
  return new Response(JSON.stringify(payload(url.searchParams.get('period'))),{headers:{'Content-Type':'application/json'}});
};
const client=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}});
// Start from a loaded read-only result: the loading engine is not part of C10.
client.setQueryData(['insight-treemap','all','ALL','views'],payload('ALL'));

function AdminBoundary({children}){
  const {isMobile}=useDeviceType();
  return <div data-admin-console-shell="true" data-design-surface="admin"
    style={{height:'100%',minHeight:0,minWidth:0,display:'flex',flexDirection:'column',overflow:'hidden'}}>
    {isMobile&&<header data-admin-console-mobile-header="true" style={{height:48,flexShrink:0}}>합성 관리자 메뉴</header>}
    <div data-admin-console-layout="sidebar-content" style={{display:'flex',flex:1,minHeight:0,minWidth:0}}>
      {!isMobile&&<aside data-admin-left-panel-expanded="true" style={{width:192,flexShrink:0}}>합성 메뉴</aside>}
      <section data-admin-console-content="true" style={{flex:1,minHeight:0,minWidth:0,overflow:'hidden'}}>
        <div data-admin-console-inline-module-frame="true" style={{height:'100%',minHeight:0,minWidth:0}}>
          <div data-admin-console-inline-module-panel="true" style={{height:'100%',minHeight:0,minWidth:0,overflow:'hidden'}}>{children}</div>
        </div>
      </section>
    </div>
  </div>;
}
createRoot(document.getElementById('root')).render(
  <QueryClientProvider client={client}><MainLayoutContent>
    {embedded?<AdminBoundary><InsightsClient embedded/></AdminBoundary>:<InsightsClient/>}
  </MainLayoutContent></QueryClientProvider>
);
`;

export async function buildInsightsResponsiveFixture(): Promise<string> {
  const mocks: Record<string, string> = {
    'next/navigation': `const router={push(url){globalThis.__insightsResponsiveFixture.navigation.push(url)},replace(url){globalThis.__insightsResponsiveFixture.navigation.push(url)},prefetch(){}};export const useRouter=()=>router;export const usePathname=()=>location.pathname;`,
    'next/dynamic': `import React from 'react';export default function dynamic(loader){const Component=React.lazy(()=>loader().then(value=>({default:value.default||value})));return props=><React.Suspense fallback={null}><Component {...props}/></React.Suspense>}`,
    'next/link': `import React from 'react';export default function Link({prefetch,...props}){return <a {...props}/>}`,
    'next/image': `import React from 'react';export default function Image({unoptimized,fill,priority,...props}){return <img {...props}/>}`,
    '@/contexts/AuthContext': `const auth={user:{id:'responsive-member'},isLoading:false,needsNicknameSetup:false,completeNicknameSetup(){}};export const useAuth=()=>auth;`,
    '@/contexts/AuthContextBase': `export {useAuth} from '@/contexts/AuthContext';`,
    '@/integrations/supabase/client': `export const supabase={auth:{},from(){throw new Error('FIXTURE_DATABASE_FORBIDDEN')}};export const getSupabaseBrowserClient=()=>supabase;`,
    '@/components/layout/NavigationPrefetcher': `export default function Prefetcher(){return null;}`,
    '@/components/layout/UserDataPrefetcher': `export default function Prefetcher(){return null;}`,
    '@/components/layout/CombinedPopup': `export default function Popup(){return null;}`,
    '@/components/layout/OverlayLayout': `export default function Overlay({children}){return children;}`,
    '@/components/auth/AuthModal': `export default function AuthModal(){return null;}`,
    '@/components/profile/ProfileModal': `export function ProfileModal(){return null;}`,
    '@/components/profile/NicknameSetupModal': `export function NicknameSetupModal(){return null;}`,
    '@/components/admin/AdminRestaurantModal': `export function AdminRestaurantModal(){return null;}`,
  };
  const result = await Bun.build({
    entrypoints: ['insights-responsive-entry'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env': JSON.stringify({ NODE_ENV: 'test' }) },
    plugins: [{ name: 'insights-responsive', setup(builder) {
      builder.onResolve({ filter: /^insights-responsive-entry$/ }, () => ({ path: 'entry', namespace: 'insights-fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'insights-fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: appRoot }));
      builder.onResolve({ filter: /\.css$/ }, () => ({ path: 'css', namespace: 'insights-css' }));
      builder.onLoad({ filter: /.*/, namespace: 'insights-css' }, () => ({ contents: 'export {};', loader: 'js' }));
      builder.onResolve({ filter: /^(?:next\/|@\/)/ }, args => mocks[args.path]
        ? { path: args.path, namespace: 'insights-mock' }
        : args.path.startsWith('@/') ? { path: Bun.resolveSync('./' + args.path.slice(2), appRoot) } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'insights-mock' }, args => ({ contents: mocks[args.path], loader: 'tsx', resolveDir: appRoot }));
    } }],
  });
  if (!result.success) throw new Error(result.logs.map(String).join('\n').slice(0, 2000));
  const script = result.outputs.find(output => output.path.endsWith('.js'));
  if (!script) throw new Error('INSIGHTS_RESPONSIVE_FIXTURE_SCRIPT_MISSING');
  return script.text();
}
