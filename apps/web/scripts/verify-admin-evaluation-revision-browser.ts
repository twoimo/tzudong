/** Owned local browser fixture. Every API response is synthetic; writes abort. */
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import readline from 'node:readline';
import { readFileSync } from 'node:fs';
import { buildEvaluationCatalog, evaluationCatalogPage } from '@/lib/admin/evaluation-catalog';
import { summarizeEvaluationRecord } from '@/lib/admin/evaluation-summary';
import { parseEvaluationPageQuery } from '@/lib/admin/evaluation-page-query';
import { findSameVideoDuplicateWarningCandidates, formatSameVideoDuplicateWarning } from '@/lib/admin-same-video-duplicate-warning';
import { findRestaurantIdentityWarnings } from '@/lib/admin-restaurant-identity-warning';
import { extractVideoIdFromYoutubeLink } from '@/lib/dashboard/helpers';
declare const Bun: { serve(options: { hostname: string; port: number; fetch(request: Request): Response }): { stop(): void } };

// SSR metadata also reads the public client. An owned read-only loopback
// fixture avoids measuring connection-refused retry delays as UI performance.
const publicFixture=Bun.serve({hostname:'127.0.0.1',port:18791,fetch(request){
  if(!['GET','HEAD'].includes(request.method))return Response.json({error:'FIXTURE_WRITE_DENIED'},{status:403});
  return new Response(request.method==='HEAD'?null:'[]',{headers:{'Content-Type':'application/json','Content-Range':'*/0'}});
}});

