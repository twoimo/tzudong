/** Actual local Next screens with synthetic worker catalogs; every mutation denied. */
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const origin='http://127.0.0.1:18794',connection=process.argv[2];
if(!connection?.startsWith('ws://127.0.0.1:'))throw new Error('OWNED_LOCAL_BROWSER_REQUIRED');
const browser=await chromium.connectOverCDP(connection);
const context=browser.contexts()[0];
const page=context.pages().find(candidate=>candidate.url()==='about:blank'||candidate.url().startsWith(origin));
if(!page)throw new Error('OWNED_TARGET_REQUIRED');
let queries:string[]=[],writes=0,modelMode='flash';
const errors:string[]=[];
page.on('pageerror',()=>errors.push('pageerror'));
await context.addInitScript(()=>{localStorage.setItem('tzudong:e2e-admin-shell-bypass','1');localStorage.removeItem('adminEvaluationPageState');});
const model=(id:string,capability:string)=>({id,owned_by:'gemini-api',capabilities:[capability],loaded:false,bytes_on_disk:0,bytes_resident:0});
await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin!==origin){await route.abort();return;}
  if(!['GET','HEAD','OPTIONS'].includes(request.method())){writes++;await route.fulfill({status:403,contentType:'application/json',body:'{"error":"FIXTURE_WRITE_DENIED"}'});return;}
  if(url.pathname==='/api/admin/storyboard/production'){
    await route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,projects:[],workers:[{id:'00000000-0000-4000-b000-000000000001',online:modelMode!=='offline',lastHeartbeat:'2026-10-04T03:00:00Z',models:[model('gemini-3.8-flash','chat'),model('gemini-3.1-flash-image','image'),...(modelMode==='all'?[model('gemini-3-pro-image','image')]:[])]}]})});return;
  }
  if(url.pathname==='/api/admin/evaluations')queries.push(url.searchParams.get('q')??'');
  await route.continue();
});
await page.setViewportSize({width:1440,height:960});
await page.goto(origin+'/admin?module=restaurants');
const search=page.locator('input').filter({visible:true}).first();
await expect(search).toBeVisible();
const measured=[];
for(let trial=0;trial<7;trial++){
  const value='fixture'+trial;
  await search.fill('');
  queries=[];
  await search.pressSequentially(value,{delay:25});
  await expect.poll(()=>queries.filter(query=>query===value).length).toBe(1);
  expect(queries).toEqual([value]);
  measured.push({trial,keystrokes:value.length,requests:queries.length,finalQueryMatches:true});
}
await page.goto(origin+'/admin?module=storyboard');
const workspace=page.locator('[data-local-storyboard-workspace="true"]');
await expect(workspace).toBeVisible();
await workspace.locator('#local-external-ai').check();
await workspace.locator('#local-storyboard-prompt').fill('합성 검증용 요청');
const submit=workspace.getByRole('button',{name:'프로젝트 만들기',exact:true});
await expect(submit).toBeEnabled();
await expect(workspace.locator('#local-image-model option[value="gemini-3-pro-image"]')).toBeDisabled();
await workspace.getByRole('button',{name:'연결 설정',exact:true}).click();
modelMode='all';await workspace.getByRole('button',{name:'목록 새로고침',exact:true}).click();
await expect(workspace.locator('#local-image-model option[value="gemini-3-pro-image"]')).toBeEnabled();
await workspace.locator('#local-image-model').selectOption('gemini-3-pro-image');
await expect(submit).toBeEnabled();
modelMode='flash';await workspace.getByRole('button',{name:'목록 새로고침',exact:true}).click();
await expect(submit).toBeDisabled();
expect(await workspace.locator('#local-image-model').inputValue()).toBe('gemini-3-pro-image');
await workspace.locator('#local-image-model').selectOption('gemini-3.1-flash-image');
await expect(submit).toBeEnabled();
modelMode='offline';await workspace.getByRole('button',{name:'목록 새로고침',exact:true}).click();
await expect(submit).toBeDisabled();
expect(writes).toBe(0);expect(errors).toEqual([]);
const sources=['app/admin/evaluations/page.tsx','components/admin/storyboard/LocalStoryboardWorkspace.tsx'];
const report={kind:'admin-query-and-model-capability-rendered-fixture',passed:true,node:process.version,browser:browser.version(),origin,synthetic:true,debounceMs:250,trials:measured,models:{remoteZeroBytesAccepted:true,unsupportedProDisabled:true,selectedUnavailableModelPreserved:true,offlineCreationDisabled:true},hostedWrites:0,providerCalls:0,pageErrors:errors.length,sources:sources.map(path=>({path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')}))};
const output='performance/ui-renewal-20261003/query-model-capability-20261004.json';
writeFileSync(output,JSON.stringify(report,null,2)+'\n');writeFileSync(output+'.sha256',createHash('sha256').update(readFileSync(output)).digest('hex')+'\n');
console.log(JSON.stringify(report));process.exit(0);
