import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import { chromeForTestingExecutable } from '../tests-unit/fixtures/chrome-for-testing';
const output = process.env.ADMIN_AUDIT_OUTPUT_DIR;
if (!output || !isAbsolute(output)) throw new Error('ABSOLUTE_OUTPUT_REQUIRED');
const base = 'http://127.0.0.1:18794';
const browser = await chromium.launch({ headless: true, executablePath: chromeForTestingExecutable() });
const rows: Array<Record<string, unknown>> = [];
try {
 const context = await browser.newContext({ reducedMotion: 'reduce' });
 await context.addInitScript(() => localStorage.setItem('tzudong:e2e-admin-shell-bypass','1'));
 const readPosts = new Set(['/api/admin/profile-summaries','/rest/v1/rpc/read_public_profile_summaries','/rest/v1/rpc/get_current_privacy_eligibility','/rest/v1/rpc/is_current_auth_session_active']);
 await context.route('**/*', async route => {
  const request=route.request(),url=new URL(request.url());
  if (![base,'http://127.0.0.1:18793'].includes(url.origin)) return route.abort();
  if (['GET','HEAD','OPTIONS'].includes(request.method()) || request.method()==='POST' && readPosts.has(url.pathname)) return route.continue();
  return route.abort();
 });
 const page=await context.newPage();
 await page.goto(base+'/__fixture/session',{waitUntil:'domcontentloaded',timeout:60_000});
 for(const width of [390,834,1423]) {
  await page.setViewportSize({width,height:960});
  await page.goto(base+'/admin?module=storyboard',{waitUntil:'domcontentloaded',timeout:60_000});
  const select=page.locator('#local-project-select');
  await select.locator('option').nth(1).waitFor({state:'attached'});
  const id=await select.locator('option').nth(1).getAttribute('value');
  if (!id) throw new Error('MISSING_SYNTHETIC_PROJECT');
  await select.selectOption(id);
  await page.getByRole('button',{name:'새 프로젝트',exact:true}).waitFor();
  const toolbar=page.locator('[data-admin-storyboard-toolbar=true]');
  const measured=await toolbar.evaluate(element=>{
   const r=element.getBoundingClientRect();
   const controls=[...element.querySelectorAll('button,select')].map(control=>{const b=control.getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,width:b.width,height:b.height};});
   return {viewport:innerWidth,documentOverflow:document.documentElement.scrollWidth-innerWidth,toolbarWidth:r.width,controls,escaped:controls.filter(b=>b.left<0||b.right>innerWidth+1).length};
  });
  await page.screenshot({path:resolve(output,`storyboard-selected-${width}.png`)});
  rows.push({module:'storyboard-selected',width,...measured});
  await page.goto(base+'/admin?module=overview',{waitUntil:'domcontentloaded',timeout:60_000});
  await page.locator('[data-admin-dashboard-kpi-value-size="bounded"]').first().waitFor();
  const metrics=await page.locator('#admin-console-canvas').evaluate(root=>({
   kpis:[...root.querySelectorAll('[data-admin-dashboard-kpi-card]')].map(el=>{
     const value=el.querySelector('[data-admin-dashboard-kpi-value-size]');
     const delta=el.querySelector('[data-admin-dashboard-kpi-title-actions]');
     const range=document.createRange(); if(value) range.selectNodeContents(value);
     const a=value?range.getBoundingClientRect():null,b=delta?.getBoundingClientRect();
     return {height:el.getBoundingClientRect().height,overlap:Boolean(a&&b&&a.right>b.left+1&&a.left<b.right&&a.bottom>b.top+1&&a.top<b.bottom)};
   }),
   hiddenOpsValues:[...root.querySelectorAll('[data-admin-dashboard-widget-card="ops"] [data-admin-dashboard-cell-align="right"]')].filter(el=>{
     const host=el.closest('[data-admin-dashboard-progressive-table]')!.getBoundingClientRect(),r=el.getBoundingClientRect();return r.right>host.right+1;
   }).length,
   splitNumbers:[...root.querySelectorAll('[data-admin-dashboard-cell-align="right"]')].filter(el=>{
     const range=document.createRange();range.selectNodeContents(el);
     return new Set([...range.getClientRects()].filter(r=>r.width>0&&r.height>0).map(r=>Math.round(r.top))).size>1;
   }).length,
  }));
  rows.push({module:'overview-detail',width,...metrics});
 }
 const passed=rows.every(row=>!row.escaped&&!row.documentOverflow&&!row.splitNumbers&&!row.hiddenOpsValues&&!(row.kpis as Array<{overlap:boolean}> | undefined)?.some(kpi=>kpi.overlap));
 writeFileSync(resolve(output,'density-detail-acceptance.json'),JSON.stringify({synthetic:true,passed,rows},null,2));
 console.log(JSON.stringify({passed,rows}));
 if(!passed) process.exitCode=1;
} finally {await browser.close();}
