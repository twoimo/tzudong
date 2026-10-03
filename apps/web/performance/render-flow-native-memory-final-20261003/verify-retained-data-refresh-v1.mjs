import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {serve,pageSetup,origin} from './real-sdk-runtime-retain-v2.mjs';
import {catalog} from './catalog.mjs';
const here=new URL('./',import.meta.url),kind=process.argv[2],label=process.argv[3];assert.ok(['baseline','candidate'].includes(kind));assert.match(label,/^[a-z0-9-]+$/);
const out=new URL(`data-refresh-${kind}-${label}/`,here);await mkdir(out);
process.env.SDK_BASELINE_BUILD_LABEL='control-ui-v2';process.env.SDK_CANDIDATE_BUILD_LABEL='ret-ax-v2';
const result={kind,checks:[],stage:'setup',fieldAdmitted:0,performanceAdmitted:0,setup:'QueryClient public cache updates reached through the owned synthetic page provider; not a real backend write or network-race claim',passed:false};
const server=await serve(kind);let browser,t,rows=catalog(735);
async function closeDetail(){for(let i=0;i<6;i++){const panel=t.page.getByTestId('restaurant-detail-panel').first();if(!await panel.isVisible())return;const close=t.page.getByRole('button',{name:/^(이전 목록으로 돌아가기|이전 화면으로 돌아가기|맛집 상세 닫기)$/}).first();await close.click();await t.page.waitForTimeout(250);}throw Error('detail unavailable');}
try{
 browser=await chromium.launch({channel:'chrome',headless:true});t=await pageSetup(browser,{mobile:true,count:735,cpu:4,captureFrames:false});
 result.buildId=server.receipt.buildId;result.inputs=server.receipt.inputs;
 await t.page.unroute('**/rest/v1/**');
 await t.page.route('**/rest/v1/**',async route=>{const u=new URL(route.request().url());let data=u.pathname.endsWith('/restaurants')?rows:[];
  for(const dim of ['lat','lng'])for(const f of u.searchParams.getAll(dim)){const op=f.split('.')[0],value=Number(f.slice(op.length+1));data=data.filter(x=>op==='gte'?x[dim]>=value:op==='lte'?x[dim]<=value:true);}
  const ids=u.searchParams.get('id');if(ids)data=data.filter(x=>ids.includes(x.id));const name=u.searchParams.get('approved_name');if(name){const term=name.replace(/^ilike\.%|%$/g,'').replace(/^eq\./,'');data=data.filter(x=>x.name.includes(term));}
  const category=u.searchParams.get('categories');if(category)data=data.filter(x=>category.includes(x.categories[0]));const limit=Number(u.searchParams.get('limit')||data.length),offset=Number(u.searchParams.get('offset')||0);data=data.slice(offset,offset+limit);
  await route.fulfill({status:route.request().method()==='OPTIONS'?204:200,contentType:'application/json',body:route.request().method()==='OPTIONS'?'':JSON.stringify(data),headers:{'access-control-allow-origin':origin,'access-control-allow-headers':'*'}});
 });
 await t.page.goto(origin+'/?__qa=data-refresh',{waitUntil:'domcontentloaded'});const cluster=t.page.locator('.cluster-marker-container').filter({hasText:'735'});await cluster.waitFor({state:'visible',timeout:45000});await t.page.waitForTimeout(1000);await cluster.click();await t.page.waitForFunction(()=>window.__actualSdkProbe.first>0);await t.page.waitForTimeout(1000);
 result.stage='query-provider';assert.ok(await t.page.evaluate(()=>{const el=document.querySelector('[data-testid="map-container"]'),key=Object.keys(el).find(k=>k.startsWith('__reactFiber$'));for(let f=el[key],i=0;f&&i<300;f=f.return,i++)for(const c of [f.memoizedProps?.client,f.memoizedProps?.value])if(c&&typeof c.getQueryCache==='function'&&typeof c.setQueryData==='function'){window.__ownedQueryFixture=c;return true;}return false;}));
 const id=await t.page.locator('[data-testid="marker"]').evaluateAll(es=>es.find(e=>{const b=e.getBoundingClientRect(),x=b.x+b.width/2,y=b.y+b.height/2,h=document.elementFromPoint(x,y);return x>30&&x<innerWidth-90&&y>150&&y<innerHeight-230&&h&&e.contains(h);})?.getAttribute('data-restaurant-id'));assert.ok(id);
 const old=rows.find(r=>r.id===id),updatedName='갱신맛집'+old.name.slice(-4);
 rows=rows.map(r=>r.id===id?{...r,name:updatedName,approved_name:updatedName}:r);
 result.stage='name-cache-update';const updates=await t.page.evaluate(({id,name})=>{let count=0;const c=window.__ownedQueryFixture;for(const q of c.getQueryCache().getAll()){if(!Array.isArray(q.state.data)||!q.state.data.some(r=>r?.id===id))continue;c.setQueryData(q.queryKey,prev=>prev.map(r=>r.id===id?{...r,name,approved_name:name}:r));count++;}return count;},{id,name:updatedName});assert.ok(updates>0);
 await t.page.waitForTimeout(500);result.checks.push({name:'same-ID name-only cache change',updatedArrays:updates,syntheticId:id});
 await t.page.evaluate(({oldName,newName})=>{window.__syntheticDetailTitles=[];const record=()=>{const p=document.querySelector('[data-testid="restaurant-detail-panel"]');if(!p)return;const text=p.textContent,name=text.includes(newName)?'updated':text.includes(oldName)?'stale':null;if(name&&window.__syntheticDetailTitles.at(-1)?.name!==name)window.__syntheticDetailTitles.push({name,time:performance.now()});};const observer=new MutationObserver(record);observer.observe(document.body,{subtree:true,childList:true,characterData:true});window.__detailFixtureObserver=observer;},{oldName:old.name,newName:updatedName});
 result.stage='click-updated-marker';await t.page.locator('[data-testid="marker"][data-restaurant-id="'+id+'"]').click();await t.page.getByTestId('restaurant-detail-panel').waitFor({state:'visible'});await t.page.waitForTimeout(800);
 const selected=await t.page.getByTestId('restaurant-detail-panel').textContent();result.titles=await t.page.evaluate(()=>{window.__detailFixtureObserver.disconnect();return window.__syntheticDetailTitles;});
 result.checks.push({name:'updated marker selection',updatedDisplayed:selected.includes(updatedName),staleDisplayed:selected.includes(old.name),observedStaleTransitions:result.titles.filter(x=>x.name==='stale').length});
 assert.ok(selected.includes(updatedName));assert.ok(!selected.includes(old.name));await closeDetail();
 result.stage='visual-cache-update';rows=rows.map(r=>r.id===id?{...r,categories:['중식'],mergedYoutubeLinks:['https://youtu.be/fixtureone','https://youtu.be/fixturetwo','https://youtu.be/fixturetri']}:r);
 await t.page.evaluate(id=>{const c=window.__ownedQueryFixture;for(const q of c.getQueryCache().getAll())if(Array.isArray(q.state.data)&&q.state.data.some(r=>r?.id===id))c.setQueryData(q.queryKey,prev=>prev.map(r=>r.id===id?{...r,categories:['중식'],category:['중식'],mergedYoutubeLinks:['https://youtu.be/fixtureone','https://youtu.be/fixturetwo','https://youtu.be/fixturetri']}:r));},id);
 await t.page.waitForFunction(id=>{const e=document.querySelector('[data-testid="marker"][data-restaurant-id="'+id+'"]');return e?.querySelector('picture source')?.getAttribute('srcset')?.includes('chinese')&&e.querySelector('[data-tzuyang-visit-count-badge="true"]')?.textContent==='3';},id,{timeout:10000});
 result.checks.push({name:'same-ID category and visit badge change',expectedBadge:3,passed:true});
 result.passed=true;result.errors=t.errors;
}catch{result.failure='bounded_data_refresh_invariant_unavailable';}
finally{if(t)await t.close();if(browser)await browser.close();await server.close();await writeFile(new URL('raw.json',out),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({kind,passed:result.passed,stage:result.stage,checks:result.checks,titles:result.titles}));}
if(!result.passed)process.exitCode=1;
