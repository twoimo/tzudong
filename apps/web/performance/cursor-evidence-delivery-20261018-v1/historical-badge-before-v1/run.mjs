import { chromium,expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile,writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname,resolve,join } from 'node:path';
const root=dirname(fileURLToPath(import.meta.url)),web=resolve(root,'../../..');
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');const file=u.pathname.startsWith('/assets/badges/')?join(web,'public',u.pathname):join(root,'build',u.pathname==='/'?'index.html':u.pathname);if(!file.startsWith(join(root,'build')+'/')&&!file.startsWith(join(web,'public/assets/badges')+'/'))throw Error();const b=await readFile(file);res.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.webp')?'image/webp':'text/html'});res.end(b)}catch{res.writeHead(404);res.end()}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,args:['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const result={browser:browser.version(),source:'1d7ed099f5a3dea2717cecef7c8ed79ff74e53e0',scope:'historical unchanged component code, one fresh context per motion mode, DPR2 software WebGL; fixed 220ms observation, no field/production-performance claim',cases:[]};
try{for(const reduced of [false,true]){
 const context=await browser.newContext({viewport:{width:430,height:860},deviceScaleFactor:2,reducedMotion:reduced?'reduce':'no-preference'});const page=await context.newPage();
 await page.addInitScript(()=>{window.__probe={raf:0,outerEscape:0};const raf=requestAnimationFrame.bind(window);window.requestAnimationFrame=cb=>{window.__probe.raf++;return raf(cb)};window.addEventListener('keydown',e=>{if(e.key==='Escape')window.__probe.outerEscape++})});
 await page.goto(`http://127.0.0.1:${server.address().port}`);await expect(page.getByRole('button',{name:'3D 보기'})).toBeVisible();await page.getByRole('button',{name:'3D 보기'}).click();await expect(page.locator('canvas')).toBeVisible();
 const size=await page.locator('canvas').evaluate(c=>[c.getBoundingClientRect().width,c.getBoundingClientRect().height,c.width,c.height]);
 const start=await page.evaluate(()=>window.__probe.raf);await page.waitForTimeout(220);const end=await page.evaluate(()=>window.__probe.raf);
 await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
 const focusRestored=await page.getByRole('button',{name:'3D 보기'}).evaluate(b=>document.activeElement===b);
 const outerEscape=await page.evaluate(()=>window.__probe.outerEscape);
 expect(size).toEqual([240,240,240,240]);expect(end-start).toBeGreaterThan(0);expect(focusRestored).toBe(false);expect(outerEscape).toBe(1);
 result.cases.push({reducedMotion:reduced,dpr:2,canvas:size,rafDelta:end-start,focusRestored,outerEscape});await context.close();
}result.status='baseline-defects-reproduced'}finally{await writeFile(join(root,'results.json'),JSON.stringify(result,null,2)+'\n');await browser.close();await new Promise(r=>server.close(r))}
console.log(JSON.stringify(result));
