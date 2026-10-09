import { chromium, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const output = new URL('./live-public-readiness-v6.json',import.meta.url);
const result={sourceHarnessSha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),startedAtUtc:new Date().toISOString(),environment:'live www anonymous desktop Chrome; viewport mobile/tablet emulation',physicalDevice:false,fieldAdmission:0,serviceMutationAllowed:false,cases:[],responses:[],blockedMutations:0,pageErrors:0,consoleErrors:0,passed:false};
let browser;
try {
 browser=await chromium.launch({channel:'chrome',headless:true});result.browserVersion=browser.version();
 for(const viewport of [{width:390,height:844},{width:820,height:1180},{width:1440,height:900}]){
  const context=await browser.newContext({viewport,isMobile:viewport.width<1024,hasTouch:viewport.width<1024,serviceWorkers:'block',locale:'ko-KR'});
  const page=await context.newPage();
  page.on('pageerror',()=>result.pageErrors++);
  page.on('console',m=>{if(m.type()==='error')result.consoleErrors++;});
  page.on('response',response=>{const u=new URL(response.url());if((u.pathname.includes('/rest/v1/')||u.pathname.includes('/api/'))&&result.responses.length<200)result.responses.push({path:u.pathname,status:response.status(),viewportWidth:viewport.width});});
  await page.route('**/*',route=>{const req=route.request(),u=new URL(req.url());
   if(u.pathname.startsWith('/api/performance/')||u.pathname.startsWith('/_vercel/'))return route.fulfill({status:204});
   if(['GET','HEAD','OPTIONS'].includes(req.method()))return route.continue();
   if(/^\/rest\/v1\/rpc\/read_public_profile_(summaries|leaderboard|leaderboard_page)$/.test(u.pathname))return route.continue();
   result.blockedMutations++;return route.abort();
  });
  for(const [path,title] of [['/leaderboard','랭킹'],['/feed','리뷰'],['/stamp','도장']]){
   result.activeCase={viewport,path,phase:'navigation'};await page.goto(`https://www.tzudong.app${path}?__qa=readiness`,{waitUntil:'domcontentloaded',timeout:60000});
   if(viewport.width>=1024){const panel={leaderboard:'leaderboard',feed:'feed',stamp:'stamp'}[path.slice(1)];await page.waitForURL(u=>u.pathname==='/'&&u.searchParams.get('panel')===panel,{timeout:30000});}result.activeCase.phase='heading';const heading=page.getByRole('heading',{name:new RegExp(`^(쯔동여지도 )?${title}([ ]*[(]?[0-9,]+(개|곳|명)[)]?)?$`)}).first();
   await expect(heading).toBeVisible({timeout:45000});result.activeCase.finalRoute=new URL(page.url()).pathname;result.activeCase.headerVariant=await heading.locator('xpath=ancestor::header[1]').getAttribute('data-header-variant');
   result.activeCase.phase='error-absence';await expect(page.getByText('랭킹 데이터를 불러오지 못했습니다',{exact:true})).toHaveCount(0,{timeout:20000});
   if(path==='/leaderboard')await expect(page.getByText('랭킹 데이터를 불러오는 중입니다',{exact:true})).toHaveCount(0,{timeout:30000});
   result.activeCase.phase='header-pixels';result.activeCase.headingBox=await heading.boundingBox();const b=result.activeCase.headingBox;if(!b||b.x<0||b.y<0||b.width<1||b.height<1||b.x+b.width>viewport.width||b.y+b.height>viewport.height)throw Error('HEADER_CLIP_OUTSIDE_VIEWPORT');await page.screenshot({clip:b,path:new URL(`./live-header-${viewport.width}-${path.slice(1)}-v6.png`,import.meta.url).pathname});await expect(heading).toBeVisible({timeout:10000});
   result.cases.push({viewport,path,expectedTitle:title,titleVisible:true,rankingErrorObserved:false,headerPixelsCaptured:true,finalRoute:result.activeCase.finalRoute,headerVariant:result.activeCase.headerVariant});
  }
  await context.close();
 }
 result.passed=result.cases.length===9&&result.pageErrors===0;
}catch(error){result.failureCode='LIVE_FLOW_NOT_CONFIRMED';result.failureFirstLineClass=(error?.message??'').split('\n')[0].replace(/https?:\/\/\S+/g,'[URL]').replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi,'[ID]').slice(0,240);result.failureType=error?.name==='TimeoutError'?'TimeoutError':'Error';result.failureClass=/navigation|goto|net::/i.test(error?.message??'')?'navigation':/strict mode/i.test(error?.message??'')?'multiple-matches':/screenshot|font|visible/i.test(error?.message??'')?'pixels-or-visibility':/expect/i.test(error?.message??'')?'assertion':'unclassified';process.exitCode=1;}
finally{await browser?.close();result.endedAtUtc=new Date().toISOString();writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({passed:result.passed,cases:result.cases.length,pageErrors:result.pageErrors,consoleErrors:result.consoleErrors,blockedMutations:result.blockedMutations,failureCode:result.failureCode??null}));}
