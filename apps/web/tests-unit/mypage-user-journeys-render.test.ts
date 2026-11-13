import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildBookmarkDetailHref } from "../components/mypage/bookmark-navigation";

const root = join(import.meta.dir, "..");
const restaurantId = "11111111-1111-4111-8111-111111111111";
const secondRestaurantId = "22222222-2222-4222-8222-222222222222";
const mapReturnHref = `/?restaurant=${secondRestaurantId}&mapMode=domestic`;
type Scenario = "ready" | "loading" | "error" | "retrying";
type Route = "bookmarks" | "new" | "edit" | "recommend" | "profile" | "auth-signup";

let fixtureDirectory = "";
let render: (route: Route, scenario?: Scenario) => string;

beforeAll(async () => {
  const entry = `
    import React from 'react';
    import {renderToStaticMarkup} from 'react-dom/server';
    import {setScenario} from 'journey-fixture-state';
    import Bookmarks from './app/mypage/bookmarks/page';
    import NewSubmissions from './app/mypage/submissions/new/page';
    import EditSubmissions from './app/mypage/submissions/edit/page';
    import RecommendSubmissions from './app/mypage/submissions/recommend/page';
    import Profile from './app/mypage/profile/page';
    import AuthModal from './components/auth/AuthModal';
    const Signup=()=> <AuthModal isOpen onClose={()=>{}} initialAuthTab="signup"/>;
    const pages={bookmarks:Bookmarks,new:NewSubmissions,edit:EditSubmissions,recommend:RecommendSubmissions,profile:Profile,'auth-signup':Signup};
    export function render(route,scenario='ready') {
      setScenario(scenario);
      return renderToStaticMarkup(React.createElement(pages[route]));
    }
  `;
  const inert: Record<string, string> = {
    "journey-fixture-state": `let scenario='ready';export const setScenario=value=>{scenario=value};export const getQuery=()=>({data:{pages:[]},isLoading:scenario==='loading',isError:scenario==='error'||scenario==='retrying',isFetching:scenario==='retrying',refetch(){},fetchNextPage(){},hasNextPage:false,isFetchingNextPage:false});`,
    "next/navigation": "export const useRouter=()=>({push(){},replace(){},refresh(){}});",
    "next/link": "import React from 'react';export default function Link({prefetch,...props}){return <a {...props}/>;}",
    "next/image": "import React from 'react';export default function Image({unoptimized,fill,priority,...props}){return <img {...props}/>;}",
    "@/contexts/AuthContext": "const user={id:'33333333-3333-4333-8333-333333333333',email:'fixture@example.test',user_metadata:{}};export const useAuth=()=>({user,profileNickname:'검증 계정'});",
    "@tanstack/react-query": "import {getQuery} from 'journey-fixture-state';export const useInfiniteQuery=getQuery;export const useMutation=()=>({mutate(){},isPending:false});export const useQueryClient=()=>({invalidateQueries:async()=>{},clear(){}});",
    "@/hooks/use-home-return-href": `export const useHomeReturnHref=()=>${JSON.stringify(mapReturnHref)};`,
    "@/hooks/useDeviceType": "export const useImmediateMobileOrTablet=()=>false;export const useIsMobile=()=>false;",
    "@/components/ui/dialog": "import React from 'react';export const Dialog=({open,children})=>open?<>{children}</>:null;export const DialogContent=({children,...props})=><div {...props}>{children}</div>;export const DialogHeader=DialogContent;export const DialogDescription=({children,...props})=><p {...props}>{children}</p>;export const DialogTitle=({children,...props})=><h2 {...props}>{children}</h2>;",
    "@/components/legal/PrivacyPolicyContent": "import React from 'react';export const PrivacyPolicyContent=()=> <p>검증용 정책</p>;",
    "@/hooks/use-bookmarks": `import {getQuery} from 'journey-fixture-state';const data=[{id:'bookmark-domestic',created_at:'2026-01-01T00:00:00Z',restaurant:{id:'${restaurantId}',name:'검증 맛집',category:['한식'],road_address:'검증용 주소',jibun_address:null,youtube_link:null,review_count:2,lat:37.5,lng:127}},{id:'bookmark-overseas',created_at:'2026-01-01T00:00:00Z',restaurant:{id:'${secondRestaurantId}',name:'검증 해외 맛집',category:[],road_address:'검증용 해외 주소',jibun_address:null,youtube_link:null,review_count:0,lat:35.7,lng:139.7}}];export const useBookmarks=()=>({...getQuery(),data});export const useToggleBookmark=()=>({toggleBookmark(){},isLoading:false});`,
    "@/hooks/useUserProfile": "const data={qualityScore:0,reviewCount:0,verifiedReviewCount:0,totalLikes:0,tier:{name:'🌱 뉴비',color:'',bgColor:''}};export const useUserProfile=()=>({data});export const getNextUserTierProgress=()=>({nextTier:{name:'🥉 브론즈'},remainingScore:7,progressPercent:0});",
    "@/integrations/supabase/client": "export const getSupabaseBrowserClient=()=>supabase;export const commitSupabaseBrowserSession=async()=>{throw new Error('FIXTURE_WRITES_FORBIDDEN')};export const supabase={auth:{getSession:async()=>({data:{session:null}})}};",
    "@/lib/public-profile-read": "export const readPublicProfileSummaries=async()=>[];",
    "@/lib/no-toast": "export const toast={success(){},error(){},info(){},warning(){}};",
    "@/hooks/use-toast": "export const toast=()=>{};",
    "@/lib/site-config": "export const isPublicRestrictedMode=false;",
  };
  const built = await Bun.build({
    entrypoints: ["journey-fixture-entry"], target: "bun", format: "esm", packages: "external", write: false,
    plugins: [{ name: "journey-fixture", setup(builder) {
      builder.onResolve({ filter: /^journey-fixture-entry$/ }, () => ({ path: "entry", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: entry, loader: "tsx", resolveDir: root }));
      builder.onResolve({ filter: /^(?:journey-fixture-state|next\/|@\/|@tanstack\/react-query$)/ }, (args) =>
        inert[args.path] ? { path: args.path, namespace: "inert" } : { path: Bun.resolveSync("./" + args.path.slice(2), root) });
      builder.onLoad({ filter: /.*/, namespace: "inert" }, (args) => ({ contents: inert[args.path], loader: "tsx", resolveDir: root }));
    } }],
  });
  if (!built.success) throw new Error(built.logs.map(String).join("\n"));
  const cache = join(root, "node_modules", ".cache");
  mkdirSync(cache, { recursive: true });
  fixtureDirectory = mkdtempSync(join(cache, "mypage-journeys-"));
  const output = join(fixtureDirectory, "fixture.mjs");
  writeFileSync(output, await built.outputs[0].text());
  ({ render } = await import(output));
});

