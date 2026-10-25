import { chromeForTestingExecutable } from './fixtures/chrome-for-testing';
import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium, expect as ui } from '@playwright/test';

const root = join(import.meta.dir, '..');
const chrome = chromeForTestingExecutable();
const output = resolve(root, 'performance/renewal-20261023/unified-media-v20');
const source = JSON.parse(readFileSync(resolve(root, '../../docs/evidence/marker-evidence-live-20261021-v1/reviewed-frames.json'), 'utf8'));
const frames = source.frames.map((row: { frame: { video_id: string } }) => row.frame);
const videoIds = [...new Set<string>(frames.map((frame: { video_id: string }) => frame.video_id))];
const before = process.env.TZUDONG_EVIDENCE_LAYOUT_BEFORE;

async function fixture() {
  const mocks: Record<string, string> = {
    '@/contexts/AuthContext': 'export const useAuth=()=>({user:null,isAdmin:false});',
    '@/components/auth/AuthModal': 'export default function AuthModal(){return null}',
    '@/components/reviews/ReviewEditModal': 'export function ReviewEditModal(){return null}',
    '@/hooks/use-review-likes-realtime': 'export function useReviewLikesRealtime(){}',
    '@/hooks/use-bookmarks': 'export const useBookmarkIds=()=>({data:new Set()});export const useToggleBookmark=()=>({toggleBookmark(){},isLoading:false});export const useBookmarkCount=()=>({data:0});',
    '@/integrations/supabase/client': `const result={data:[],error:null,count:0};const chain=new Proxy({}, {get(_,key){if(key==='then')return resolve=>Promise.resolve(result).then(resolve);return ()=>chain;}});export const supabase={from:()=>chain,rpc:()=>Promise.resolve(result)};`,
    'next/image': `import React from 'react';export default function Image({fill,priority,unoptimized,loader,...props}){return <img {...props} style={{...props.style,...(fill?{position:'absolute',inset:0,width:'100%',height:'100%'}:{})}}/>;}`,
  };
  const entry = `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';
    import{RestaurantDetailPanel}from'./components/restaurant/RestaurantDetailPanel';
    const frames=${JSON.stringify(frames)};const ids=${JSON.stringify(videoIds)};
    const base={id:'layout-fixture',name:'영상 장면 배치 검증',categories:['화면 검증'],road_address:'검증용 주소 · 실제 매장 정보가 아닙니다',status:'approved',youtube_link:'https://www.youtube.com/watch?v='+ids[0],mergedYoutubeLinks:ids.slice(0,2).map(id=>'https://www.youtube.com/watch?v='+id),mergedEvidenceFrames:frames};
    const events=globalThis.__layout={swipes:0,opened:[]};window.open=(url)=>{events.opened.push(url);return null};localStorage.setItem('restaurant-detail-swipe-hint-seen-v1','1');
    function App(){const [restaurant,setRestaurant]=useState(base);events.set=value=>setRestaurant({...base,...value});return <main className="mx-auto border-x border-border" style={{width:"min(400px,100vw)",height:"100dvh"}}><RestaurantDetailPanel restaurant={restaurant} onClose={()=>{}} onSwipeLeft={()=>events.swipes++} onSwipeRight={()=>events.swipes++} isMobile={innerWidth<1024}/></main>};
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><App/></QueryClientProvider>);`;
  const result = await Bun.build({ entrypoints: ['evidence-layout-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' }, plugins: [{ name: 'evidence-layout', setup(builder) {
      builder.onResolve({ filter: /^evidence-layout-fixture$/ }, () => ({ path: 'entry', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: root }));
      if (before) builder.onLoad({ filter: /Restaurant(?:DetailPanel|EvidenceCarousel)\.tsx$/ }, args => ({ contents: readFileSync(join(before, 'before-' + args.path.split('/').at(-1)), 'utf8'), loader: 'tsx', resolveDir: join(root, 'components/restaurant') }));
      builder.onResolve({ filter: /^(?:next\/|@\/)/ }, args => mocks[args.path]
        ? { path: args.path, namespace: 'mock' }
        : args.path.startsWith('@/') ? { path: Bun.resolveSync('./' + args.path.slice(2), root) } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], loader: 'tsx', resolveDir: root }));
    }}] });
  if (!result.success) throw new Error(result.logs.map(String).join('\n'));
  const script = await result.outputs.find(item => item.path.endsWith('.js'))!.text();
  const css = await postcss([tailwind()]).process('@import "./app/globals.css";\n@import "./app/home-app-globals.css";\n@import "./app/home-detail-globals.css";\n@source inline("w-[min(68vw,18rem)] sm:w-64 lg:w-72 pb-[env(safe-area-inset-bottom)]");', { from: join(root, 'evidence-layout-fixture.css') });
  mkdirSync(output, {recursive:true});
  const html='<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css.css+'</style><body><div id="root"></div><script>globalThis.process={env:{NODE_ENV:"test"}};'+script.replaceAll('</script','<\\/script')+'</script></body></html>';
  writeFileSync(join(output, before ? 'before.html' : 'preview.html'), html);
  return html;
}

