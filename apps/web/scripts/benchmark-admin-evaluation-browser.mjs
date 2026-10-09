import { chromium } from 'playwright';
import { performance } from 'node:perf_hooks';
import { mkdirSync, writeFileSync } from 'node:fs';

const connection = process.argv[2];
if (!connection?.startsWith('ws://127.0.0.1:')) throw new Error('OWNED_LOCAL_BROWSER_REQUIRED');
const browser = await chromium.connectOverCDP(connection);
const context = browser.contexts()[0];
const page = context.pages().find(target => target.url().startsWith('http://127.0.0.1:18790/'));
if (!page) throw new Error('OWNED_FIXTURE_PAGE_REQUIRED');
await context.addInitScript(() => localStorage.removeItem('adminEvaluationPageState'));
await context.route(/https:\/\/(?:i\.ytimg\.com|img\.youtube\.com)\//, route => route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90"><rect width="120" height="90" fill="#ddd"/></svg>'}));
const errors = []; const samples = [];
page.on('pageerror', () => errors.push('pageerror'));
page.on('console', message => { if(message.type()==='error') { errors.push('consoleerror'); if(samples.length<3)samples.push(message.text().slice(0,300)); } });
const observations = [];
for (let repeat=0;repeat<100;repeat++) {
  const start = performance.now();
  await page.goto('http://127.0.0.1:18790/admin?module=restaurants', {waitUntil:'domcontentloaded'});
  await page.locator('input[placeholder="상호·영상 ID 검색..."]').waitFor();
  await page.getByText('현 121개 레코드', {exact:false}).first().waitFor();
  const wallMs = performance.now()-start;
  observations.push({repeat,wallMs});
  if((repeat+1)%20===0) console.log(JSON.stringify({samples:repeat+1,errorCount:errors.length}));
}
await page.setViewportSize({width:390,height:844});
await page.screenshot({path:'performance/pipeline-20261002/admin-mobile-fixture.png',fullPage:false});
await page.setViewportSize({width:1440,height:1000});
await page.screenshot({path:'performance/pipeline-20261002/admin-desktop-fixture.png',fullPage:false});
const result = {kind:'local_development_browser_fixture',liveEvidenceEligible:false,baselineAvailable:false,samples:100,errorCount:errors.length,errorSamples:samples,observations};
mkdirSync('performance/pipeline-20261002',{recursive:true});
writeFileSync('performance/pipeline-20261002/admin-browser-raw.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({status:errors.length?'failed':'passed',samples:100,errorCount:errors.length}));
await browser.close();
if(errors.length)process.exitCode=1;
