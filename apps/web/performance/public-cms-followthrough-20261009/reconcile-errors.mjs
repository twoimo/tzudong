import { chromium } from '@playwright/test';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
const browser = await chromium.launch({ headless:true, executablePath:'/Users/twoimo/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' });
const results=[];
try { for(const path of ['/global-map','/privacy/onboarding','/s/audit-invalid-code']) {
 const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 await context.routeWebSocket('**/*',ws=>{if(new URL(ws.url()).hostname==='127.0.0.1')ws.connectToServer();else ws.close();});
 await context.route('**/*',route=>{const request=route.request(),url=new URL(request.url());return url.origin==='http://127.0.0.1:19872'&&!url.pathname.startsWith('/api/')&&['GET','HEAD'].includes(request.method())?route.continue():route.fulfill({status:503,json:{code:'local_read_only_check'}});});
 const page=await context.newPage(),errors=[];
 page.on('pageerror',error=>{const text=error.message;errors.push({name:error.name,classification:/NEXT_HTTP_ERROR_FALLBACK.*404|NEXT_NOT_FOUND/.test(text)?'next_not_found_boundary':/NEXT_REDIRECT/.test(text)?'next_redirect_boundary':/hydration|#418/i.test(text)?'hydration':/Failed to fetch|fetch failed|NetworkError/.test(text)?'read_unavailable':/ChunkLoadError|Loading chunk/.test(text)?'chunk_load_failure':'unclassified_client_exception',localFrames:(error.stack?.match(/http:\/\/127\.0\.0\.1:19872\/[^\s)]+/g)??[]).map(frame=>frame.split('?')[0]).slice(0,3)});});
 const response=await page.goto(`http://127.0.0.1:19872${path}`,{waitUntil:'domcontentloaded'});await page.waitForLoadState('networkidle',{timeout:4000}).catch(()=>{});
 await page.addStyleTag({content:'nextjs-portal{display:none!important}'});
 await page.screenshot({path:resolve(`performance/public-cms-followthrough-20261009/error-recheck-${results.length+1}.png`)});
 results.push({path,status:response.status(),errors});await context.close();
 }}finally{await browser.close();writeFileSync(resolve('performance/public-cms-followthrough-20261009/error-reconciliation.json'),JSON.stringify(results,null,2)+'\n');}
console.log(JSON.stringify(results));
