import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile,writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname,resolve,join } from 'node:path';
import { createHash } from 'node:crypto';
const root=dirname(fileURLToPath(import.meta.url));
const web=resolve(root,'../../..');
const server=createServer(async(req,res)=>{
 try {
  const pathname=new URL(req.url,'http://localhost').pathname;
  const file=pathname.startsWith('/assets/badges/')?join(web,'public',pathname):join(root,'build',pathname==='/'?'index.html':pathname);
  if(!file.startsWith(join(root,'build')+'/')&&!file.startsWith(join(web,'public/assets/badges')+'/'))throw Error();
  const bytes=await readFile(file);
  res.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.webp')?'image/webp':'text/html'});res.end(bytes);
 } catch {res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,args:['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const results={observationWindowMs:220,scope:'production-mode component harness, synthetic tier, software WebGL; not full-app deployed/physical/field proof',browser:browser.version(),cases:[]};
try {
 for(const reduced of [false,true]) {
  const context=await browser.newContext({viewport:{width:430,height:860},deviceScaleFactor:2,reducedMotion:reduced?'reduce':'no-preference'});
  const page=await context.newPage();
  const scripts=[];page.on('request',r=>{if(r.resourceType()==='script')scripts.push(new URL(r.url()).pathname)});
  const errors=[];page.on('pageerror',e=>errors.push(createHash('sha256').update(e.message).digest('hex')));
  await page.addInitScript(()=>{
   window.__badgeProbe={raf:0,contexts:[],outerEscape:0};
   const raf=window.requestAnimationFrame.bind(window);
   window.requestAnimationFrame=(cb)=>{window.__badgeProbe.raf++;return raf(cb)};
   window.addEventListener('keydown',e=>{if(e.key==='Escape')window.__badgeProbe.outerEscape++});
   const original=HTMLCanvasElement.prototype.getContext;
   const seen=new WeakSet();
   HTMLCanvasElement.prototype.getContext=function(...args){
    const gl=original.apply(this,args);
    if(gl&&/webgl/.test(args[0])&&!seen.has(gl)) {
     seen.add(gl);const record={canvas:this,gl,lossCalls:0};window.__badgeProbe.contexts.push(record);
     const getExtension=gl.getExtension.bind(gl);const wrapped=new WeakSet();
     gl.getExtension=function(name){
      const extension=getExtension(name);
      if(name==='WEBGL_lose_context'&&extension&&!wrapped.has(extension)){
       wrapped.add(extension);const lose=extension.loseContext.bind(extension);
       extension.loseContext=()=>{record.lossCalls++;lose()};
      }
      return extension;
     };
    }
    return gl;
   };
  });
  await page.goto(url);
  const img=page.locator('.tz-popularity-badge img');
  await expect(img).toBeVisible();await img.evaluate(i=>i.decode());
  expect(await img.evaluate(i=>i.currentSrc.endsWith('_80.webp'))).toBe(true);
  expect(await page.locator('canvas').count()).toBe(0);
  expect(await page.evaluate(()=>window.__badgeProbe.contexts.length)).toBe(0);
  const opener=page.getByRole('button',{name:'3D 보기'});
  const beforeScripts=scripts.slice();
  await opener.click();
  await expect(page.getByRole('dialog')).toBeVisible();await expect(page.locator('canvas')).toBeVisible();
  expect(await page.locator('canvas').evaluate(c=>[c.getBoundingClientRect().width,c.getBoundingClientRect().height,c.width,c.height])).toEqual([120,120,240,240]);
  const openedScripts=scripts.filter(path=>!beforeScripts.includes(path));
  expect(openedScripts.length).toBeGreaterThan(0);
  const first=await page.locator('canvas').screenshot();
  const r1=await page.evaluate(()=>window.__badgeProbe.raf);
  await page.waitForTimeout(220);
  const r2=await page.evaluate(()=>window.__badgeProbe.raf);
  const second=await page.locator('canvas').screenshot();
  if(reduced){expect(r2-r1).toBe(0);expect(first.equals(second)).toBe(true)}else{expect(r2-r1).toBeGreaterThan(0);expect(first.equals(second)).toBe(false)}
  await page.screenshot({path:join(root,`badge-v3-${reduced?'reduced':'animated'}-dpr2.png`)});
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(opener).toBeFocused();
  const after=await page.evaluate(()=>({outerEscape:window.__badgeProbe.outerEscape,lossCalls:window.__badgeProbe.contexts[0].lossCalls,raf:window.__badgeProbe.raf}));
  expect(after.outerEscape).toBe(0);expect(after.lossCalls).toBe(1);
  await page.waitForTimeout(100);expect(await page.evaluate(()=>window.__badgeProbe.raf)).toBe(after.raf);
  // Repeated open/close must free each context, and genuine loss recovers at most once.
  for(let i=0;i<3;i++){await opener.click();await expect(page.locator('canvas')).toBeVisible();await page.getByRole('button',{name:'닫기',exact:true}).click();await expect(opener).toBeFocused()}
  await opener.click();await expect(page.locator('canvas')).toBeVisible();
  const beforeLoss=await page.evaluate(()=>window.__badgeProbe.contexts.length);
  await page.evaluate(()=>window.__badgeProbe.contexts.at(-1).gl.getExtension('WEBGL_lose_context').loseContext());
  await expect.poll(()=>page.evaluate(()=>window.__badgeProbe.contexts.length)).toBe(beforeLoss+1);
  await page.evaluate(()=>window.__badgeProbe.contexts.at(-1).gl.getExtension('WEBGL_lose_context').loseContext());
  await expect(page.locator('[data-badge-viewer="fallback"]')).toBeVisible();
  await expect(page.locator('canvas')).toHaveCount(0);
  await page.getByRole('button',{name:'닫기',exact:true}).click();await expect(opener).toBeFocused();
  const contexts=await page.evaluate(()=>window.__badgeProbe.contexts.map(r=>({connected:r.canvas.isConnected,lossCalls:r.lossCalls})));
  expect(contexts.every(r=>!r.connected&&r.lossCalls>=1)).toBe(true);
  expect(errors).toEqual([]);
  results.cases.push({reducedMotion:reduced,scriptsBeforeOpen:beforeScripts,dynamicallyLoadedScripts:openedScripts,dpr:2,cssSize:[120,120],drawingBuffer:[240,240],rafDelta:r2-r1,framePixelsChanged:!first.equals(second),focusRestored:true,escapeContained:true,contextTeardown:contexts,errors});
  await context.close();
 }
 // Failure state is scoped to the restaurant/tier key, not sticky across another restaurant.
 const context=await browser.newContext();const page=await context.newPage();let blocked=true;
 await page.route('**/assets/badges/**',route=>blocked?route.abort():route.continue());
 await page.goto(url);await expect(page.locator('.tz-popularity-badge')).toHaveCount(0);
 blocked=false;await page.getByRole('button',{name:'Change restaurant'}).click();await expect(page.locator('.tz-popularity-badge img')).toBeVisible();
 await page.getByRole('button',{name:'Change tier'}).click();await expect(page.locator('img')).toHaveAttribute('src',/rainbow/);
 results.failureRemount={recoveredOnRestaurantChange:true,tierChangeShowsNewImage:true};await context.close();
 results.status='passed';
} catch(error) {results.status='failed';results.failure=String(error);throw error}
finally {await writeFile(join(root,'results-v3.json'),JSON.stringify(results,null,2)+'\n');await browser.close();await new Promise(r=>server.close(r))}
console.log(JSON.stringify(results));
