import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
const here=new URL('./',import.meta.url),out=new URL('live-logo-current-v1/',here);await mkdir(out);
const delivery=JSON.parse(await readFile(new URL('memory-release-rollback-live-v1.json',here)));
assert.equal(delivery.deployment.state,'READY');
const asset='/logo-png-129-8d374bb80346.png',expected='8d374bb803469959cb37a2f6193f177d063265d077f717de0dc6dcc64bc3a646';
const browser=await chromium.launch({channel:'chrome',headless:true});
const result={sourceSha:delivery.deployment.gitSha,browser:await browser.version(),transport:'real public HTTPS, SDK/data/assets unchanged',fieldAdmitted:0,physicalDevice:false,cases:[],passed:false};
try{
 for(const [name,width,height,mobile] of [['desktop',1440,900,false],['mobile',384,824,true],['tablet',768,1024,true]])for(const theme of ['light','dark']){
  const context=await browser.newContext({viewport:{width,height},isMobile:mobile,hasTouch:mobile,locale:'ko-KR',serviceWorkers:'block'}),page=await context.newPage();
  const row={name,theme,viewport:{width,height},cssDarkNotSamsungForced:true,errors:{page:0,console:0},passed:false};
  page.on('pageerror',()=>row.errors.page++);page.on('console',m=>{if(m.type()==='error')row.errors.console++;});
  try{
   await page.goto('https://www.tzudong.app/?__qa=transparent-logo-current',{waitUntil:'domcontentloaded',timeout:45000});
   await page.waitForFunction(()=>!!window.naver?.maps?.Map&&document.querySelectorAll('.cluster-marker-container,[data-testid="marker"]').length>0,null,{timeout:60000});
   const logo=page.locator('img[src="'+asset+'"]').first();await logo.waitFor({state:'visible'});
   await page.waitForFunction(path=>Array.from(document.images).some(i=>i.getAttribute('src')===path&&i.complete&&i.naturalWidth===129),asset);
   await page.evaluate(t=>document.documentElement.classList.toggle('dark',t==='dark'),theme);
   row.observed=await page.evaluate(async path=>{
    const image=Array.from(document.images).find(i=>i.getAttribute('src')===path&&i.getBoundingClientRect().width>0);
    const c=document.createElement('canvas');c.width=image.naturalWidth;c.height=image.naturalHeight;const x=c.getContext('2d');x.drawImage(image,0,0);
    const response=await fetch(path,{credentials:'omit',referrerPolicy:'no-referrer'}),bytes=await response.arrayBuffer();
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
    const alpha=[[0,0],[128,0],[0,128],[128,128],[64,64],[64,51]].map(([a,b])=>x.getImageData(a,b,1,1).data[3]);
    return {status:response.status,contentType:response.headers.get('content-type'),bytes:bytes.byteLength,sha256:hash,naturalWidth:image.naturalWidth,alpha,background:getComputedStyle(image).backgroundColor,optimizerBypassed:!image.currentSrc.includes('/_next/image'),sdkLoaded:!!window.naver?.maps?.Map,stub:!!document.querySelector('script[data-local-naver-maps="true"]'),overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth)};
   },asset);
   const v=row.observed;assert.equal(v.status,200);assert.equal(v.sha256,expected);assert.equal(v.bytes,24213);assert.ok(v.alpha.every(a=>a===0));assert.equal(v.background,'rgba(0, 0, 0, 0)');assert.ok(v.optimizerBypassed&&v.sdkLoaded&&!v.stub);assert.equal(v.overflow,0);
   const b=await logo.boundingBox();assert.ok(b);row.screenshot=name+'-'+theme+'.png';
   await page.screenshot({path:new URL(row.screenshot,out).pathname,clip:{x:Math.max(0,b.x-6),y:Math.max(0,b.y-6),width:Math.min(210,width-Math.max(0,b.x-6)),height:Math.min(52,height-Math.max(0,b.y-6))}});
   row.passed=true;console.log(JSON.stringify({name,theme,passed:true,alpha:v.alpha,status:v.status}));
  }catch{row.failure='bounded_live_logo_invariant_unavailable';}
  finally{result.cases.push(row);await context.close();}
 }
 result.passed=result.cases.length===6&&result.cases.every(c=>c.passed);
}finally{await browser.close();await writeFile(new URL('raw.json',out),JSON.stringify(result,null,2)+'\n',{flag:'wx'});}
if(!result.passed)process.exitCode=1;
