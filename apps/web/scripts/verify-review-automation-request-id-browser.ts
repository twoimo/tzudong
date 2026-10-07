/** Actual Next UI, owned browser, synthetic responses only; no hosted writes. */
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const connection=process.argv[2];
if (!connection?.startsWith('ws://127.0.0.1:')) throw new Error('OWNED_LOCAL_BROWSER_REQUIRED');
const browser=await chromium.connectOverCDP(connection);
const context=browser.contexts()[0];
const page=context.pages().find(candidate=>candidate.url()==='about:blank');
if (!page) throw new Error('OWNED_BLANK_TARGET_REQUIRED');
const endpoint='/api/admin/evaluations/automation';
const origin='http://127.0.0.1:18794';
const errors:string[]=[];
let expectedConsoleErrors=0;
let unexpectedWrites=0,runIds:string[]=[],requestBodies:Record<string,unknown>[]=[];
let snapshot={policy:{version:1,enabled:true,batch_size:50,daily_limit:50,last_run_at:null as string|null},runs:[] as unknown[],items:[],queue:{queued:0,running:0,failed:0}};
page.on('pageerror',()=>errors.push('pageerror'));
page.on('console',message=>{
  if(message.type()!=='error')return;
  if(message.location().url===origin+endpoint && message.text().includes('net::ERR_FAILED')){expectedConsoleErrors++;return;}
  errors.push('consoleerror');
});
await context.addInitScript(()=>{localStorage.setItem('tzudong:e2e-admin-shell-bypass','1');localStorage.removeItem('adminEvaluationPageState');});
await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  const fulfill=(body:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  if(url.origin!==origin){await route.abort();return;}
  if(url.pathname===endpoint){
    if(request.method()==='GET'){await fulfill(snapshot);return;}
    const body=request.postDataJSON() as Record<string,unknown>;
    if(body.action==='preview-run'){
      await fulfill({action:'run',version:'1',previewHash:'a'.repeat(32),counts:{approve:0,recheck:0,hold:25,protected:0},batchSize:50,dailyLimit:50,remainingApprovals:50,queue:{queued:0,running:0}});return;
    }
    if(body.action==='run'){
      requestBodies.push(body);runIds.push(String(body.requestId));
      if(runIds.length<3){await route.abort('failed');return;}
      snapshot={...snapshot,policy:{...snapshot.policy,last_run_at:'2026-10-04T02:00:00Z'},runs:[{id:body.requestId,started_at:'2026-10-04T02:00:00Z',scanned:25,approved:0,held:25,recheck:0,protected:0}]};
      await fulfill(snapshot);return;
    }
    unexpectedWrites++;await fulfill({error:'FIXTURE_WRITE_DENIED'},403);return;
  }
  if(!['GET','HEAD','OPTIONS'].includes(request.method())){unexpectedWrites++;await fulfill({error:'FIXTURE_WRITE_DENIED'},403);return;}
  await route.continue();
});
const results=[];
for(const width of [390,834,1440]){
  runIds=[];requestBodies=[];
  snapshot={policy:{version:1,enabled:true,batch_size:50,daily_limit:50,last_run_at:null},runs:[],items:[],queue:{queued:0,running:0,failed:0}};
  await page.setViewportSize({width,height:900});
  await page.goto(`${origin}/admin?module=restaurants`);
  const automation=page.getByRole('region',{name:'맛집 검수 자동 운영'});
  await expect(automation.getByText('자동 승인 켜짐',{exact:true})).toBeVisible();
  await automation.getByRole('button',{name:'지금 실행',exact:true}).click();
  let dialog=page.getByRole('alertdialog');
  await expect(dialog.getByRole('heading',{name:'지금 검수할까요?'})).toBeVisible();
  await dialog.getByRole('button',{name:'지금 실행',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('결과를 확인하지 못했습니다');
  await expect(dialog.getByRole('button',{name:'지금 실행',exact:true})).toBeEnabled();
  await page.screenshot({path:`performance/ui-renewal-20261003/review-automation-uncertain-${width}-20261004.png`});
  await dialog.getByRole('button',{name:'지금 실행',exact:true}).click();
  await expect.poll(()=>runIds.length).toBe(2);
  await expect(dialog.getByRole('button',{name:'취소',exact:true})).toBeEnabled();
  expect(runIds[1]).toBe(runIds[0]);
  await dialog.getByRole('button',{name:'취소',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await automation.getByRole('button',{name:'지금 실행',exact:true}).click();
  dialog=page.getByRole('alertdialog');
  await expect(dialog.getByRole('heading',{name:'지금 검수할까요?'})).toBeVisible();
  const dialogOverflow=await dialog.evaluate(node=>node.scrollWidth-node.clientWidth);
  await dialog.getByRole('button',{name:'지금 실행',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  expect(runIds).toHaveLength(3);
  expect(runIds[2]).not.toBe(runIds[0]);
  for(const body of requestBodies)expect(body).toMatchObject({action:'run',version:'1',previewHash:'a'.repeat(32),confirmation:'지금 실행'});
  const pageOverflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
  expect(dialogOverflow).toBe(0);expect(pageOverflow).toBe(0);
  results.push({width,uncertainAttempts:2,sameIdForRetry:true,newIdAfterCancellation:true,confirmedReadback:true,dialogOverflow,pageOverflow});
}
expect(errors).toEqual([]);expect(unexpectedWrites).toBe(0);
const source=readFileSync('components/admin/RestaurantReviewAutomation.tsx');
const report={kind:'review-automation-request-id-rendered-fixture',passed:true,environment:{node:process.version,browser:browser.version(),origin,synthetic:true},sourceSha256:createHash('sha256').update(source).digest('hex'),results,pageErrors:errors.length,expectedConsoleErrors,unexpectedWrites,hostedWrites:0,realProviderCalls:0};
const output='performance/ui-renewal-20261003/review-automation-request-id-20261004.json';
writeFileSync(output,JSON.stringify(report,null,2)+'\n');
writeFileSync(output+'.sha256',createHash('sha256').update(readFileSync(output)).digest('hex')+'\n');
console.log(JSON.stringify(report));
// agent-browser owns browser shutdown; this command disconnects only itself.
process.exit(0);
