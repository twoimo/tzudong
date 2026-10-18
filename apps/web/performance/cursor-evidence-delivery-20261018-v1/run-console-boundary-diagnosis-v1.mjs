import { chromium,expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const [phase,sha]=process.argv.slice(2);if(!['before','after'].includes(phase)||!/^[a-f0-9]{40}$/.test(sha))throw Error('INVALID_INPUT');
const health=await fetch('https://www.tzudong.app/api/health',{cache:'no-store'}).then(r=>r.json());if(health.gitSha!==sha)throw Error('LIVE_SHA_CHANGED');
const browser=await chromium.launch();const context=await browser.newContext({viewport:{width:1440,height:900},permissions:[]});
const page=await context.newPage();const resources=[];
page.on('response',r=>{if(r.status()>=400){const u=new URL(r.url());resources.push({host:u.hostname,status:r.status(),type:r.request().resourceType()})}});
await page.addInitScript(()=>{window.__violations=[];window.addEventListener('securitypolicyviolation',e=>{
 const blocked=e.blockedURI;let target;try{target=new URL(blocked).hostname}catch{target=['inline','eval','self'].includes(blocked)?blocked:'other'}
 window.__violations.push({directive:e.effectiveDirective,target,disposition:e.disposition});
})});
const rows=[];
try{for(const path of ['/','/feed','/leaderboard']){
 await page.goto('https://www.tzudong.app'+path,{waitUntil:'domcontentloaded'});
 if(path==='/')await expect(page.getByTestId('map-container')).toBeVisible({timeout:30000});
 else await expect(page.getByRole('heading',{name:path==='/feed'?/^(?:쯔동여지도 )?리뷰(?:\s|$)/:/^(?:쯔동여지도 )?랭킹(?:\s|$)/})).toBeVisible({timeout:30000});
 await page.waitForTimeout(1500);
 rows.push({route:path,csp:await page.evaluate(()=>window.__violations)});
}const result={phase,gitSha:sha,scope:'anonymous desktop diagnostic, 1.5s bounded observation after readiness/heading; no source URLs/query/body/session data persisted',rows,resources};await writeFile(new URL(`console-boundary-${phase}-v1.json`,import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result))}finally{await browser.close()}
