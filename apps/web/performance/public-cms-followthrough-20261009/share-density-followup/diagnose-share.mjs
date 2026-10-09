import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const out=resolve('performance/public-cms-followthrough-20261009/share-density-followup');
const browser=await chromium.launch({headless:true,executablePath:'/Users/twoimo/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'});
const results=[];
try{for(const path of ['/s/audit-invalid-code','/s/Zz00Qq']){
 const context=await browser.newContext({viewport:{width:390,height:844}});
 await context.routeWebSocket('**/*',route=>{if(new URL(route.url()).hostname==='127.0.0.1')route.connectToServer();else route.close();});
 await context.route('**/*',route=>{const req=route.request(),url=new URL(req.url());return url.origin==='http://127.0.0.1:19872'&&!url.pathname.startsWith('/api/')&&['GET','HEAD'].includes(req.method())?route.continue():route.fulfill({status:503,json:{code:'local_read_only_check'}});});
 const page=await context.newPage(),errors=[];
 page.on('pageerror',error=>{
  const property=error.message.match(/reading ['"]([A-Za-z_][A-Za-z0-9_]{0,63})['"]/)?.[1]??null;
  const frames=(error.stack?.match(/(?:webpack-internal:\/\/\/[^\n)]+|\/Users\/twoimo\/\.codex\/worktrees\/[^\n)]+|http:\/\/127\.0\.0\.1:19872\/[^\n)]+)/g)??[]).map(frame=>frame.split('?')[0]).slice(0,4);
  const classification=/Cannot read properties of undefined/.test(error.message)?'read_property_of_undefined':/Cannot read properties of null/.test(error.message)?'read_property_of_null':/Cannot convert undefined or null/.test(error.message)?'null_object_conversion':/Failed to fetch|fetch failed/.test(error.message)?'fetch_failed':/is not a function/.test(error.message)?'not_a_function':'unclassified';
  errors.push({name:error.name,classification,property,frames});
 });
 const response=await page.goto(`http://127.0.0.1:19872${path}`,{waitUntil:'domcontentloaded',timeout:45000});
 await page.waitForLoadState('networkidle',{timeout:4000}).catch(()=>{});await page.addStyleTag({content:'nextjs-portal{display:none!important}'});
 await page.screenshot({path:resolve(out,`before-${results.length+1}.png`)});
 results.push({path,status:response.status(),errors});await context.close();
}}finally{await browser.close();writeFileSync(resolve(out,'diagnosis.json'),JSON.stringify(results,null,2)+'\n');}
console.log(JSON.stringify(results));
