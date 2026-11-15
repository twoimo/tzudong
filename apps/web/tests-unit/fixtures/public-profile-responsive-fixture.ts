import { join } from 'node:path';

const root = join(import.meta.dir, '../..');

// Data and navigation stay synthetic. The panel, its header, skeleton, cards,
// pagination observers and scroll containers are the production components.
const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UserProfilePanel } from './components/profile/UserProfilePanel';
const fixture = globalThis.__profileFixture;
const embedded = innerWidth >= 1280;
createRoot(document.getElementById('root')).render(
  <QueryClientProvider client={new QueryClient()}>
    <main data-fixture-profile-frame style={{height:embedded?'calc(100dvh - 32px)':'calc(100dvh - 60px)',width:embedded?400:'100%',margin:embedded?16:0,overflow:'hidden'}}>
      <UserProfilePanel userId="fixture-profile" onClose={embedded?()=>fixture.back++:undefined}
        onUserClick={id=>fixture.openedUsers.push(id)}
        onRestaurantClick={restaurant=>fixture.openedRestaurants.push(restaurant.id)} />
    </main>
    {!embedded && <nav aria-label="검증용 하단 탐색" style={{position:'fixed',bottom:0,left:0,right:0,height:60,background:'white',borderTop:'1px solid gray'}}>하단 탐색</nav>}
  </QueryClientProvider>
);
`;

const profileData = `
import { useSyncExternalStore } from 'react';
let mode = 'loaded';
const listeners = new Set();
const subscribe = callback => { listeners.add(callback); return () => listeners.delete(callback); };
globalThis.__profileFixture = {
  writes:0, back:0, retries:0, openedUsers:[], openedRestaurants:[],
  setMode(next) { mode=next; for (const notify of listeners) notify(); }
};
const profile = {userId:'fixture-profile',nickname:'반응형 검증 사용자',reviewCount:30,verifiedReviewCount:30,totalLikes:30,qualityScore:30,tier:{name:'검증 등급',color:'text-primary',bgColor:'bg-primary/10'}};
const restaurants = Array.from({length:30},(_,index)=>({id:'restaurant-'+(index+1),name:'검증 맛집 '+(index+1),approved_name:'검증 맛집 '+(index+1),status:'approved',review_count:1,categories:['한식']}));
const stamps = restaurants.map(restaurant=>({restaurant,createdAt:'2026-01-01T00:00:00.000Z'}));
const reviews = restaurants.map((restaurant,index)=>({id:'review-'+(index+1),restaurantId:restaurant.id,restaurantName:restaurant.name,restaurant,content:'목록 끝까지 스크롤해서 확인하는 검증 리뷰 '+(index+1),photos:[],createdAt:'2026-01-01T00:00:00.000Z',rating:0,isVerified:true,likeCount:0,isLikedByUser:false}));
const likers = Array.from({length:30},(_,index)=>({userId:'liker-'+(index+1),nickname:'검증 사용자 '+(index+1),likedReviewCount:1}));
const empty=[];
const refetch=()=>{globalThis.__profileFixture.retries++;};
function state(){return useSyncExternalStore(subscribe,()=>mode);}
export function useUserProfile(){const mode=state();return {data:mode==='missing'?null:profile,isLoading:mode==='loading',isError:mode==='error',isFetching:false,refetch};}
function useList(data){const mode=state();return {data:mode==='empty'?empty:data,isLoading:false,isError:mode==='tab-error',isFetching:false,refetch};}
export const useUserStamps=()=>useList(stamps);
export const useUserReviews=()=>useList(reviews);
export const useUserLikers=()=>useList(likers);
`;

export async function buildPublicProfileResponsiveFixture(): Promise<string> {
  const mocks: Record<string, string> = {
    'next/navigation': 'const router={back(){globalThis.__profileFixture.back++;},push(){throw new Error("UNEXPECTED_FIXTURE_NAVIGATION")}};export const useRouter=()=>router;',
    'next/link': "import React from 'react';export default function Link({prefetch,...props}){return <a {...props}/>;}",
    'next/image': "import React from 'react';export default function Image({fill,priority,unoptimized,...props}){return <img {...props}/>;}",
    '@/hooks/useUserProfile': profileData,
    '@/hooks/useLeaderboard': "const data=[{id:'fixture-profile'}];export const useLeaderboard=()=>({data});",
    '@/contexts/AuthContext': 'export const useAuth=()=>({user:null});',
    '@/integrations/supabase/client': 'export const supabase={from(){globalThis.__profileFixture.writes++;throw new Error("FIXTURE_WRITE_FORBIDDEN")}};',
    '@/hooks/use-toast': 'export const toast=()=>{};',
  };
  const built = await Bun.build({
    entrypoints: ['public-profile-responsive-fixture'],
    target: 'browser', format: 'iife', write: false,
    define: { 'process.env': JSON.stringify({ NODE_ENV: 'test' }) },
    plugins: [{ name: 'public-profile-responsive-fixture', setup(builder) {
      builder.onResolve({ filter: /^public-profile-responsive-fixture$/ }, () => ({ path: 'entry', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: root }));
      // Compile and load each real stylesheet separately in the browser test.
      builder.onResolve({ filter: /\.css$/ }, () => ({ path: 'stylesheet', namespace: 'fixture-css' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture-css' }, () => ({ contents: '', loader: 'js' }));
      builder.onResolve({ filter: /^(?:next\/|@\/)/ }, args => mocks[args.path]
        ? { path: args.path, namespace: 'mock' }
        : args.path.startsWith('@/') ? { path: Bun.resolveSync('./' + args.path.slice(2), root) } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], loader: 'tsx', resolveDir: root }));
    } }],
  });
  if (!built.success) throw new Error(built.logs.map(String).join('\n'));
  const script = built.outputs.find(output => output.path.endsWith('.js'));
  if (!script) throw new Error('PUBLIC_PROFILE_FIXTURE_BUNDLE_MISSING');
  return script.text();
}
