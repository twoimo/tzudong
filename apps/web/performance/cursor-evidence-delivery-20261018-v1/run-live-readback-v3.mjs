import { chromium,expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const [phase,expectedSha]=process.argv.slice(2);
if(!/^(before|after)$/.test(phase)||!/^[a-f0-9]{40}$/.test(expectedSha))throw Error('INVALID_READBACK_INPUT');
const root=new URL('.',import.meta.url);
const browser=await chromium.launch();
const result={phase,expectedSha,scope:'anonymous public production functional readback; no phone, account mutation, performance comparison or field claim',browser:browser.version(),viewports:[]};
try {
 const health=await fetch('https://www.tzudong.app/api/health').then(r=>r.json());
 expect(health.gitSha).toBe(expectedSha);expect(health.projectId).toBe('prj_sau35J5uUtShIQ9OKofRtOVVnTSl');
 result.health={ok:health.ok,gitSha:health.gitSha,deploymentId:health.deploymentId,projectId:health.projectId};
 for(const viewport of [{width:1440,height:900},{width:834,height:1112},{width:430,height:860}]){
  const context=await browser.newContext({viewport,permissions:[]});const page=await context.newPage();
  const row={viewport,sdkResponses:[],pageErrors:[],consoleErrorCount:0,consoleCategories:{},publicLeaderboardResponses:[],flows:[]};
  page.on('response',r=>{const u=new URL(r.url());if(u.hostname==='oapi.map.naver.com'&&u.pathname.endsWith('/maps.js'))row.sdkResponses.push({host:u.hostname,path:u.pathname,status:r.status()})});
  page.on('pageerror',e=>row.pageErrors.push(createHash('sha256').update(e.message).digest('hex')));
  page.on('console',m=>{if(m.type()==='error'){
   row.consoleErrorCount++;const text=m.text();
   const kind=/Content Security Policy|violates.*directive/i.test(text)?'csp':/Failed to load resource/i.test(text)?'resource':/WebSocket/i.test(text)?'websocket':'unclassified';
   row.consoleCategories[kind]=(row.consoleCategories[kind]||0)+1;
  }});
  page.on('response',r=>{const u=new URL(r.url());if(/\/rest\/v1\/rpc\/read_public_profile_leaderboard(?:_page)?$/.test(u.pathname))row.publicLeaderboardResponses.push({status:r.status()})});
  await page.goto('https://www.tzudong.app/',{waitUntil:'domcontentloaded',timeout:45000});
  await expect(page.locator('main#main-content')).toBeVisible({timeout:30000});
  const map=page.getByTestId('map-container');
  await expect(map).toBeVisible({timeout:30000});
  await expect.poll(()=>page.evaluate(()=>Boolean(window.naver?.maps?.Map)),{timeout:30000}).toBe(true);
  const tiles=map.locator('img');await expect.poll(()=>tiles.count(),{timeout:30000}).toBeGreaterThan(0);
  const sdk=await page.evaluate(()=>({apiAvailable:typeof window.naver?.maps?.Map==='function',mapCount:document.querySelectorAll('[data-testid="map-container"]').length}));
  row.flows.push({name:'home-real-naver',...sdk,tileImageCount:await tiles.count()});
  // Use actual public marker DOM, not an injected map or synthetic data.
  const markers=map.getByTestId('marker');
  let clusterOpens=0;
  while(await markers.count()===0 && clusterOpens<4){
   const clusters=map.locator('.cluster-marker-container');
   await expect(clusters.first()).toBeVisible({timeout:15000});
   await clusters.first().click();clusterOpens++;
   await expect.poll(async()=>await markers.count()+await clusters.count(),{timeout:15000}).toBeGreaterThan(0);
  }
  await expect(markers.first()).toBeVisible({timeout:20000});
  await markers.first().click();
  const detail=page.getByTestId('restaurant-detail-panel');
  await expect(detail).toBeVisible({timeout:30000});
  await expect(detail.getByRole('heading',{level:2})).toBeVisible();
  const detailOpen=Boolean(new URL(page.url()).searchParams.get('restaurant'));
  expect(detailOpen).toBe(true);
  await detail.getByRole('button',{name:/^(?:맛집 상세 닫기|이전 목록으로 돌아가기|이전 화면으로 돌아가기)$/}).click();
  await expect(detail).toHaveCount(0,{timeout:20000});
  row.flows.push({name:'real-marker-detail-open-close',clusterOpens,detailVisible:true,selectionUrlPresent:detailOpen,closed:true});
  for(const path of ['/feed','/stamp','/leaderboard']){
   await page.goto(`https://www.tzudong.app${path}`,{waitUntil:'domcontentloaded',timeout:45000});
   await expect(page.locator('main#main-content')).toBeVisible({timeout:30000});
   const label=path==='/feed'?'리뷰':path==='/stamp'?'도장':'랭킹';
   const heading=page.getByRole('heading',{name:new RegExp(`^(?:쯔동여지도 )?${label}(?:\\s|$)`)});
   await expect(heading).toBeVisible({timeout:30000});
   if(path==='/leaderboard'){
    await expect.poll(()=>row.publicLeaderboardResponses.length,{timeout:30000}).toBeGreaterThan(0);
    await expect(page.locator('[data-mobile-leaderboard-panel-list] .animate-pulse')).toHaveCount(0,{timeout:30000});
   }
   const failed=page.getByText('랭킹 데이터를 불러오지 못했습니다',{exact:false});
   if(path==='/leaderboard')await expect(failed).toHaveCount(0,{timeout:20000});
   // Save structural success/heading presence, never row bodies/profiles.
   row.flows.push({name:path,mainVisible:true,headerVisible:true,headingCount:await page.locator('h1,h2').count(),documentOverflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)});
  }
  if(phase==='after'){
   const response=await context.request.get('https://www.tzudong.app/api/public-popularity');
   expect(response.status()).toBe(200);const p=await response.json();
   expect(p).toEqual({schemaVersion:2,publicationVersion:'unpublished',sourceRevision:null,entries:[]});
   row.publicPublication={status:response.status(),publicationVersion:p.publicationVersion,count:p.entries.length};
  }
  result.viewports.push(row);await context.close();
 }
 expect(result.viewports.every(r=>r.pageErrors.length===0&&r.publicLeaderboardResponses.every(x=>x.status===200))).toBe(true);
 result.status='passed';
}catch(e){result.status='failed';result.failure=String(e);throw e}
finally{await writeFile(new URL(`live-readback-${phase}-v3.json`,root),JSON.stringify(result,null,2)+'\n');await browser.close()}
console.log(JSON.stringify(result));
