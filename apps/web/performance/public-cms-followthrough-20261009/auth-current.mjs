import { chromium, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
const output = resolve('performance/public-cms-followthrough-20261009');
const browser = await chromium.launch({ headless: true, executablePath: '/Users/twoimo/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' });
const report = { scope: 'anonymous-local-read-only-auth-ui', operatingAuthEvidence: false, cases: [] };
try {
 for (const viewport of [{ id:'desktop', width:1440,height:1000 }, { id:'tablet',width:820,height:1180 }, { id:'mobile',width:390,height:844 }, { id:'short-mobile',width:390,height:600 }]) {
  const context = await browser.newContext({ viewport, reducedMotion:'reduce', serviceWorkers:'block' });
  await context.routeWebSocket('**/*', ws => { if (new URL(ws.url()).hostname === '127.0.0.1') ws.connectToServer(); else ws.close(); });
  await context.route('**/*', route => { const request=route.request(),url=new URL(request.url()); return url.origin==='http://127.0.0.1:19872'&&!url.pathname.startsWith('/api/')&&['GET','HEAD'].includes(request.method()) ? route.continue() : route.fulfill({status:503,json:{code:'local_read_only_check'}}); });
  const page = await context.newPage(), result={ viewport:viewport.id };
  try {
   await page.goto('http://127.0.0.1:19872/?auth=login&reason=mypage&next=%2Fmypage%2Fbookmarks',{waitUntil:'domcontentloaded',timeout:45000});
   await page.addStyleTag({content:'nextjs-portal{display:none!important}'});
   result.stage='dialog';
   const panel = viewport.id==='desktop' ? page.getByRole('dialog') : page.locator('[data-bottom-sheet-layout-source="auth-modal"]');
   await expect(panel).toBeVisible({timeout:20000});
   result.stage='brand-title';
   await expect(panel.getByText('쯔동여지도',{exact:true})).toBeVisible();
   result.stage='logo';
   await expect(panel.locator('img').first()).toBeVisible();
   result.brandTitleAndLogoVisible=true;
   result.loginBounds=await panel.boundingBox();
   await panel.screenshot({path:resolve(output,`auth-${viewport.id}-login.png`)});
   result.stage='signup-tab';
   const signup=panel.getByRole('tab',{name:'회원가입',exact:true});
   await expect(signup).toBeVisible(); await signup.click();
   await expect(signup).toHaveAttribute('aria-selected','true');
   result.signupSelected=true;
   result.signupScroll=await panel.evaluate(element=>{
    const button=Array.from(element.querySelectorAll('button')).find(button=>button.type==='submit'&&button.textContent?.includes('회원가입'));
    const rect=element.getBoundingClientRect(),buttonRect=button?.getBoundingClientRect();
    const scrollOwners=Array.from(element.querySelectorAll('*')).filter(item=>{const style=getComputedStyle(item);return ['auto','scroll'].includes(style.overflowY)&&item.scrollHeight>item.clientHeight+4;});
    return {panelBottom:rect.bottom,viewportHeight:innerHeight,submitBottom:buttonRect?.bottom??null,submitTop:buttonRect?.top??null,scrollOwnerCount:scrollOwners.length,buttonPresent:!!button};
   });
   await panel.screenshot({path:resolve(output,`auth-${viewport.id}-signup.png`)});
   const submit=panel.locator('button[type=submit]').filter({hasText:'회원가입'});
   await submit.scrollIntoViewIfNeeded();
   result.submitBoundsAfterScroll=await submit.boundingBox();
   result.submitInViewportAfterScroll=result.submitBoundsAfterScroll.y>=0&&result.submitBoundsAfterScroll.y+result.submitBoundsAfterScroll.height<=viewport.height+1;
   await panel.screenshot({path:resolve(output,`auth-${viewport.id}-signup-scrolled.png`)});
   await page.keyboard.press('Escape');
   result.closedByEscape=!(await panel.isVisible());
  } catch(error){result.failure=String(error.message).split('\n')[0].slice(0,180);}
  report.cases.push(result);writeFileSync(resolve(output,'auth-current-results.json'),JSON.stringify(report,null,2)+'\n');await context.close();
 }
}finally{await browser.close();}
console.log(JSON.stringify(report));