(existsSync(chrome) ? test : test.skip)('actual detail panel unifies videos/scenes, retains late selection and orphan frames across widths/themes', async () => {
  const html = await fixture();
  const browser = await chromium.launch({executablePath:chrome,headless:true});
  const results: unknown[] = [];
  try {
    for (const width of [360,390,768,1024,1440,1518,1920]) {
      for (const theme of ['light','dark']) {
        const page = await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce',hasTouch:true});
        const errors: string[]=[];page.on('pageerror',e=>errors.push(e.message));
        await page.route('**/*', route=>{
          const url=new URL(route.request().url());
          if(route.request().resourceType()==='document')return route.fulfill({contentType:'text/html',body:html});
          if(url.hostname==='i.ytimg.com')return route.continue();
          if(url.pathname.startsWith('/evidence-frames/'))return route.fulfill({contentType:'image/webp',body:readFileSync(join(root,'public',url.pathname))});
          if((url.pathname.startsWith('/icons/')||url.pathname.startsWith('/images/maker-images/'))&&existsSync(join(root,'public',url.pathname)))return route.fulfill({contentType:url.pathname.endsWith('.svg')?'image/svg+xml':url.pathname.endsWith('.webp')?'image/webp':'image/png',body:readFileSync(join(root,'public',url.pathname))});
          if(url.pathname==='/logo.png')return route.fulfill({contentType:'image/png',body:readFileSync(join(root,'public/logo.png'))});
          return route.abort();
        });
        await page.goto('https://evidence-layout.test/');
        await page.evaluate(dark=>document.documentElement.classList.toggle('dark',dark),theme==='dark');
        await ui(page.getByRole('heading',{name:'매장 정보',exact:true})).toBeVisible().catch(error=>{throw new Error(JSON.stringify(errors)+' '+String(error));});
        if(before){await ui(page.getByRole('region',{name:'쯔양 영상 근거와 방문 장면'})).toBeVisible();await page.screenshot({path:join(output,`before-${width}-${theme}.png`)});await page.close();continue;}
        const content=page.locator('[data-restaurant-detail-swipe-area="content"]');
        const media=content.locator('section[aria-label="쯔양 영상과 장면"]');
        const carousel=media.getByRole('region',{name:'쯔양 영상과 장면 넘기기',exact:true});
        const next=media.getByRole('button',{name:'다음 영상 또는 장면',exact:true});
        const previous=media.getByRole('button',{name:'이전 영상 또는 장면',exact:true});
        const counter=media.locator('[aria-live="polite"]');
        const total=frames.length+Math.min(videoIds.length,2);
        await ui(media).toHaveCount(1);
        await ui(media.locator('details')).toHaveCount(0);
        await ui(content.getByText('다른 영상 속 장면',{exact:true})).toHaveCount(0);
        await ui(media.getByRole('group',{name:'영상과 장면 바로 선택'}).getByRole('button')).toHaveCount(total);
        await ui(counter).toHaveText('콘텐츠 1/'+total);
        await ui(previous).toBeDisabled();
        await next.click();
        await ui(counter).toHaveText('콘텐츠 2/'+total);
        const firstFrame=frames.filter((f:{video_id:string})=>f.video_id===videoIds[0]).sort((a:{timestamp_ms:number},b:{timestamp_ms:number})=>a.timestamp_ms-b.timestamp_ms)[0];
        await ui(carousel.getByRole('button')).toHaveAttribute('aria-label',/영상 1 ·/);
        await ui.poll(()=>carousel.locator('[aria-hidden="false"] img').first().evaluate(image=>(image as HTMLImageElement).naturalWidth)).toBe(640);
        await carousel.getByRole('button').click();
        expect(await page.evaluate(()=>(globalThis as unknown as {__layout:{opened:string[]}}).__layout.opened)).toEqual([firstFrame.youtube_seek_url]);
        const secondVideo=media.getByRole('button',{name:'영상 2 · 전체 영상 선택',exact:true});
        await secondVideo.click();
        const secondIndex=2+frames.filter((f:{video_id:string})=>f.video_id===videoIds[0]).length;
        await ui(counter).toHaveText('콘텐츠 '+secondIndex+'/'+total);
        await ui(carousel.getByRole('button')).toHaveAttribute('aria-label','영상 2 · 전체 영상 유튜브에서 열기');
        // Late frame updates must retain the selected video, rather than change
        // it into a frame inserted before its old index.
        await page.evaluate(()=>{(globalThis as unknown as {__layout:{set(v:unknown):void}}).__layout.set({mergedEvidenceFrames:[]});});
        await ui(counter).toHaveText('콘텐츠 2/2');
        await page.evaluate(frames=>{(globalThis as unknown as {__layout:{set(v:unknown):void}}).__layout.set({mergedEvidenceFrames:frames});},frames);
        await ui(counter).toHaveText('콘텐츠 '+secondIndex+'/'+total);
        await ui(carousel.getByRole('button')).toHaveAttribute('aria-label','영상 2 · 전체 영상 유튜브에서 열기');
        await secondVideo.click();
        await carousel.press('ArrowLeft');
        await ui(counter).toHaveText('콘텐츠 '+(secondIndex-1)+'/'+total);
        await media.getByRole('group',{name:'영상과 장면 바로 선택'}).getByRole('button').last().click();
        await ui(counter).toHaveText('콘텐츠 '+total+'/'+total);
        await ui(next).toBeDisabled();
        await ui(carousel.getByRole('button')).toHaveAttribute('aria-label',/영상 [3-9] ·/);
        expect(await media.evaluate(section=>section.scrollWidth<=section.clientWidth+1)).toBe(true);
        await ui.poll(()=>carousel.locator('[aria-hidden="false"] img').first().evaluate(image=>(image as HTMLImageElement).naturalWidth)).toBe(640);
        await page.screenshot({path:join(output,`unified-${width}-${theme}.png`)});
        await carousel.getByRole('button').click();
        const opened=await page.evaluate(()=>(globalThis as unknown as {__layout:{opened:string[]}}).__layout.opened);
        expect(opened.length).toBe(2);
        expect(frames.some((f:{youtube_seek_url:string})=>f.youtube_seek_url===opened[1])).toBe(true);
        expect(await page.evaluate(()=>(globalThis as unknown as {__layout:{swipes:number}}).__layout.swipes)).toBe(0);
        if(width===390&&theme==='light'){
          await media.getByRole('button',{name:'영상 1 · 전체 영상 선택',exact:true}).click();
          const box=(await carousel.boundingBox())!;const client=await page.context().newCDPSession(page);const y=box.y+box.height/2;
          await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width*0.85,y}]});
          for(let step=1;step<=8;step++){await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:box.x+box.width*(0.85-0.7*step/8),y}]});await page.waitForTimeout(16);}
          await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await client.detach();
          await ui(counter).toHaveText('콘텐츠 2/'+total);
          expect(await page.evaluate(()=>(globalThis as unknown as {__layout:{swipes:number;opened:string[]}}).__layout.swipes)).toBe(0);
          expect(await page.evaluate(()=>(globalThis as unknown as {__layout:{opened:string[]}}).__layout.opened.length)).toBe(2);
        }
        await page.evaluate(()=>{(globalThis as unknown as {__layout:{set(v:unknown):void}}).__layout.set({id:'frame-only',youtube_link:null,mergedYoutubeLinks:[]});});
        await ui(media.getByRole('group',{name:'영상과 장면 바로 선택'}).getByRole('button')).toHaveCount(frames.length);
        await ui(carousel.getByRole('button')).toHaveAttribute('aria-label',/영상 1 ·/);
        await page.evaluate(()=>{(globalThis as unknown as {__layout:{set(v:unknown):void}}).__layout.set({id:'no-media',mergedEvidenceFrames:[],youtube_link:null,mergedYoutubeLinks:[]});});
        await ui(media).toHaveCount(0);
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
        expect(errors).toEqual([]);
        results.push({width,theme,unified:true,orphanFramesIncluded:true,selectionRestored:true,noOverflow:true});
        await page.close();
      }
    }
    writeFileSync(join(output,before?'before-report.json':'browser-report.json'),JSON.stringify({fixture:'Actual RestaurantDetailPanel; mocked auth, empty review/bookmark services and next/image adapter; public YouTube thumbnails requested normally; existing reviewed frames; no DB writes or live provider proof',results},null,2)+'\n');
  }finally{await browser.close();}
},120000);

