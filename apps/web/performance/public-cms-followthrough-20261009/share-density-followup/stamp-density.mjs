import { chromium, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
const stage=process.env.DENSITY_STAGE??'before',out=resolve('performance/public-cms-followthrough-20261009/share-density-followup');
const browser=await chromium.launch({headless:true,executablePath:'/Users/twoimo/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'});const results=[];
try{for(const viewport of [{id:'tablet',width:820,height:1180},{id:'mobile',width:390,height:844}]){
 const context=await browser.newContext({viewport,reducedMotion:'reduce'});
 await context.route('**/*',route=>{const req=route.request(),url=new URL(req.url());return url.origin==='http://127.0.0.1:19872'&&!url.pathname.startsWith('/api/')&&['GET','HEAD'].includes(req.method())?route.continue():route.fulfill({status:503,json:{code:'local_read_only_check'}});});
 const page=await context.newPage();await page.goto('http://127.0.0.1:19872/stamp',{waitUntil:'domcontentloaded'});
 const alert=page.getByRole('alert').filter({hasText:'도장 맛집을 불러오지 못했습니다'});await expect(alert).toBeVisible({timeout:20000});await expect(alert.getByRole('button',{name:'다시 시도'})).toBeVisible();await page.addStyleTag({content:'nextjs-portal{display:none!important}'});
 const bounds=await alert.boundingBox();await page.screenshot({path:resolve(out,`stamp-${stage}-${viewport.id}.png`)});results.push({viewport:viewport.id,bounds,overflowX:await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)});await context.close();
}}finally{await browser.close();writeFileSync(resolve(out,`stamp-density-${stage}.json`),JSON.stringify(results,null,2)+'\n');}
console.log(JSON.stringify(results));