afterAll(() => {
  if (fixtureDirectory) rmSync(fixtureDirectory, { recursive: true, force: true });
});

function anchorAttributes(html: string): Array<Record<string, string>> {
  return [...html.matchAll(/<a\b([^>]*)>/g)].map((match) =>
    Object.fromEntries([...match[1].matchAll(/([^\s=]+)="([^"]*)"/g)]
      .map((attribute) => [attribute[1], attribute[2].replaceAll("&amp;", "&")])),
  );
}

describe("My Page user journeys", () => {
  test("bookmark titles and explicit map actions are native links to the correct restaurant and map mode", () => {
    const anchors = anchorAttributes(render("bookmarks"));
    for (const [name, id, mapMode] of [
      ["검증 맛집", restaurantId, "domestic"],
      ["검증 해외 맛집", secondRestaurantId, "overseas"],
    ]) {
      const detailLinks = anchors.filter((link) => link["aria-label"]?.startsWith(name + " "));
      expect(detailLinks).toHaveLength(2);
      for (const link of detailLinks) {
        const url = new URL(link.href, "https://fixture.test");
        expect(url.pathname).toBe("/");
        expect(url.searchParams.get("restaurant")).toBe(id);
        expect(url.searchParams.get("mapMode")).toBe(mapMode);
        expect(url.searchParams.has("restore")).toBe(false);
        expect(link.role).toBeUndefined();
        expect(link.tabindex).not.toBe("-1");
      }
    }
  });

  test("missing coordinates are not coerced into an overseas location, and invalid restaurant IDs stay at the map root", () => {
    expect(buildBookmarkDetailHref({ id: restaurantId, lat: null, lng: null })).toBe(`/?restaurant=${restaurantId}&mapMode=domestic`);
    expect(buildBookmarkDetailHref({ id: restaurantId, lat: Number.NaN, lng: Number.POSITIVE_INFINITY })).toBe(`/?restaurant=${restaurantId}&mapMode=domestic`);
    expect(buildBookmarkDetailHref({ id: "not-a-restaurant-id", lat: 37.5, lng: 127 })).toBe("/");
  });

  for (const route of ["new", "edit", "recommend"] as const) {
    test(`${route} history keeps navigation and page context available while loading, failing, and retrying`, () => {
      for (const scenario of ["loading", "error", "retrying"] as const) {
        const html = render(route, scenario);
        expect(html).toContain(`data-mypage-section-frame="submissions-${route}"`);
        expect(html).toContain(`data-mypage-submission-guide="${route}"`);
        expect(anchorAttributes(html).some((link) => link.href === mapReturnHref)).toBe(true);
        if (scenario !== "loading") {
          expect(html).toContain('role="alert"');
          const retryButton = html.match(/<button\b[^>]*>다시 시도<\/button>/)?.[0];
          expect(retryButton).toBeDefined();
          expect(/\sdisabled(?:=|\s|>)/.test(retryButton ?? "")).toBe(scenario === "retrying");
        }
      }
    });
  }

  test("profile groups account settings in native closed disclosures and keeps all six consent choices fail closed", () => {
    const html = render("profile");
    expect(html.indexOf('data-mypage-next-actions="true"')).toBeLessThan(html.indexOf('aria-labelledby="account-settings-title"'));
    const settings = [...html.matchAll(/<details class="group\/settings"([^>]*)>/g)];
    expect(settings).toHaveLength(3);
    expect(settings.every((setting) => !setting[1].includes("open"))).toBe(true);
    for (const purpose of ["ordinary", "night"]) {
      for (const channel of ["email", "sms", "push"]) {
        const row = html.match(new RegExp(`data-privacy-consent-row="${purpose}-${channel}"([\\s\\S]*?)<\\/button>`))?.[0];
        expect(row).toBeDefined();
        expect(row).toContain('aria-pressed="false"');
        expect(row).toContain('disabled=""');
      }
    }
    expect(html).toContain('name="current-password"');
    expect(html).toContain('name="new-password"');
    expect(html).toContain('name="confirm-password"');
  });

  test("signup keeps policy acceptance separate from reading it and leaves optional marketing unchecked behind a native disclosure", () => {
    const html = render("auth-signup");
    const policyLabel = html.match(/<label[^>]*for="privacy-agree"[^>]*>([\s\S]*?)<\/label>/)?.[1];
    expect(policyLabel).toBeDefined();
    expect(policyLabel).not.toContain("<button");
    expect(html).toContain('id="privacy-agree"');
    expect(html).toContain('<details class="group/marketing');
    const details = html.match(/<details class="group\/marketing[^>]*>/)?.[0];
    expect(/\sopen(?:=|\s|>)/.test(details ?? "")).toBe(false);
    for (const channel of ["email", "sms", "push", "night_email", "night_sms", "night_push"]) {
      const control = html.match(new RegExp(`<button\\b[^>]*id="marketing-${channel}"[^>]*>`))?.[0];
      expect(control).toBeDefined();
      expect(control).toContain('aria-checked="false"');
      expect(/\sdisabled(?:=|\s|>)/.test(control ?? "")).toBe(channel.startsWith("night_"));
    }
  });
});
