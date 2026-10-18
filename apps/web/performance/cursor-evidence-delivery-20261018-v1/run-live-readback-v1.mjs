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
  const row={viewport,sdkResponses:[],pageErrors:[],consoleErrorCount:0,flows:[]};
  page.on('response',r=>{const u=new URL(r.url());if(u.hostname==='oapi.map.naver.com'&&u.pathname.endsWith('/maps.js'))row.sdkResponses.push({host:u.hostname,path:u.pathname,status:r.status()})});
  page.on('pageerror',e=>row.pageErrors.push(createHash('sha256').update(e.message).digest('hex')));
  page.on('console',m=>{if(m.type()==='error')row.consoleErrorCount++});
  await page.goto('https://www.tzudong.app/',{waitUntil:'domcontentloaded',timeout:45000});
  await expect(page.locator('main#main-content')).toBeVisible({timeout:30000});
  const map=page.getByTestId('map-container');
  await expect(map).toBeVisible({timeout:30000});
  await expect.poll(()=>page.evaluate(()=>Boolean(window.naver?.maps?.Map)),{timeout:30000}).toBe(true);
  const tiles=map.locator('img');await expect.poll(()=>tiles.count(),{timeout:30000}).toBeGreaterThan(0);
  const sdk=await page.evaluate(()=>({apiAvailable:typeof window.naver?.maps?.Map==='function',mapCount:document.querySelectorAll('[data-testid="map-container"]').length}));
  row.flows.push({name:'home-real-naver',...sdk,tileImageCount:await tiles.count()});
  for(const path of ['/feed','/stamp','/leaderboard']){
   await page.goto(`https://www.tzudong.app${path}`,{waitUntil:'domcontentloaded',timeout:45000});
   await expect(page.locator('main#main-content')).toBeVisible({timeout:30000});
   const failed=page.getByText('랭킹 데이터를 불러오지 못했습니다',{exact:false});
   if(path==='/leaderboard')await expect(failed).toHaveCount(0,{timeout:20000});
   // Save structural success/heading presence, never row bodies/profiles.
   row.flows.push({name:path,mainVisible:true,headingCount:await page.locator('h1,h2').count(),documentOverflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)});
  }
  if(phase==='after'){
   const response=await context.request.get('https://www.tzudong.app/api/public-popularity');
   expect(response.status()).toBe(200);const p=await response.json();
   expect(p).toEqual({schemaVersion:1,publicationVersion:'unpublished',sourceRevision:null,entries:[]});
   row.publicPublication={status:response.status(),publicationVersion:p.publicationVersion,count:p.entries.length};
  }
  result.viewports.push(row);await context.close();
 }
 result.status='passed';
}catch(e){result.status='failed';result.failure=String(e);throw e}
finally{await writeFile(new URL(`live-readback-${phase}-v1.json`,root),JSON.stringify(result,null,2)+'\n');await browser.close()}
console.log(JSON.stringify(result));
