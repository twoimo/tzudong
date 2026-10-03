import {chromium} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();
const result={productionBuildSource:'bca48572eabd1f20eaf6ff529141c43460d25ad5',browser:await browser.version(),freshIsolatedContext:true,compiledWwwTransport:'Only GET www requests fulfilled from the owned localhost production build; actual CSP preserved; not live deployment evidence',remoteFontNotIntercepted:true,fieldAdmitted:0,requests:[],passed:false};
try{
 await page.route('https://www.tzudong.app/**',async route=>{
  if(route.request().method()!=='GET')return route.abort();const u=new URL(route.request().url());u.protocol='http:';u.hostname='localhost';u.port='3000';const r=await fetch(u,{redirect:'manual'}),headers=Object.fromEntries(r.headers);delete headers['content-encoding'];delete headers['content-length'];delete headers['set-cookie'];await route.fulfill({status:r.status,headers,body:Buffer.from(await r.arrayBuffer())});
 });
 await page.route('**/rest/v1/**',r=>r.fulfill({status:200,contentType:'application/json',body:'[]',headers:{'access-control-allow-origin':'https://www.tzudong.app','access-control-allow-headers':'apikey, authorization, content-type, x-client-info'}}));
 await page.route('**/_vercel/**',r=>r.abort());
 page.on('response',response=>{const u=new URL(response.url());if(u.hostname==='assets.tzudong.app')result.requests.push({status:response.status(),fontObjectMatched:u.pathname==='/sha256-8c2eeb55898708b108032eb0baddabfbf7c98a78c3411a2f2601c7bdeff1cfb7--ChosunCentennial_otf.otf'});});
 await page.goto('https://www.tzudong.app/?__qa=font-delivery',{waitUntil:'domcontentloaded'});
 result.font=await page.evaluate(async()=>{const face=new FontFace('ChosunQA','url("/fonts/ChosunCentennial_otf.otf") format("opentype")');await face.load();document.fonts.add(face);return {status:face.status,checked:document.fonts.check('16px ChosunQA'),origin:location.origin};});
 assert.equal(result.font.status,'loaded');assert.ok(result.font.checked);assert.ok(result.requests.some(x=>x.status===200&&x.fontObjectMatched));result.passed=true;
}catch{result.failure='bounded compiled-browser font loading failed';process.exitCode=1;}finally{await context.close();await browser.close();await writeFile(new URL('font-browser-compiled-v1.json',import.meta.url),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));}
