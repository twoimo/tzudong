import { expect, test } from '@playwright/test';
const sizes = [{ name:'desktop', width:1440,height:1000 },{name:'tablet',width:820,height:1180},{name:'mobile',width:390,height:844}];
test.beforeEach(async ({context},testInfo)=>{
 const origin=new URL(testInfo.project.use.baseURL as string).origin;
 await context.routeWebSocket('**/*',route=>{if(new URL(route.url()).host===new URL(origin).host)route.connectToServer();else route.close();});
 await context.route('**/*',route=>{const request=route.request(),url=new URL(request.url());return url.origin===origin&&!url.pathname.startsWith('/api/')&&['GET','HEAD'].includes(request.method())?route.continue():route.fulfill({status:503,json:{code:'local_read_only_check'}});});
});
for(const size of sizes){
 for(const code of ['invalid-code','Zz00Qq']){
  test(`bounded share fallback and home recovery ${code} at ${size.name}`,async({page},testInfo)=>{
   await page.setViewportSize(size);const errors:string[]=[];
   page.on('pageerror',error=>errors.push(error.name));
   await page.goto(`/s/${code}`);
   const notice=page.locator('[data-share-read-state]');
   await expect(notice).toBeVisible();
   await expect(notice).toHaveAttribute('data-share-read-state',code==='invalid-code'?'not-found':/not-found|unavailable/);
   await expect(notice.getByRole('heading')).toBeVisible();
   await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content',/noindex/);
   await page.addStyleTag({content:'nextjs-portal{display:none!important}'});
   await page.screenshot({path:testInfo.outputPath('bounded-fallback.png')});
   await notice.getByRole('link',{name:'홈으로 이동',exact:true}).click();
   await expect(page).toHaveURL(/\/$/);
   await expect(page.locator('[data-share-read-state]')).toHaveCount(0);
   expect(errors).toEqual([]);
  });
 }
}
for(const size of sizes.slice(1)){
 test(`compact stamp failure retains recovery at ${size.name}`,async({page},testInfo)=>{
  await page.setViewportSize(size);await page.goto('/stamp');
  const alert=page.getByRole('alert').filter({hasText:'도장 맛집을 불러오지 못했습니다'});
  await expect(alert).toBeVisible({timeout:20000});
  const box=await alert.boundingBox();expect(box).not.toBeNull();expect(box!.height).toBeLessThanOrEqual(161);
  await expect(alert.getByRole('button',{name:'다시 시도',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBe(0);
  await page.addStyleTag({content:'nextjs-portal{display:none!important}'});
  await page.screenshot({path:testInfo.outputPath('compact-failure.png')});
 });
}
