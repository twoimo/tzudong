import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const candidate='/Users/twoimo/.codex/worktrees/pipeline-performance-20261002/tzudong/apps/web';
const runtime='/Users/twoimo/.codex/worktrees/pipeline-final-readiness/tzudong/apps/web';
const work='/var/folders/8d/nwv_19w124zbq0dxqx2r1jn40000gn/T/tzudong-storyboard-integrated-20261005-3pqq2n5m';
const out=join(candidate,'performance/ui-renewal-20261003/cms-project-library-integrated-20261005');
mkdirSync(out,{recursive:true});
const require=createRequire(join(candidate,'package.json'));
const {chromium,expect}=require('@playwright/test');
const hash=value=>createHash('sha256').update(value).digest('hex');
const sourcePaths=['components/admin/storyboard/LocalStoryboardWorkspace.tsx','components/admin/storyboard/StoryboardProjectLibrary.tsx','tests-unit/storyboard-project-library-browser.test.ts'];
const expected=['839664b908b4e41ddb8d8565a509f4bb0bd1359aa62a1396753d7db91415ac53','87c4e55b5726d25f1528be30f47b75306c6669cab92b19c75a0cd0b52b4f8c45','37979ae0d436d207ffdc17062dcafc83e736986c99dfc7ab6c3b872da7b89788'];
const readSources=()=>sourcePaths.map(path=>({path,sha256:hash(readFileSync(join(candidate,path)))}));
const sourceStart=readSources();
assert.deepEqual(sourceStart.map(source=>source.sha256),expected);
const boundaryPaths=[...sourcePaths.slice(0,2),'components/admin/AdminConsoleOverview.tsx','components/admin/AdminPageHeader.tsx','components/admin/AdminEmbeddedModuleShell.tsx','components/admin/storyboard/AdminStoryboardGenerator.tsx','styles/admin-ui.css','app/admin/layout.tsx','app/admin/page.tsx','lib/admin/admin-module-routing.ts'];
const boundary=()=>boundaryPaths.filter(path=>existsSync(join(candidate,path))&&existsSync(join(runtime,path))).map(path=>{const candidateSha256=hash(readFileSync(join(candidate,path))),runtimeSha256=hash(readFileSync(join(runtime,path)));return{path,candidateSha256,runtimeSha256,identical:candidateSha256===runtimeSha256};});
const boundaryStart=boundary();
assert(boundaryStart.slice(0,2).every(row=>row.identical));
const origin='http://127.0.0.1:18812',fake='http://127.0.0.1:18811',API='/api/admin/storyboard/production';
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',stamp='2026-10-05T01:00:00.000Z';
const titles={[A]:'서울 시장 먹방',[B]:'부산 골목의 오래된 가게에서 만난 따뜻한 국밥과 반찬을 소개하는 촬영 기획'};
const summary=id=>({id,title:titles[id],revision:1,status:id===A?'partial':'failed',createdAt:stamp,updatedAt:id===A?'2026-10-04T01:00:00.000Z':stamp});
const scene=n=>({sceneNo:n,title:'장면 '+n,durationSec:10,description:'합성 촬영 내용',visualDirection:'합성 가게 전경',narration:'합성 음식 소개',caption:'검증 장면',productionNotes:['고정 카메라'],imagePrompt:'Food',sourceIds:[],revision:1,image:null,imageError:null});
const project=id=>({...summary(id),request:{workflow:'storyboard-mlx-v1',requestId:id,prompt:'합성 촬영 기획',sceneCount:5,retrieval:'none',sources:[],imageWidth:1024,imageHeight:576,providers:{externalAI:false,text:{id:'manual',model:''},image:{id:'manual',model:''}}},document:{schema:'storyboard-mlx-v1',projectId:id,revision:1,generatedAt:stamp,title:titles[id],logline:'합성 저장 기획',textProvenance:{providerId:'manual',model:'',verification:'user-import',generatedAt:stamp,requestId:id,responseId:null,responseModel:null,modelEvidence:'unverified'},scenes:Array.from({length:5},(_,i)=>scene(i+1))}});
const startedAt=new Date().toISOString(), browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
let phase='setup',catalogMode='normal',release=null,totalExternal=0,totalDenied=0,syntheticReads=0,catalogReads=0,detailReads=0,pageErrors=0,consoleErrors=0;
const previous=existsSync(join(out,'verification.json'))?JSON.parse(readFileSync(join(out,'verification.json'),'utf8')):null;
const carry=previous&&previous.sourceStable&&JSON.stringify(previous.sourceEnd)===JSON.stringify(sourceStart)?previous:null;
const results=[...(carry?.checks??[])],screenshots=[...(carry?.screenshots??[])],deniedPaths=[];
const requestedWidths=(process.argv[2]??'390,834,1423').split(',').map(Number);
assert(requestedWidths.every(width=>[390,834,1423].includes(width)));
const context=await browser.newContext({viewport:{width:1423,height:1000},reducedMotion:'reduce',serviceWorkers:'block'});
await context.addInitScript(()=>{localStorage.setItem('tzudong:e2e-admin-shell-bypass','1');localStorage.setItem('tzudong-admin-theme','light');localStorage.setItem('tzudong-admin-sidebar-collapsed','false');localStorage.removeItem('adminEvaluationPageState');});
await context.route('**/*',async route=>{
 const req=route.request(),url=new URL(req.url()),method=req.method();
 const fulfill=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
 if(![origin,fake].includes(url.origin)){totalExternal++;await route.abort('blockedbyclient');return;}
 const readPosts=new Set([fake+'/rest/v1/rpc/get_current_privacy_eligibility',fake+'/rest/v1/rpc/is_current_auth_session_active',fake+'/rest/v1/rpc/read_public_profile_summaries',origin+'/api/admin/profile-summaries']);
 if(method==='POST'&&readPosts.has(url.href)){
  syntheticReads++;
  if(url.pathname.endsWith('get_current_privacy_eligibility'))return fulfill({schemaVersion:1,eligible:true,reasonCode:'PRIVACY_ELIGIBLE',policyVersionId:'00000000-0000-4000-8000-000000000001',policyVersion:'2026-08-04.1',contentSha256:'6e42ced065a6ea0762b85d9b5e11500fcfc535543ab50d12ffbe6490086a110b'});
  if(url.pathname.endsWith('is_current_auth_session_active'))return fulfill(true);
  const body=req.postDataJSON(),ids=body.userIds??body.p_user_ids??[];
  assert(Array.isArray(ids)&&ids.length<=100);
  return fulfill(url.pathname==='/api/admin/profile-summaries'?{rows:ids.map(userId=>({userId,nickname:'합성 검증 사용자'}))}:ids.map(user_id=>({user_id,nickname:'합성 검증 사용자',avatar_url:null})));
 }
 if(!['GET','HEAD','OPTIONS'].includes(method)){totalDenied++;deniedPaths.push({method,endpoint:url.pathname.startsWith('/api/')?url.pathname:'/fixture-nonread'});return fulfill({code:'INTEGRATED_FIXTURE_WRITE_DENIED'},403);}
 if(url.origin===origin&&url.pathname===API&&method==='GET'){
  catalogReads++;
  if(catalogMode==='pending')await new Promise(resolve=>{release=resolve;});
  if(catalogMode==='failure')return fulfill({ok:false,errorCode:'unavailable'},503);
  return fulfill({ok:true,projects:catalogMode==='empty'?[]:[summary(A),summary(B)],workers:[]});
 }
 if(url.origin===origin&&url.pathname.startsWith(API+'/')&&method==='GET'){
  const id=url.pathname.slice(API.length+1);assert([A,B].includes(id));detailReads++;return fulfill({ok:true,project:project(id),job:null,events:[]});
 }
 await route.continue();
});
await context.routeWebSocket('**/*',socket=>{const url=new URL(socket.url());if(url.origin===origin.replace('http:','ws:')&&url.pathname.startsWith('/_next/'))socket.connectToServer();else{totalExternal++;socket.close();}});
const page=await context.newPage();page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(45000);
page.on('pageerror',()=>pageErrors++);page.on('console',message=>{if(message.type()==='error')consoleErrors++;});
const list=()=>page.getByRole('list',{name:'저장된 프로젝트 목록',exact:true});
const first=()=>list().getByRole('button',{name:/^서울 시장 먹방/});
const second=()=>list().getByRole('button',{name:/^부산 골목/});
const refresh=()=>page.getByRole('button',{name:'프로젝트 목록 다시 불러오기',exact:true});
async function openSidebarItem(label){
 const trigger=page.getByRole('button',{name:'관리자 메뉴 열기',exact:true});
 if(await trigger.isVisible()&&await trigger.getAttribute('aria-expanded')!=='true'){
  phase+='-mobile-menu-open';await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded','true',{timeout:2500}).catch(()=>{});
  if(await trigger.getAttribute('aria-expanded')!=='true')await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded','true');
 }
 const exact=page.locator('button[data-admin-console-menu-item-mode]').filter({visible:true}).and(page.getByRole('button',{name:new RegExp('^'+label)})).first();
 phase+='-item-click';await exact.click();
}
async function geometry(width,state){
 const measurement=await page.evaluate(()=>{const workspace=document.querySelector('[data-local-storyboard-workspace]'),header=workspace?.querySelector('[data-admin-page-header]');return{viewport:innerWidth,documentOverflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,workspaceOverflow:workspace?workspace.scrollWidth-workspace.clientWidth:null,headerOverflow:header?header.scrollWidth-header.clientWidth:null,activeModule:document.querySelector('[data-admin-console-active-module]')?.getAttribute('data-admin-console-active-module'),headingCount:workspace?.querySelectorAll('[data-admin-page-header] h2').length};});
 assert.equal(measurement.viewport,width);assert.equal(measurement.documentOverflow,0);assert.equal(measurement.workspaceOverflow,0);assert.equal(measurement.headerOverflow,0);assert.equal(measurement.activeModule,'storyboard');assert.equal(measurement.headingCount,1);
 const file=`integrated-storyboard-${state}-${width}.png`;await page.screenshot({path:join(out,file)});screenshots.push({file,sha256:hash(readFileSync(join(out,file)))});return measurement;
}
let passed=false;
try{
 phase='synthetic-session';await page.goto(origin+'/__fixture/session',{waitUntil:'domcontentloaded'});
 for(const width of requestedWidths){
  phase=`sidebar-entry-${width}`;catalogMode='normal';await page.setViewportSize({width,height:1000});await page.goto(origin+'/admin?module=users',{waitUntil:'domcontentloaded'});
  await page.locator('[data-admin-console-active-module="users"]').waitFor();await openSidebarItem('스토리보드 생성');
  await expect(page.locator('[data-admin-console-active-module="storyboard"]')).toBeVisible({timeout:2500}).catch(()=>{});
  if(!await page.locator('[data-admin-console-active-module="storyboard"]').isVisible())await openSidebarItem('스토리보드 생성');
  phase=`storyboard-ready-${width}`;await expect(page.locator('[data-admin-console-active-module="storyboard"]')).toBeVisible();await expect(list().getByRole('button')).toHaveCount(2);
  const listGeometry=await geometry(width,'list');
  phase=`search-filter-${width}`;await page.getByRole('searchbox',{name:'프로젝트 검색'}).fill(' 서울 ');await expect(list().getByRole('button')).toHaveCount(1);
  await page.getByRole('combobox',{name:'프로젝트 상태',exact:true}).selectOption('failed');await expect(page.getByText('검색 조건에 맞는 프로젝트가 없습니다.',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'검색 조건 초기화',exact:true}).click();await expect(list().getByRole('button')).toHaveCount(2);
  phase=`keyboard-detail-${width}`;await first().focus();await page.keyboard.press('Enter');await expect(page.getByRole('heading',{name:'서울 시장 먹방',exact:true})).toBeFocused();assert(page.url().includes(A));
  await page.getByRole('button',{name:'프로젝트 목록',exact:true}).click();await expect(first()).toHaveAttribute('aria-current','true');
  const detailGeometry=await geometry(width,'detail');
  phase=`read-recovery-${width}`;catalogMode='failure';await refresh().click();await expect(page.getByRole('alert').filter({hasText:'프로젝트 목록을 불러오지 못했습니다.'})).toBeVisible();await expect(list().getByRole('button')).toHaveCount(2);
  catalogMode='pending';await refresh().click();await expect(refresh()).toBeDisabled();await expect(page.getByText('프로젝트 목록 확인 중…',{exact:true})).toBeVisible();catalogMode='normal';assert(release);release();release=null;
  await expect(refresh()).toBeEnabled();await expect(page.getByRole('alert').filter({hasText:'프로젝트 목록을 불러오지 못했습니다.'})).toHaveCount(0);
  phase=`departure-${width}`;await page.getByRole('button',{name:'장면 1 편집',exact:true}).click();await page.getByLabel('장면 제목',{exact:true}).fill('통합 검증 미저장 편집');
  let rowGuard=false;page.once('dialog',async dialog=>{rowGuard=dialog.type()==='confirm';await dialog.dismiss();});await second().click();await expect(page.getByLabel('장면 제목',{exact:true})).toHaveValue('통합 검증 미저장 편집');assert(rowGuard);assert(page.url().includes(A));
  let sidebarGuard=null;
  if(width===1423){sidebarGuard=false;page.once('dialog',async dialog=>{sidebarGuard=dialog.type()==='confirm';await dialog.dismiss();});await openSidebarItem('사용자 관리');await expect(page.getByLabel('장면 제목',{exact:true})).toHaveValue('통합 검증 미저장 편집');assert(sidebarGuard);await expect(page.locator('[data-admin-console-active-module="storyboard"]')).toBeVisible();}
  page.once('dialog',async dialog=>dialog.accept());await second().click();await expect(page.getByRole('heading',{name:/^부산 골목/})).toBeVisible();assert(page.url().includes(B));
  results.push({width,enteredViaActualSidebar:true,listGeometry,detailGeometry,searchAndStatusFilter:true,keyboardSelectionFocus:true,staleRowsRetainedOnFailure:true,readRetryAndLoading:true,rowDepartureDismissPreserved:true,rowDepartureAcceptSwitched:true,sidebarDepartureDismissPreserved:sidebarGuard});
  console.log(JSON.stringify({width,status:'passed',documentOverflow:0,workspaceOverflow:0,headerOverflow:0}));
 }
 phase='source-readback';assert.deepEqual(readSources(),sourceStart);assert.equal(pageErrors,0);assert.equal(totalDenied,0);passed=true;
}catch(error){await page.screenshot({path:join(out,'failure.png')}).catch(()=>{});console.log(JSON.stringify({status:'failed',phase,errorType:error?.name??'Error',assertion:error?.matcherResult?.name??null}));process.exitCode=1;}
finally{
 const sourceEnd=readSources(),boundaryEnd=boundary();
 const report={schema:'tzudong-storyboard-integrated-cms-v1',passed,startedAt,finishedAt:new Date().toISOString(),phase,origin,requestedWidths,priorAttempts:carry?[...(carry.priorAttempts??[]),{passed:carry.passed,phase:carry.phase,startedAt:carry.startedAt,finishedAt:carry.finishedAt,safety:carry.safety,widths:carry.checks.map(row=>row.width)}]:[],synthetic:true,browser:browser.version(),node:process.version,sourceStart,sourceEnd,sourceStable:JSON.stringify(sourceStart)===JSON.stringify(sourceEnd),boundaryStart,boundaryEnd,copyManifest:JSON.parse(readFileSync(join(work,'copy-manifest.json'),'utf8')),checks:results,safety:{serverBoundMethods:['GET','HEAD','OPTIONS'],syntheticReadPostsFulfilled:syntheticReads,forwardedPosts:0,catalogReads,detailReads,deniedExternal:totalExternal,deniedNonreadAttempts:totalDenied,deniedPaths,pageErrors,consoleErrors,actualOperatingWrites:0,providerCalls:0},screenshots,limitations:['Actual Next administrator shell with synthetic browser-local catalog/project reads and synthetic local login. This does not prove hosted data, provider execution or deployment.','Only the two owned storyboard components were copied. The boundary manifest records other runtime/candidate differences.'],runtimeDirectory:work};
 const encoded=JSON.stringify(report,null,2)+'\n';writeFileSync(join(out,'verification.json'),encoded);writeFileSync(join(out,'verification.json.sha256'),hash(encoded)+'  verification.json\n');await browser.close();console.log(JSON.stringify({passed,report:join(out,'verification.json'),sha256:hash(encoded),sourceStable:report.sourceStable,checks:results.length,pageErrors,deniedNonreadAttempts:totalDenied,deniedExternal:totalExternal,consoleErrors}));
}
