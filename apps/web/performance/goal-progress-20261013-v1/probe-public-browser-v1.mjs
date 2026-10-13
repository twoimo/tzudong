import {createRequire} from 'node:module';import {writeFile} from 'node:fs/promises';
const {chromium}=createRequire('/Users/twoimo/.codex/worktrees/mobile-nav-read-20261012/tzudong/apps/web/package.json')('@playwright/test');
const out={startedAtUtc:new Date().toISOString(),readOnly:true,productionMutation:false,physicalDevice:false,fieldAdmission:0};
const browser=await chromium.launch({channel:'chrome',headless:true});out.browserVersion=await browser.version();
const context=await browser.newContext({viewport:{width:390,height:844},locale:'ko-KR',serviceWorkers:'block'});const page=await context.newPage();
try{
 const response=await page.goto('https://www.tzudong.app/?__qa=swipe-cache-20261009',{waitUntil:'domcontentloaded',timeout:30000});
 out.documentStatus=response?.status();out.documentServer=(await response?.allHeaders())?.server??null;
 out.observed=await page.evaluate(()=>({hasMain:!!document.querySelector('main'),challenge:/Just a moment|Verify you are human|Vercel Security Checkpoint|브라우저 확인/.test(document.title+' '+document.body.innerText),forbidden:/Forbidden|Access denied/.test(document.title+' '+document.body.innerText),mapScript:!!document.querySelector('script[src*="oapi.map.naver.com"]'),stub:!!document.querySelector('script[data-local-naver-maps="true"]')}));
 if(out.documentStatus===200&&!out.observed.challenge){
  await page.waitForTimeout(5000);
  out.map=await page.evaluate(()=>({sdk:!!window.naver?.maps?.Map,markers:document.querySelectorAll('[data-testid="marker"],.cluster-marker-container').length,visibleLoadFailure:document.body.innerText.includes('지도를 불러오지 못했어요'),stub:!!document.querySelector('script[data-local-naver-maps="true"]')}));
  const health=await context.request.get('https://www.tzudong.app/api/health');out.healthStatus=health.status();
  if(health.ok()){const body=await health.json();out.health=Object.fromEntries(['ok','gitSha','deploymentId','projectId','host'].map(k=>[k,body[k]]));}
 }
}catch(error){out.failure=error?.name==='TimeoutError'?'timeout':'bounded_public_probe_failure';}
finally{await context.close();await browser.close();}
out.endedAtUtc=new Date().toISOString();await writeFile(new URL('public-browser-v1.json',import.meta.url),JSON.stringify(out,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(out));
