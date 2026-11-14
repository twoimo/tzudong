import { join } from 'node:path';

const root = join(import.meta.dir, '../..');

export const rejectedReviewId = '11111111-1111-4111-8111-111111111111';
export const approvedReviewId = '22222222-2222-4222-8222-222222222222';
export const rejectedRestaurantName = '합성 검증 맛집 카테고리가 많은 거부 리뷰';
export const approvedRestaurantName = '합성 승인 맛집';

// Keep the real pages, My Page shell/sidebar, query hooks, dialogs and controls.
// Only auth/data/navigation transports are synthetic. The occupied bottom strip
// represents the surrounding app navigation without replacing a page scroll owner.
const entry = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {fixture} from 'mypage-responsive-state';
import Profile from './app/mypage/profile/page';
import Reviews from './app/mypage/reviews/page';
import {MyPageLayoutContent} from './app/mypage/mypage-layout-content';
const Page = location.pathname.endsWith('/reviews') ? Reviews : Profile;
globalThis.fetch = async (input, init) => {
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const path = new URL(input instanceof Request ? input.url : String(input), location.href).pathname;
  if (method !== 'GET') return fixture.deny('fetch:' + method + ':' + path);
  fixture.reads.push(path);
  if (path === '/api/runtime-compatibility/features') return Response.json({schemaVersion:1,status:'ready',code:'FEATURE_DATABASE_READY'});
  if (path === '/api/privacy/consents') return Response.json({}, {status:503});
  return fixture.deny('unexpected-read:' + path);
};
createRoot(document.getElementById('root')).render(
  <QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>
    <main data-fixture-mypage-frame style={{height:'calc(100dvh - 60px)',overflow:'hidden'}}>
      <MyPageLayoutContent><Page/></MyPageLayoutContent>
    </main>
    <nav aria-label="검증용 하단 탐색" style={{position:'fixed',bottom:0,left:0,right:0,height:60,background:'white',borderTop:'1px solid gray'}}>하단 탐색</nav>
  </QueryClientProvider>
);
`;

const state = `
import {RESTAURANT_CATEGORIES} from './constants/categories';
export const owner = {id:'33333333-3333-4333-8333-333333333333',email:'fixture@example.test',user_metadata:{}};
export const fixture = {
  forbidden:[], reads:[],
  deny(operation) { this.forbidden.push(operation); throw new Error('FIXTURE_OPERATION_FORBIDDEN:' + operation); },
};
globalThis.__mypageResponsiveFixture = fixture;
export const restaurants = [
  {id:'44444444-4444-4444-8444-444444444444',name:${JSON.stringify(rejectedRestaurantName)},approved_name:${JSON.stringify(rejectedRestaurantName)},status:'approved'},
  {id:'55555555-5555-4555-8555-555555555555',name:${JSON.stringify(approvedRestaurantName)},approved_name:${JSON.stringify(approvedRestaurantName)},status:'approved'},
];
export const reviews = restaurants.map((restaurant, index) => ({
  id:index === 0 ? ${JSON.stringify(rejectedReviewId)} : ${JSON.stringify(approvedReviewId)},
  user_id:owner.id, restaurant_id:restaurant.id, title:'합성 리뷰',
  content:'실제 계정이나 서버를 사용하지 않는 반응형 검증용 리뷰입니다.',
  visited_at:'2026-01-01T12:00:00.000Z',created_at:'2026-01-02T12:00:00.000Z',
  is_verified:index !== 0,admin_note:index === 0 ? '거부: 합성 검증 사유' : null,
  is_pinned:false,is_edited_by_admin:false,food_photos:[],categories:[...RESTAURANT_CATEGORIES],
}));
`;

const readOnlySupabase = `
import {fixture, restaurants, reviews} from 'mypage-responsive-state';
const deny = operation => fixture.deny(operation);
const bucket = {upload:()=>deny('storage.upload'),remove:()=>deny('storage.remove'),list:async()=>({data:[],error:null})};
function from(table) {
  if (!['reviews','restaurants'].includes(table)) return deny('unexpected-table:' + table);
  let rows = table === 'reviews' ? reviews : restaurants;
  const query = {
    select(){return query;},order(){return query;},
    eq(key,value){rows=rows.filter(row=>row[key]===value);return query;},
    in(key,values){rows=rows.filter(row=>values.includes(row[key]));return query;},
    range(start,end){rows=rows.slice(start,end+1);return query;},
    async returns(){fixture.reads.push('table:' + table);return {data:rows,error:null};},
    async maybeSingle(){fixture.reads.push('table:' + table);return {data:rows[0]??null,error:null};},
    insert:()=>deny('table.insert'),update:()=>deny('table.update'),upsert:()=>deny('table.upsert'),delete:()=>deny('table.delete'),
  };
  return query;
}
export const supabase = {
  from,
  auth:{getSession:async()=>({data:{session:null}}),signOut:()=>deny('auth.signOut'),signInWithPassword:()=>deny('auth.signInWithPassword'),updateUser:()=>deny('auth.updateUser')},
  storage:{from:()=>bucket},
  async rpc(name) {
    // The page automatically checks old media cleanup on mount. A read failure
    // keeps that maintenance flow held, so no finish/queue/delete RPC is invoked.
    if(name === 'pending_review_media_cleanup') {
      fixture.reads.push('rpc:' + name);
      return {data:null,error:{message:'SYNTHETIC_CLEANUP_READ_UNAVAILABLE'}};
    }
    return deny('rpc:' + name);
  },
};
export const getSupabaseBrowserClient=()=>supabase;
export const commitSupabaseBrowserSession=()=>deny('auth.publish');
`;

export async function buildMyPageResponsiveFixture(): Promise<string> {
  const mocks: Record<string, string> = {
    'mypage-responsive-state': state,
    'next/navigation': `import {fixture} from 'mypage-responsive-state';const params=new URLSearchParams(location.search);const router={push:()=>fixture.deny('navigation.push'),replace:()=>fixture.deny('navigation.replace'),refresh:()=>fixture.deny('navigation.refresh')};export const useRouter=()=>router;export const usePathname=()=>location.pathname;export const useSearchParams=()=>params;`,
    'next/link': `import React from 'react';export default function Link({prefetch,...props}){return <a {...props}/>;}`,
    'next/image': `import React from 'react';export default function Image({unoptimized,fill,priority,...props}){return <img {...props}/>;}`,
    'next/dynamic': `import React,{lazy,Suspense} from 'react';export default function dynamic(loader,options={}){const Component=lazy(async()=>{const loaded=await loader();return {default:loaded.default??loaded};});const Loading=options.loading;return function Dynamic(props){return <Suspense fallback={Loading?<Loading/>:null}><Component {...props}/></Suspense>;};}`,
    '@/contexts/AuthContext': `import {fixture,owner} from 'mypage-responsive-state';const auth={user:owner,isLoading:false,profileNickname:'합성 검증 계정',signOut:()=>fixture.deny('auth.signOut')};export const useAuth=()=>auth;`,
    '@/integrations/supabase/client': readOnlySupabase,
    '@/hooks/use-bookmarks': 'const data=[];export const useBookmarks=()=>({data});',
    '@/hooks/useUserProfile': `const data={nickname:'합성 검증 계정',qualityScore:0,reviewCount:2,verifiedReviewCount:1,totalLikes:0,tier:{name:'뉴비',color:'',bgColor:''}};export const useUserProfile=()=>({data});export const getNextUserTierProgress=()=>({nextTier:{name:'브론즈'},remainingScore:7,progressPercent:0});`,
    '@/lib/public-profile-read': `export const readPublicProfileSummaries=async()=>[{nickname:'합성 검증 계정',avatar_url:null}];`,
    '@/lib/no-toast': 'export const toast={success(){},error(){},info(){},warning(){}};',
    '@/hooks/use-toast': 'export const toast=()=>{};',
  };
  const built = await Bun.build({
    entrypoints: ['mypage-responsive-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env': JSON.stringify({ NODE_ENV: 'test' }) },
    plugins: [{ name: 'mypage-responsive-fixture', setup(builder) {
      builder.onResolve({ filter: /^mypage-responsive-fixture$/ }, () => ({ path: 'entry', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: root }));
      // The browser test loads each production CSS owner independently.
      builder.onResolve({ filter: /\.css$/ }, () => ({ path: 'stylesheet', namespace: 'fixture-css' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture-css' }, () => ({ contents: '', loader: 'js' }));
      builder.onResolve({ filter: /^(?:mypage-responsive-state$|next\/|@\/)/ }, args => mocks[args.path]
        ? { path: args.path, namespace: 'mock' }
        : args.path.startsWith('@/') ? { path: Bun.resolveSync('./' + args.path.slice(2), root) } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], loader: 'tsx', resolveDir: root }));
    } }],
  });
  if (!built.success) throw new Error(built.logs.map(String).join('\n'));
  const script = built.outputs.find(output => output.path.endsWith('.js'));
  if (!script) throw new Error('MYPAGE_RESPONSIVE_FIXTURE_BUNDLE_MISSING');
  return script.text();
}
