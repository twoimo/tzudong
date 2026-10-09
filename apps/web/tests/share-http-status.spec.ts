import {expect,test} from '@playwright/test';
test.beforeEach(({}, testInfo) => {
 test.skip(testInfo.config.metadata.shortUrlHttpFixture !== true, 'Requires the owned synthetic read-only dev/production fixture; this is not an operating-server assertion.');
});
const uuid='00000000-0000-4000-8000-000000000009';
for(const code of ['invalid-code','MISSNG','FAIL00','CTRL00']){
 test(`HTTP status and bounded recovery for ${code}`,async({page,request},testInfo)=>{
  const expected=code==='FAIL00'||code==='CTRL00'?503:404;
  const response=await request.get(`/s/${code}`,{maxRedirects:0});expect(response.status()).toBe(expected);
  expect(response.headers()['x-robots-tag']).toContain('noindex');expect(response.headers()['content-type']).toContain('text/html');
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.name));
  const navigation=await page.goto(`/s/${code}`);expect(navigation?.status()).toBe(expected);
  const notice=page.locator('[data-share-read-state]');await expect(notice).toHaveAttribute('data-share-read-state',code==='FAIL00'||code==='CTRL00'?'unavailable':'not-found');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content',/noindex/);
  await expect(notice.getByRole('heading')).toBeVisible();
  if(code==='FAIL00'||code==='CTRL00')await expect(notice.getByRole('link',{name:'다시 조회',exact:true})).toHaveAttribute('href',`/s/${code}`);
  await page.keyboard.press('Tab');await expect(notice.getByRole('link').first()).toBeFocused();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBe(0);
  await page.screenshot({path:testInfo.outputPath('status-notice.png')});
  await notice.getByRole('link',{name:'홈으로 이동',exact:true}).click();await expect(page).toHaveURL(/\/$/);expect(errors).toEqual([]);
 });
}
test('valid review and unsafe target retain HTTP307 with no response-body success substitution',async({request})=>{
 const valid=await request.get('/s/VALID1',{maxRedirects:0});expect(valid.status()).toBe(307);expect(valid.headers().location).toBe(`/?review=${uuid}`);
 const unsafe=await request.get('/s/BADURL',{maxRedirects:0});expect(unsafe.status()).toBe(307);expect(unsafe.headers().location).toBe('/');
});
for(const scheme of ['light','dark'] as const){
 test(`standalone CSS system ${scheme} supports small viewport and visible focus`,async({page},testInfo)=>{
  await page.setViewportSize({width:390,height:600});await page.emulateMedia({colorScheme:scheme,reducedMotion:'reduce'});
  const response=await page.goto('/s/invalid-code');expect(response?.status()).toBe(404);
  await expect.poll(()=>page.evaluate(()=>getComputedStyle(document.documentElement).colorScheme)).toBe(scheme);
  await page.keyboard.press('Tab');const home=page.getByRole('link',{name:'홈으로 이동',exact:true});await expect(home).toBeFocused();
  expect(await home.evaluate(element=>getComputedStyle(element).outlineStyle)).toBe('solid');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBe(0);
  await page.screenshot({path:testInfo.outputPath(`notice-${scheme}.png`)});
 });
}
