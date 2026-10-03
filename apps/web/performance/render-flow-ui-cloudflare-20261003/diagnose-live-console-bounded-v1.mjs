import {chromium} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true}),result={observedAt:new Date().toISOString(),sourceSha:'3aebb1c6f446250fd49fceac5f1a4ccac2f5d8f0',rawBodiesHeadersQueriesMessagesRetained:false,cases:[]};
function resourceClass(address){
 try{const u=new URL(address),p=u.pathname;
  if(p.startsWith('/auth/v1/'))return 'supabase_auth';
  if(p.startsWith('/rest/v1/'))return 'supabase_public_rest';
  if(p.startsWith('/_vercel/'))return 'optional_vercel_metrics';
  if(p.startsWith('/api/performance/'))return 'app_field_metric';
  if(p.startsWith('/api/'))return 'app_api';
  if(/naver|pstatic/.test(u.hostname))return 'naver_public_sdk_tiles';
  if(p.startsWith('/_next/'))return 'compiled_app_asset';
  if(p.startsWith('/logo-png-'))return 'public_png';
  return 'other_public_resource';
 }catch{return 'unclassified_resource';}
}
try{
 for(const [name,width,height,mobile] of [['desktop',1440,900,false],['mobile',384,824,true]]){
  const context=await browser.newContext({viewport:{width,height},isMobile:mobile,hasTouch:mobile,serviceWorkers:'block',locale:'ko-KR'}),page=await context.newPage(),row={name,httpErrors:[],consoleCodes:[],requestFailures:[],pageErrors:0};
  page.on('response',r=>{if(r.status()>=400)row.httpErrors.push({class:resourceClass(r.url()),status:r.status(),method:r.request().method()});});
  page.on('requestfailed',r=>row.requestFailures.push({class:resourceClass(r.url()),method:r.method()}));
  page.on('pageerror',()=>row.pageErrors++);
  page.on('console',m=>{if(m.type()!=='error')return;const t=m.text();row.consoleCodes.push({code:/Content Security Policy|violates.*directive|Refused to (?:load|connect|apply|execute)/i.test(t)?'csp_block':/Failed to load resource/i.test(t)?'http_resource_error':/Auth session missing|AuthSessionMissing/i.test(t)?'auth_session_absent':/Failed to fetch|NetworkError/i.test(t)?'network_error':'other_console_error',source:resourceClass(m.location().url)});});
  await page.goto('https://www.tzudong.app/?__qa=console-release-diagnostic',{waitUntil:'domcontentloaded',timeout:45000});
  await page.waitForFunction(()=>!!window.naver?.maps?.Map&&document.querySelectorAll('.cluster-marker-container,[data-testid="marker"]').length>0,null,{timeout:60000});
  await page.waitForTimeout(6000);result.cases.push(row);console.log(JSON.stringify(row));await context.close();
 }
}finally{await browser.close();await writeFile(new URL('live-console-bounded-v1.json',import.meta.url),JSON.stringify(result,null,2)+'\n',{flag:'wx'});}
