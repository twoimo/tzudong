import { chromium } from '@playwright/test';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const out=resolve('performance/public-cms-followthrough-20261009/share-http-status-followup');
const browser=await chromium.launch({headless:true,executablePath:'/Users/twoimo/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'});
const report={scope:'owned dev/production fixture plus actual checkout dev; controlled read responses',cases:[]};
try{
 for(const env of [{name:'checkout-development',port:19872,paths:['/s/invalid-code','/s/Zz00Qq']},{name:'fixture-development',port:20370,paths:['/legacy/invalid-code','/legacy/FAIL00','/notice/invalid-code','/notice/MISSNG','/notice/FAIL00','/s/invalid-code','/s/MISSNG','/s/FAIL00','/s/VALID1','/s/BADURL']},{name:'fixture-production',port:20371,paths:['/legacy/invalid-code','/legacy/FAIL00','/notice/invalid-code','/notice/MISSNG','/notice/FAIL00','/s/invalid-code','/s/MISSNG','/s/FAIL00','/s/VALID1','/s/BADURL']}]){
  for(const path of env.paths){
   const result={environment:env.name,path};
   const url=`http://127.0.0.1:${env.port}${path}`;
   const response=await fetch(url,{redirect:'manual'});result.status=response.status;result.location=response.headers.get('location');result.robotsHeader=response.headers.get('x-robots-tag');
   if(result.status!==307){
    const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
    await context.route('**/*',route=>{const req=route.request(),u=new URL(req.url());return u.origin===`http://127.0.0.1:${env.port}`&&!u.pathname.startsWith('/api/')&&['GET','HEAD'].includes(req.method())?route.continue():route.fulfill({status:503,json:{code:'fixture_no_authority'}});});
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push({name:error.name,measureFrames:!!error.stack?.includes('flushComponentPerformance')}));
    await page.goto(url,{waitUntil:'domcontentloaded'});await page.waitForLoadState('networkidle',{timeout:3000}).catch(()=>{});
    result.pageErrors=errors;result.shareState=await page.locator('[data-share-read-state]').getAttribute('data-share-read-state').catch(()=>null);result.robotsMeta=await page.locator('meta[name="robots"]').first().getAttribute('content').catch(()=>null);
    await page.addStyleTag({content:'nextjs-portal{display:none!important}'});result.screenshot=`${env.name}-${path.replaceAll('/','_')}.png`;await page.screenshot({path:resolve(out,result.screenshot)});await context.close();
   }
   report.cases.push(result);writeFileSync(resolve(out,'http-comparison.json'),JSON.stringify(report,null,2)+'\n');console.log(`${env.name} ${path} ${result.status} errors=${result.pageErrors?.length??'redirect'}`);
  }
 }
}finally{await browser.close();}
