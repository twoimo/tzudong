import {chromium,expect} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile,writeFile,access} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const phase=process.argv[2];if(!['before','after'].includes(phase))throw Error('INVALID_PHASE');
const root=dirname(fileURLToPath(import.meta.url)),web=resolve(root,'../../..'),build=join(root,phase+'-build');
const output=join(root,'results-'+phase+'.json');try{await access(output);throw Error('PRESERVE_EXISTING_RESULT')}catch(e){if(e.code!=='ENOENT')throw e}
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;
 const file=path.startsWith('/assets/badges/')?join(web,'public',path):join(build,path==='/'?'index.html':path);
 if(!file.startsWith(build+'/')&&!file.startsWith(join(web,'public/assets/badges')+'/'))throw Error('OUTSIDE_FIXTURE');
 const bytes=await readFile(file);res.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.webp')?'image/webp':'text/html'});res.end(bytes);
}catch{res.writeHead(404);res.end()}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({args:['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const profiles=[{name:'high-motion',cores:8,memory:8,low:false,reduced:false},{name:'high-reduced',cores:8,memory:8,low:false,reduced:true},{name:'low-memory',cores:2,memory:2,low:true,reduced:false},{name:'low-no-memory-api',cores:2,memory:null,low:true,reduced:false}];
const result={phase,sourceSha256:createHash('sha256').update(await readFile(join(web,'components/restaurant/PopularityBadge.tsx'))).digest('hex'),browser:browser.version(),scope:'production React/actual PopularityBadge/device hook/dynamic viewer; synthetic hardware profiles, software WebGL; one browser process, one context per profile, three dependent opens/context; not device/field/process-memory/timing gain',observationWindowMs:220,profiles:[]};
try{for(const profile of profiles){const context=await browser.newContext({viewport:{width:430,height:860},deviceScaleFactor:2,reducedMotion:profile.reduced?'reduce':'no-preference'});const page=await context.newPage();const errors=[],scripts=[];
 page.on('pageerror',e=>errors.push(createHash('sha256').update(e.message).digest('hex')));page.on('request',r=>{if(r.resourceType()==='script')scripts.push(new URL(r.url()).pathname)});
 await page.addInitScript(({cores,memory})=>{Object.defineProperty(navigator,'hardwareConcurrency',{get:()=>cores,configurable:true});Object.defineProperty(navigator,'deviceMemory',{get:()=>memory===null?undefined:memory,configurable:true});
  window.__probe={raf:0,contexts:[],outerEscape:0};const raf=requestAnimationFrame.bind(window);window.requestAnimationFrame=fn=>{window.__probe.raf++;return raf(fn)};
  window.addEventListener('keydown',e=>{if(e.key==='Escape')window.__probe.outerEscape++});const original=HTMLCanvasElement.prototype.getContext,seen=new WeakSet();
  HTMLCanvasElement.prototype.getContext=function(...args){const gl=original.apply(this,args);if(gl&&/webgl/.test(args[0])&&!seen.has(gl)){seen.add(gl);const record={canvas:this,lossCalls:0};window.__probe.contexts.push(record);const get=gl.getExtension.bind(gl),wrapped=new WeakSet();gl.getExtension=name=>{const ext=get(name);if(name==='WEBGL_lose_context'&&ext&&!wrapped.has(ext)){wrapped.add(ext);const lose=ext.loseContext.bind(ext);ext.loseContext=()=>{record.lossCalls++;lose()}}return ext}}return gl};
 },profile);
 await page.goto(url);await expect(page.locator('main')).toHaveAttribute('data-low-end',String(profile.low));
 const img=page.locator('.tz-popularity-badge img');await expect(img).toBeVisible();await img.evaluate(x=>x.decode());expect(await page.locator('canvas').count()).toBe(0);
 const opener=page.getByRole('button',{name:'3D 보기'});const beforeScripts=scripts.slice(),observations=[];
 for(let i=0;i<3;i++){await opener.click();await expect(page.getByRole('dialog')).toBeVisible();const expectedFallback=phase==='after'&&profile.low;
  if(expectedFallback){await expect(page.locator('[data-badge-viewer="fallback"]')).toBeVisible();await expect(page.getByText('정적 배지로 표시합니다.',{exact:true})).toBeVisible();await expect(page.locator('canvas')).toHaveCount(0)}
  else{await expect(page.locator('canvas')).toBeVisible();expect(await page.locator('canvas').evaluate(x=>[x.getBoundingClientRect().width,x.getBoundingClientRect().height,x.width,x.height])).toEqual([120,120,240,240])}
  const start=await page.evaluate(()=>window.__probe.raf);await page.waitForTimeout(220);const end=await page.evaluate(()=>window.__probe.raf);
  if(expectedFallback||profile.reduced)expect(end-start).toBe(0);else expect(end-start).toBeGreaterThan(0);
  observations.push({open:i+1,canvasCount:await page.locator('canvas').count(),rafDelta:end-start,viewerState:await page.getByRole('dialog').getAttribute('data-badge-viewer')});
  if(i===0)await page.screenshot({path:join(root,`${phase}-${profile.name}.png`)});
  if(i%2===0)await page.keyboard.press('Escape');else await page.getByRole('button',{name:'닫기',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);await expect(opener).toBeFocused();
 }
 const teardown=await page.evaluate(()=>({contexts:window.__probe.contexts.map(r=>({connected:r.canvas.isConnected,lossCalls:r.lossCalls})),outerEscape:window.__probe.outerEscape}));
 expect(teardown.outerEscape).toBe(0);expect(teardown.contexts.every(r=>!r.connected&&r.lossCalls>=1)).toBe(true);if(phase==='after'&&profile.low)expect(teardown.contexts).toEqual([]);else expect(teardown.contexts).toHaveLength(3);expect(errors).toEqual([]);
 result.profiles.push({...profile,observations,contextCount:teardown.contexts.length,teardown,scriptsBeforeOpen:beforeScripts,openedScripts:scripts.filter(x=>!beforeScripts.includes(x)),focusRestored:true,errors});await context.close();
}result.status='passed';}catch(e){result.status='failed';result.failure=String(e);throw e}finally{await writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});await browser.close();await new Promise(r=>server.close(r))}
console.log(JSON.stringify(result));
