import { chromeForTestingExecutable } from './fixtures/chrome-for-testing';
import { expect, test } from 'bun:test';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium, expect as browserExpect } from '@playwright/test';

const root = join(import.meta.dir, '..');
const chrome = chromeForTestingExecutable();
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import Profile from './app/mypage/profile/page';
globalThis.__writes=0;globalThis.fetch=async(input,init)=>{if(init?.method && init.method!=='GET')globalThis.__writes++;return new Response('',{status:503});};
createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient()}><main className="mx-auto max-w-5xl p-4" style={{overflow:'auto',height:'100dvh'}}><Profile/></main></QueryClientProvider>);`;

(existsSync(chrome) ? test : test.skip)('actual profile layout puts activity before settings and keeps deletion folded without account writes', async () => {
  const inert: Record<string, string> = {
    'next/navigation': 'export const useRouter=()=>({push(){},replace(){},refresh(){}});',
    'next/image': `import React from 'react';export default function Image({unoptimized,fill,priority,...props}){return <img {...props}/>;}`,
    'next/link': `import React from 'react';export default function Link({prefetch,...props}){return <a {...props}/>;}`,
    '@/contexts/AuthContext': `const user={id:'11111111-1111-4111-8111-111111111111',email:'fixture@example.test',user_metadata:{}};export const useAuth=()=>({user,profileNickname:'레이아웃 검증 계정'});`,
    '@/integrations/supabase/client': 'export const supabase={auth:{getSession:async()=>({data:{session:null}})}};',
    '@/hooks/use-bookmarks': 'const data=[];export const useBookmarks=()=>({data});',
    '@/hooks/useUserProfile': `const data={qualityScore:0,reviewCount:0,verifiedReviewCount:0,totalLikes:0};export const useUserProfile=()=>({data});export const getNextUserTierProgress=()=>({nextTier:{name:'브론즈'},remainingScore:7,progressPercent:0});`,
    '@/lib/public-profile-read': 'export const readPublicProfileSummaries=async()=>[];',
    '@/lib/no-toast': 'export const toast={success(){},error(){},info(){}};',
  };
  const built = await Bun.build({ entrypoints:['profile-fixture'],target:'browser',format:'iife',write:false,
    define:{'process.env.NODE_ENV':'"test"'},plugins:[{name:'profile-fixture',setup(builder){
      builder.onResolve({filter:/^profile-fixture$/},()=>({path:'entry',namespace:'fixture'}));
      builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:entry,loader:'tsx',resolveDir:root}));
      builder.onResolve({filter:/^(?:next\/|@\/)/},args=>inert[args.path]?{path:args.path,namespace:'inert'}:{path:Bun.resolveSync('./'+args.path.slice(2),root)});
      builder.onLoad({filter:/.*/,namespace:'inert'},args=>({contents:inert[args.path],loader:'tsx',resolveDir:root}));
    }}] });
  if(!built.success)throw new Error(built.logs.map(String).join('\n'));
  const script=await built.outputs.find(output=>output.path.endsWith('.js'))!.text();
  const css=await postcss([tailwind()]).process('@import "./app/globals.css";\n@import "./app/home-app-globals.css";\n@source "./app/mypage";\n@source "./components/mypage";',{from:join(root,'profile-fixture.css')});
  const browser=await chromium.launch({executablePath:chrome,headless:true});
  const out=resolve(root,'performance/renewal-20261023/profile');mkdirSync(out,{recursive:true});
  try{
    for(const width of [390,768,1440]){
      const context=await browser.newContext({viewport:{width,height:1000}});
      try{
        const page=await context.newPage();const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
        await page.route('**/*',route=>route.request().resourceType()==='document'?route.fulfill({contentType:'text/html',body:'<!doctype html><html><body><div id="root"></div></body></html>'}):route.abort());
        await page.goto('https://profile.test/');await page.addStyleTag({content:css.css});await page.addScriptTag({content:script});
        await browserExpect(page.locator('[data-mypage-profile-page]')).toBeVisible();
        const danger=page.locator('#account-deletion details');
        await browserExpect(danger).not.toHaveAttribute('open','');
        await browserExpect(page.getByRole('button',{name:'계정 영구 삭제',exact:true})).toHaveCount(0);
        if(width>=768){
          const activity=await page.locator('[data-mypage-next-actions]').boundingBox();
          const password=await page.locator('[data-mypage-password-card]').boundingBox();
          expect(activity && password && activity.y < password.y).toBe(true);
        }
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
        expect(await page.evaluate(()=>(globalThis as unknown as {__writes:number}).__writes)).toBe(0);
        expect(errors).toEqual([]);
        await page.screenshot({path:join(out,`${width}.png`),fullPage:true});
      }finally{await context.close();}
    }
  }finally{await browser.close();}
},60_000);