(existsSync(chrome) ? test : test.skip)('canonical video aliases create one carousel slide and one watch target', async () => {
 const html=await fixture();const browser=await chromium.launch({executablePath:chrome,headless:true});
 try {
  const page=await browser.newPage({viewport:{width:390,height:900},reducedMotion:'reduce'});
  await page.route('**/*',route=>route.request().resourceType()==='document'?route.fulfill({contentType:'text/html',body:html}):route.abort());
  await page.goto('https://evidence-layout.test/');await ui(page.getByRole('heading',{name:'매장 정보',exact:true})).toBeVisible();
  await page.evaluate(id => {(globalThis as unknown as {__layout:{set(v:unknown):void}}).__layout.set({youtube_link:'https://www.youtube.com/watch?v='+id,mergedYoutubeLinks:['https://youtu.be/'+id+'?t=30','https://www.youtube.com/watch?v='+id+'&feature=share'],mergedEvidenceFrames:[]});},videoIds[0]);
  const open=page.getByRole('button',{name:'영상 1 · 전체 영상 유튜브에서 열기',exact:true});await ui(open).toBeVisible();
  await ui(page.getByRole('button',{name:'다음 영상 또는 장면',exact:true})).toHaveCount(0);
  await ui(page.getByRole('button',{name:'이전 영상 또는 장면',exact:true})).toHaveCount(0);
  await open.click();expect(await page.evaluate(()=>(globalThis as unknown as {__layout:{opened:string[]}}).__layout.opened)).toEqual(['https://www.youtube.com/watch?v='+videoIds[0]]);
 } finally {await browser.close();}
},30000);
