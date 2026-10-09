import {chromium,expect} from '@playwright/test';
import {writeFileSync} from 'node:fs';
const origin='https://tzudong-76i12vmwe-twoimos-projects.vercel.app';
const token=process.env.VERCEL_AUTOMATION_BYPASS_SECRET;if(!token)throw Error('Existing_only_auth_unavailable');
const browser=await chromium.launch({headless:true,executablePath:'/Users/twoimo/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'});
const result={deploymentId:'dpl_He2HgNHEkNsdbQg556dGJsreTEgr',gitSha:'614b249175c35636a7062bf05cb01ebad538b10d',viewports:[],pageErrorNames:[],consoleErrorCount:0,blockedExternalReads:0,blockedWriteIntents:0,forwardedWrites:0,appOAuthStarted:false,authStateExported:false};
let phase='start';
try{
 for(const size of [{name:'desktop',width:1440,height:1000},{name:'mobile',width:390,height:844}]){
  phase='login-'+size.name;const context=await browser.newContext({viewport:size,reducedMotion:'reduce',serviceWorkers:'block'});
  await context.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());if(url.origin!==origin){result.blockedExternalReads++;return route.fulfill({status:503,body:''});}if(!['GET','HEAD'].includes(req.method())){result.blockedWriteIntents++;return route.fulfill({status:405,body:''});}await route.continue({headers:{...req.headers(),'x-vercel-protection-bypass':token}});});
  await context.routeWebSocket('**/*',socket=>socket.close());
  const page=await context.newPage();page.on('pageerror',e=>result.pageErrorNames.push({phase,name:e.name}));page.on('console',m=>{if(m.type()==='error')result.consoleErrorCount++;});
  const response=await page.goto(origin+'/?auth=login&reason=mypage&next=%2Fmypage%2Fbookmarks',{waitUntil:'domcontentloaded',timeout:60000});expect(response.status()).toBe(200);
  const panel=size.name==='desktop'?page.getByRole('dialog'):page.locator('[data-bottom-sheet-layout-source="auth-modal"]');await expect(panel).toBeVisible({timeout:25000});await expect(panel.getByText('쯔동여지도',{exact:true})).toBeVisible();await expect(panel.locator('img').first()).toBeVisible();
  await panel.screenshot({path:`performance/vercel-preview-diagnosis-20261009/merge-preview-login-${size.name}.png`});
  const bounds=await panel.boundingBox();result.viewports.push({...size,httpStatus:response.status(),loginModalRendered:true,brandTitleAndLogo:true,modalWithinViewport:bounds.x>=0&&bounds.x+bounds.width<=size.width+1,credentialsEntered:false,oauthAttempted:false});
  phase='public-policy-'+size.name;await page.goto(origin+'/privacy',{waitUntil:'domcontentloaded'});await expect(page.getByRole('heading',{name:'개인정보 처리방침'}).first()).toBeVisible();result.viewports.at(-1).privacyPageRendered=true;
  phase='admin-anonymous-'+size.name;await page.goto(origin+'/admin',{waitUntil:'domcontentloaded'});await expect(page).toHaveURL(url=>url.origin===origin&&url.pathname==='/'&&url.searchParams.get('auth')==='login');await expect(page.locator('#admin-console-canvas')).toHaveCount(0);result.viewports.at(-1).anonymousAdminRedirectedHome=true;
  await context.close();
 }
}catch(e){result.failure={phase,name:e.name,assertion:e.message.split('\n')[0]};process.exitCode=1;}finally{await browser.close();writeFileSync('performance/vercel-preview-diagnosis-20261009/merge-preview-browser.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));}
