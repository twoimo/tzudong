import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const root='/Users/twoimo/.codex/worktrees/pipeline-performance-20261002/tzudong/apps/web';
const out=join(root,'performance/ui-renewal-20261003/cms-project-library-integrated-20261005');
const require=createRequire(join(root,'package.json')),{chromium,expect}=require('@playwright/test');
const hash=value=>createHash('sha256').update(value).digest('hex');
const originalBytes=readFileSync(join(out,'verification.json')),original=JSON.parse(originalBytes),originalSha=hash(originalBytes);
assert.equal(originalSha,'30d02be93739d9a394dbcc6bb88a14d5534e8a984c64231d8f204f71c3e7fa71');
const sources=()=>original.sourceEnd.map(({path})=>({path,sha256:hash(readFileSync(join(root,path)))}));
assert.deepEqual(sources(),original.sourceEnd);
const origin='http://127.0.0.1:18812',fake='http://127.0.0.1:18811',API='/api/admin/storyboard/production';
const stamp='2026-10-05T01:00:00.000Z',ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'];
let phase='bootstrap',mode='normal',mutationsDenied=0,externalDenied=0,pageErrors=0,syntheticReadPosts=0,passed=false;
const transactions=[],consoleEvents=[],checks=[],startedAt=new Date().toISOString();
const requestTransactions=new WeakMap(),deniedRequestsByUrl=new Map();
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const context=await browser.newContext({viewport:{width:834,height:1000},reducedMotion:'reduce',serviceWorkers:'block'});
await context.addInitScript(()=>{localStorage.setItem('tzudong:e2e-admin-shell-bypass','1');localStorage.setItem('tzudong-admin-theme','light');localStorage.setItem('tzudong-admin-sidebar-collapsed','false');});
await context.route('**/*',async route=>{
 const request=route.request(),url=new URL(request.url()),method=request.method();
 const fulfill=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
 if(![origin,fake].includes(url.origin)){
  externalDenied++;deniedRequestsByUrl.set(request.url(),{requestId:`denied-${externalDenied}`,phase,resourceType:request.resourceType()});await route.abort('blockedbyclient');return;
 }
 const readPosts=new Set([fake+'/rest/v1/rpc/get_current_privacy_eligibility',fake+'/rest/v1/rpc/is_current_auth_session_active',fake+'/rest/v1/rpc/read_public_profile_summaries',origin+'/api/admin/profile-summaries']);
 if(method==='POST'&&readPosts.has(url.href)){
  syntheticReadPosts++;
  if(url.pathname.endsWith('get_current_privacy_eligibility'))return fulfill({schemaVersion:1,eligible:true,reasonCode:'PRIVACY_ELIGIBLE',policyVersionId:'00000000-0000-4000-8000-000000000001',policyVersion:'2026-08-04.1',contentSha256:'6e42ced065a6ea0762b85d9b5e11500fcfc535543ab50d12ffbe6490086a110b'});
  if(url.pathname.endsWith('is_current_auth_session_active'))return fulfill(true);
  const body=request.postDataJSON(),wanted=body.userIds??body.p_user_ids??[];assert(Array.isArray(wanted)&&wanted.length<=100);
  return fulfill(url.pathname==='/api/admin/profile-summaries'?{rows:wanted.map(userId=>({userId,nickname:'합성 검증 사용자'}))}:wanted.map(user_id=>({user_id,nickname:'합성 검증 사용자',avatar_url:null})));
 }
 if(!['GET','HEAD','OPTIONS'].includes(method)){mutationsDenied++;return fulfill({code:'CONSOLE_REPLAY_WRITE_DENIED'},403);}
 if(url.origin===origin&&url.pathname===API&&method==='GET'){
  const transaction={requestId:`catalog-${transactions.length+1}`,phase,endpoint:API,method:'GET',injectedStatus:mode==='failure'?503:200,observedStatus:null};transactions.push(transaction);requestTransactions.set(request,transaction);
  if(mode==='failure')return fulfill({ok:false,errorCode:'unavailable'},503);
  return fulfill({ok:true,projects:ids.map((id,index)=>({id,title:index?'부산 합성 기획':'서울 합성 기획',revision:1,status:index?'failed':'partial',createdAt:stamp,updatedAt:stamp})),workers:[]});
 }
 await route.continue();
});
await context.routeWebSocket('**/*',socket=>{const url=new URL(socket.url());if(url.origin===origin.replace('http:','ws:')&&url.pathname.startsWith('/_next/'))socket.connectToServer();else{externalDenied++;socket.close();}});
const page=await context.newPage();page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(45000);
page.on('pageerror',()=>pageErrors++);
page.on('response',response=>{const transaction=requestTransactions.get(response.request());if(transaction)transaction.observedStatus=response.status();});
page.on('console',event=>{
 if(event.type()!=='error')return;
 const location=event.location().url??'',text=event.text();
 const catalogLocation=location===origin+API,transaction=catalogLocation?transactions.at(-1):null,denied=deniedRequestsByUrl.get(location);
 consoleEvents.push({eventId:`console-${consoleEvents.length+1}`,phase,category:'unverified',requestId:transaction?.requestId??denied?.requestId??null,endpoint:catalogLocation?API:denied?'external-blocked':'unverified',matchesBrowserResourceFailure:/^Failed to load resource/.test(text),containsStatus503:/\b503\b/.test(text),matchesBlockedByClient:/ERR_BLOCKED_BY_CLIENT/.test(text),catalogLocationExact:catalogLocation,deniedResourceType:denied?.resourceType??null});
});
try{
 await page.goto(origin+'/__fixture/session',{waitUntil:'domcontentloaded'});
 await page.goto(origin+'/admin?module=storyboard',{waitUntil:'domcontentloaded'});
 const list=page.getByRole('list',{name:'저장된 프로젝트 목록',exact:true}),refresh=page.getByRole('button',{name:'프로젝트 목록 다시 불러오기',exact:true});
 await expect(list.getByRole('button')).toHaveCount(2);await expect(refresh).toBeEnabled();
 phase='ready_baseline';await page.waitForTimeout(250);checks.push({phase,consoleErrorCount:consoleEvents.length});
 phase='injected_catalog_503';mode='failure';await refresh.click();
 await expect(page.getByRole('alert').filter({hasText:'프로젝트 목록을 불러오지 못했습니다.'})).toBeVisible();await expect(list.getByRole('button')).toHaveCount(2);
 await expect.poll(()=>consoleEvents.filter(event=>event.phase==='injected_catalog_503').length).toBe(1);
 checks.push({phase,staleRowsRetained:true,consoleErrorCount:consoleEvents.filter(event=>event.phase===phase).length});
 phase='recovery';mode='normal';await refresh.click();await expect(refresh).toBeEnabled();await expect(page.getByRole('alert').filter({hasText:'프로젝트 목록을 불러오지 못했습니다.'})).toHaveCount(0);await expect(list.getByRole('button')).toHaveCount(2);await page.waitForTimeout(250);
 checks.push({phase,recovered:true,consoleErrorCount:consoleEvents.filter(event=>event.phase===phase).length});
 for(const event of consoleEvents){const transaction=transactions.find(row=>row.requestId===event.requestId);if(event.phase==='injected_catalog_503'&&event.catalogLocationExact&&event.matchesBrowserResourceFailure&&event.containsStatus503&&transaction?.injectedStatus===503&&transaction.observedStatus===503)event.category='expected_synthetic_catalog_http_503';else if(event.matchesBlockedByClient&&event.endpoint==='external-blocked')event.category='denied_external_fixture_request';}
 assert.equal(consoleEvents.length,1);assert.equal(consoleEvents[0].category,'expected_synthetic_catalog_http_503');assert.equal(mutationsDenied,0);assert.equal(pageErrors,0);assert.deepEqual(sources(),original.sourceEnd);assert.equal(hash(readFileSync(join(out,'verification.json'))),originalSha);passed=true;
}catch(error){console.log(JSON.stringify({status:'failed',phase,errorType:error?.name??'Error',assertion:error?.matcherResult?.name??null}));process.exitCode=1;}
finally{
 const report={schema:'tzudong-storyboard-console-classification-v1',passed,startedAt,finishedAt:new Date().toISOString(),scope:'One targeted catalog failure and recovery replay at 834px; no repeated three-width checks.',originalReceipt:{path:'verification.json',sha256:originalSha,unchanged:hash(readFileSync(join(out,'verification.json')))===originalSha,reportedConsoleErrors:original.safety.consoleErrors,reportedPageErrors:original.safety.pageErrors,retainedEventMetadata:false,individualEventClassification:'unverified',reasonCode:'ORIGINAL_RECEIPT_HAS_AGGREGATE_COUNTS_ONLY'},replay:{checks,transactions,consoleEvents,counts:{expectedSyntheticCatalogHttp503:consoleEvents.filter(row=>row.category==='expected_synthetic_catalog_http_503').length,deniedExternalFixtureConsoleErrors:consoleEvents.filter(row=>row.category==='denied_external_fixture_request').length,unverifiedConsoleErrors:consoleEvents.filter(row=>row.category==='unverified').length,pageErrors}},safety:{actualOperatingWrites:0,providerCalls:0,forwardedPosts:0,deniedNonreadAttempts:mutationsDenied,externalRequestsBlocked:externalDenied,syntheticReadPostsFulfilled:syntheticReadPosts},sourceStable:JSON.stringify(sources())===JSON.stringify(original.sourceEnd),sources:sources(),inference:{code:'REPLAY_SUPPORTS_EXPECTED_503_EXPLANATION_WITHOUT_RETROACTIVE_EVENT_PROOF',originalEventAttributionVerified:false},runnerSha256:hash(readFileSync(new URL(import.meta.url))),browser:browser.version(),node:process.version};
 const encoded=JSON.stringify(report,null,2)+'\n';writeFileSync(join(out,'console-classification.json'),encoded);writeFileSync(join(out,'console-classification.json.sha256'),hash(encoded)+'  console-classification.json\n');await browser.close();console.log(JSON.stringify({passed,receipt:join(out,'console-classification.json'),sha256:hash(encoded),originalReceiptUnchanged:report.originalReceipt.unchanged,replayConsoleClassifications:report.replay.counts,originalTwoConsoleEvents:'unverified-individually'}));
}