const connection=process.argv[2];
if (!connection?.startsWith('ws://127.0.0.1:')) throw new Error('OWNED_LOCAL_BROWSER_REQUIRED');
const browser=await chromium.connectOverCDP(connection);
const context=browser.contexts()[0];
const page=context.pages().find(page=>page.url()==='about:blank'||page.url().startsWith('http://127.0.0.1:18790/'));
if (!page) throw new Error('OWNED_BLANK_TARGET_REQUIRED');
const rows=Array.from({length:121},(_,offset)=>{
  const index=offset+1;
  const name=index===1||index===121?'동일영상 표본':`검증식당 ${index}`;
  return { id:`00000000-0000-0000-0000-${String(index).padStart(12,'0')}`,approved_name:name,name,origin_name:name,
    status:'pending',geocoding_success:false,geocoding_false_stage:null,is_missing:false,is_not_selected:false,
    created_at:'2026-01-01T00:00:00Z',lat:null,lng:null,
    youtube_link:`https://youtu.be/${index===1||index===121?'abcdefghijk':String(index).padStart(11,'a')}`,
    youtube_meta:{title:index===1?'경계밖표본':`합성 영상 ${index}`,publishedAt:'2026-01-01T00:00:00Z',duration:600,is_shorts:false,ads_info:{is_ads:false,what_ads:null}},
    evaluation_results:Object.fromEntries(['visit_authenticity','rb_inference_score','review_faithfulness_score','rb_grounding_TF','category_validity_TF','category_TF'].map(key=>[key,{name,eval_value:key.endsWith('TF')?true:1,eval_basis:'합성 검증 근거'}])),
  };
});
let revision='1',firstRace=true,detailRace=false;
let pageRequests=0,detailRequests=0,detailConflicts=0,writes=0,refreshedPageRequests=0;
const errors:string[]=[];
const expectedHttpSignals:number[]=[];
page.on('pageerror',()=>errors.push('pageerror'));
page.on('console',message=>{
  if(message.type()!=='error')return;
  const match=message.text().match(/server responded with a status of (409|503)/);
  const location=message.location().url;
  if(match&&location.startsWith('http://127.0.0.1:18790/api/')
    &&(location.includes('/api/admin/evaluations')||location.includes('/api/admin/system-status'))){
    expectedHttpSignals.push(Number(match[1]));return;
  }
  errors.push('consoleerror');
  console.log(JSON.stringify({operation:'fixture_console_diagnostic',message:message.text().slice(0,300),url:location.split('?')[0]}));
});
await context.addInitScript(()=>{
  localStorage.setItem('tzudong:e2e-admin-shell-bypass','1');
  localStorage.removeItem('adminEvaluationPageState');
});
await context.setExtraHTTPHeaders({'x-e2e-admin-bypass':'1','x-e2e-admin-bypass-token':'fixture-local-performance'});
await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  const fulfill=(body:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body),headers:{'Cache-Control':'private, no-store'}});
  if (!['GET','HEAD','OPTIONS'].includes(request.method())) { writes++; await fulfill({error:'FIXTURE_WRITE_DENIED'},403);return; }
  if (request.resourceType()==='image') { await route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90"><rect width="120" height="90" fill="#ddd"/></svg>'});return; }
  if (url.hostname==='127.0.0.1'&&url.port==='18790'&&url.pathname.startsWith('/api/')) {
    if (url.pathname==='/api/admin/evaluations') {
      pageRequests++;
      if(firstRace){firstRace=false;await fulfill({error:'EVALUATION_CURSOR_STALE'},409);return;}
      const catalog=buildEvaluationCatalog({revision,records:rows});
      if(revision==='2')refreshedPageRequests++;
      const query=parseEvaluationPageQuery(url.searchParams);
      const result=evaluationCatalogPage(catalog,query.query,query.limit,query.cursor);
      const raw=new Map(rows.map(row=>[row.id,row]));
      const warnings=Object.fromEntries(result.records.map(record=>{
        const related=catalog.byVideo.get(extractVideoIdFromYoutubeLink(record.youtube_link)??'')??[];
        const candidates=findSameVideoDuplicateWarningCandidates(record,related);
        return [record.id,{sameVideo:{count:candidates.length,candidates:candidates.slice(0,3),message:formatSameVideoDuplicateWarning(candidates)},identity:findRestaurantIdentityWarnings(record,related)}];
      }));
      await fulfill({...result,records:result.records.map(record=>summarizeEvaluationRecord(raw.get(record.id)!,record)),warnings});return;
    }
    if(url.pathname.startsWith('/api/admin/evaluations/')) {
      detailRequests++;
      if(detailRace){detailRace=false;revision='2';rows[120].status='approved';detailConflicts++;await fulfill({error:'EVALUATION_CURSOR_STALE'},409);return;}
      await fulfill({record:rows.find(row=>row.id===url.pathname.split('/').at(-1))??null});return;
    }
    if(url.pathname==='/api/admin/pending-counts'){await fulfill({counts:{evaluations:121,new:0,edit:0,recommend:0,reviews:0},evaluationPendingCount:121,pendingCount:121});return;}
    if(url.pathname==='/api/dashboard/summary'){await fulfill({totals:{restaurants:121,reviews:0,videos:121},asOf:'2026-01-01T00:00:00Z'});return;}
    if(url.pathname==='/api/admin/system-status'){await fulfill({error:'FIXTURE_NO_LIVE_STATUS'},503);return;}
    await fulfill({records:[],requests:[],data:[],total:0});return;
  }
  if(url.hostname==='127.0.0.1'&&url.port==='18791'){await fulfill([]);return;}
  if(url.hostname!=='127.0.0.1'&&url.hostname!=='localhost'){await fulfill({});return;}
  await route.continue();
});
console.log(JSON.stringify({operation:'browser_fixture_installed',rows:121,apiWritesAllowed:false}));
const lines=readline.createInterface({input:process.stdin});
for await(const command of lines){
  if(command==='measure'||command==='verify'){
    const observations:Array<{repeat:number;wallMs:number}>=command==='verify'
      ? JSON.parse(readFileSync('performance/pipeline-20261002/browser-revision-navigation-raw.json','utf8')).observations : [];
    if(command==='measure'){
    for(let repeat=0;repeat<100;repeat++){
      const started=performance.now();
      await page.goto('http://127.0.0.1:18790/admin?module=restaurants',{waitUntil:'domcontentloaded'});
      await page.locator('input[placeholder="상호·영상 ID 검색..."]').waitFor();
      await page.getByText('현 121개 레코드',{exact:false}).first().waitFor();
      observations.push({repeat,wallMs:performance.now()-started});
      if((repeat+1)%20===0)console.log(JSON.stringify({samples:repeat+1,errors:errors.length}));
    }
    writeFileSync('performance/pipeline-20261002/browser-revision-navigation-raw.json',JSON.stringify({kind:'local_browser_navigation_only',liveEvidenceEligible:false,baselineAvailable:false,samples:100,errorCount:errors.length,observations},null,2)+'\n');
    }
    await page.goto('http://127.0.0.1:18790/admin?module=restaurants',{waitUntil:'domcontentloaded'});
    await page.getByText('현 121개 레코드',{exact:false}).first().waitFor();
    const field=page.locator('input[placeholder="상호·영상 ID 검색..."]');
    await field.fill('경계밖표본');
    await page.waitForFunction(()=>document.querySelectorAll('tbody tr').length===1);
    await field.fill('');
    await page.waitForFunction(()=>document.querySelectorAll('tbody tr').length===50);
    detailRace=true;
    const readonlyButton=page.locator('tbody tr').first().getByRole('button',{name:'행 펼치기'});
    await readonlyButton.click();
    await page.waitForFunction(()=>{
      const text=document.querySelector('tbody tr')?.textContent??'';
      return !text.includes('미처리')&&/승인|완료/.test(text);
    });
    if(detailConflicts!==1||revision!=='2'||refreshedPageRequests<1)throw new Error('DETAIL_REVISION_RELOAD_NOT_VERIFIED');
    const result={kind:'local_browser_revision_fixture',liveEvidenceEligible:false,baselineAvailable:false,
      fixtureSha256:createHash('sha256').update(JSON.stringify(rows)).digest('hex'),samples:100,errorCount:errors.length,expectedHttpSignals,
      pageRequests,detailRequests,detailConflicts,refreshedPageRequests,writes,firstPageRaceRecovered:true,outsideFirstPageSearchVerified:true,
      observations};
    writeFileSync('performance/pipeline-20261002/browser-revision-raw.json',JSON.stringify(result,null,2)+'\n');
    await page.screenshot({path:'performance/pipeline-20261002/admin-revision-fixture.png',fullPage:false});
    console.log(JSON.stringify({operation:'browser_revision_verification',status:errors.length?'failed':'passed',samples:100,errors:errors.length,detailConflicts,writes}));
  }
  if(command==='stop'){lines.close();break;}
}
// Browser ownership belongs to the named agent-browser session; this connection
// is left for the owning CLI to close after its final screen/error inspection.
process.exitCode=errors.length?1:0;
publicFixture.stop();
process.exit();
