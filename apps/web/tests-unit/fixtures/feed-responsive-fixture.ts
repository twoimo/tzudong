import { join } from 'node:path';

const root = join(import.meta.dir, '../..');

const navigation = `
  import {useMemo,useSyncExternalStore} from 'react';
  const subscribe=callback=>{window.addEventListener('popstate',callback);return()=>window.removeEventListener('popstate',callback)};
  const navigate=(url)=>{globalThis.__routeReplacements.push(url);history.replaceState({},'',url);window.dispatchEvent(new Event('popstate'))};
  const router={replace:navigate,push:navigate,prefetch(){}};
  export const useRouter=()=>router;
  export const usePathname=()=>useSyncExternalStore(subscribe,()=>location.pathname);
  export function useSearchParams(){const search=useSyncExternalStore(subscribe,()=>location.search);return useMemo(()=>new URLSearchParams(search),[search])}
`;

export async function buildFeedResponsiveFixture(mode: 'home-link' | 'feed') {
  const mocks: Record<string, string> = {
    'next/navigation': navigation,
    'next/dynamic': `import React from 'react';export default function dynamic(loader,options={}){const Component=React.lazy(()=>loader().then(value=>({default:value.default||value})));return props=><React.Suspense fallback={options.loading?<options.loading/>:null}><Component {...props}/></React.Suspense>}`,
    'next/image': `import React from 'react';export default function Image({unoptimized,fill,priority,...props}){return <img {...props}/>} `,
    'next/link': `import React from 'react';export default function Link({prefetch,...props}){return <a {...props}/>} `,
    '@/contexts/AuthContext': `const auth={user:null,needsNicknameSetup:false,completeNicknameSetup(){}};export const useAuth=()=>auth;`,
    '@/contexts/AuthContextBase': `export const useAuth=()=>({user:null});`,
    '@/integrations/supabase/client': `export const supabase={auth:{},from(){throw new Error('FIXTURE_UNEXPECTED_DATABASE_READ')}};export const getSupabaseBrowserClient=()=>supabase;export const commitSupabaseBrowserSession=async()=>{throw new Error('FIXTURE_AUTH_WRITES_FORBIDDEN')};`,
    '@/lib/no-toast': `export const toast={success(){},error(){},info(){}};`,
    '@/hooks/use-toast': `export const toast=()=>{};`,
    '@/hooks/use-review-likes-realtime': `export const useReviewLikesRealtime=()=>{};`,
    '@/components/layout/NavigationPrefetcher': `export default function Prefetcher(){return null;}`,
    '@/components/layout/UserDataPrefetcher': `export default function Prefetcher(){return null;}`,
    '@/components/layout/CombinedPopup': `export default function Popup(){return null;}`,
    '@/components/layout/OverlayLayout': `export default function Overlay({children}){return children;}`,
    '@/components/profile/ProfileModal': `export function ProfileModal(){return null;}`,
    '@/components/profile/NicknameSetupModal': `export function NicknameSetupModal(){return null;}`,
    '@/components/admin/AdminRestaurantModal': `export function AdminRestaurantModal(){return null;}`,
    '@/components/restaurant/RestaurantDetailPanel': `export function RestaurantDetailPanel(){return null;}`,
    '@/components/modals/EditRestaurantModal': `export function EditRestaurantModal(){return null;}`,
    '@/components/reviews/ReviewModal': `export function ReviewModal(){return null;}`,
    '@/components/reviews/ReviewEditModal': `export function ReviewEditModal(){return null;}`,
    '@tanstack/react-query': `
      const pages=[{reviews:Array.from({length:12},(_,index)=>({id:'fixture-'+index,userId:'fixture-user',restaurantId:'fixture-place',restaurantName:'합성 맛집',userName:'합성 작성자',visitedAt:'2026-11-01',createdAt:'2026-11-01T00:00:00Z',content:'스크롤과 하단 조작 영역을 검증하는 합성 후기 '+index,photos:[],categories:['한식'],likeCount:0,isLikedByUser:false,restaurant:null}))}];
      const noop=()=>{};const client={invalidateQueries:noop};
      export const useQueryClient=()=>client;
      export const useInfiniteQuery=()=>({data:{pages},refetch:noop,fetchNextPage:noop,hasNextPage:true,isError:false,isLoading:false,isFetching:false,isFetchingNextPage:false});
    `,
  };
  const entry = mode === 'home-link' ? `
    import React,{useMemo,useRef} from 'react';
    import {createRoot} from 'react-dom/client';
    import {usePathname} from 'next/navigation';
    import HomeClientEffects from './app/home-client-effects';
    globalThis.__routeReplacements=[];
    const noop=()=>{};
    function Fixture(){
      const pathname=usePathname();
      const detail=useRef(noop),panel=useRef(noop);
      const props=useMemo(()=>({activeRightPanel:null,clearRestaurantDetailSelection:noop,closeAllPanels:noop,isAdmin:false,isLoggedIn:false,isAnnouncementSheetOpen:false,mapMode:'domestic',openDetailPanelRef:detail,openPanelRef:panel,selectedAnnouncement:null,setMapMode:noop,setSelectedAnnouncement:noop}),[]);
      return <><output data-route-fixture="ready">{pathname}</output>{pathname==='/'&&<HomeClientEffects {...props}/>}</>;
    }
    createRoot(document.getElementById('root')).render(<Fixture/>);
  ` : `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {MainLayoutContent} from './components/layout/MainLayout';
    import FeedPage from './app/feed/page';
    globalThis.__routeReplacements=[];
    globalThis.__fixtureWrites=0;
    globalThis.fetch=async(_input,init)=>{if(init?.method&&init.method!=='GET')globalThis.__fixtureWrites++;return new Response('{}',{status:503,headers:{'Content-Type':'application/json'}})};
    createRoot(document.getElementById('root')).render(<MainLayoutContent><FeedPage/></MainLayoutContent>);
  `;
  const result = await Bun.build({
    entrypoints: ['feed-responsive-entry'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env': JSON.stringify({ NODE_ENV: 'test' }) },
    plugins: [{ name: 'feed-responsive', setup(builder) {
      builder.onResolve({ filter: /^feed-responsive-entry$/ }, () => ({ path: 'entry', namespace: 'feed-fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'feed-fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: root }));
      builder.onResolve({ filter: /^\.\/home-supabase-actions$/ }, () => ({ path: 'home-read', namespace: 'feed-home-read' }));
      builder.onLoad({ filter: /.*/, namespace: 'feed-home-read' }, () => ({ contents: `
        const unexpected=async()=>{throw new Error('FIXTURE_UNEXPECTED_HOME_READ')};
        export const fetchHomeAnnouncementById=unexpected;
        export const resolveHomeRestaurantDeepLink=unexpected;
        export const resolveHomeRestaurantByCoordinates=unexpected;
        export const resolveHomeBookmarkRestaurantSelection=unexpected;
      `, loader: 'js' }));
      builder.onResolve({ filter: /\.css$/ }, () => ({ path: 'css', namespace: 'feed-css' }));
      builder.onLoad({ filter: /.*/, namespace: 'feed-css' }, () => ({ contents: 'export {};', loader: 'js' }));
      builder.onResolve({ filter: /^(?:next\/|@\/|@tanstack\/react-query$)/ }, (args) =>
        mocks[args.path] ? { path: args.path, namespace: 'feed-mock' }
          : args.path.startsWith('@/') ? { path: Bun.resolveSync('./' + args.path.slice(2), root) } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'feed-mock' }, (args) => ({ contents: mocks[args.path], loader: 'tsx', resolveDir: root }));
    } }],
  });
  if (!result.success) throw new Error(result.logs.map(String).join('\n').slice(0, 2000));
  const script = result.outputs.find(output => output.path.endsWith('.js'));
  if (!script) throw new Error('FEED_RESPONSIVE_FIXTURE_SCRIPT_MISSING');
  return script.text();
}
