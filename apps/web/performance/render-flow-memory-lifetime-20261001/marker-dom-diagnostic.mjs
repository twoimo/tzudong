import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {serve,pageSetup,ready} from './real-sdk-runtime.mjs';
const out=new URL('marker-dom-diagnostic-v1/',import.meta.url);await mkdir(out);
process.env.SDK_BASELINE_BUILD_LABEL='field-control-v2';
const server=await serve('baseline'),browser=await chromium.launch({headless:true});let t;
const result={intrusive:true,fieldAdmitted:0,canonicalTimingAdmitted:0};
try {
 t=await pageSetup(browser,{count:735,cpu:4});result.sdk=await ready(t);result.buildId=server.receipt.buildId;
 await t.page.locator('.cluster-marker-container').filter({hasText:'735'}).click();await t.page.waitForFunction(()=>window.__actualSdkProbe.first>0);await t.page.waitForTimeout(600);
 result.dom=await t.page.evaluate(()=>{
  const nodes=Array.from(document.querySelectorAll('[data-testid="marker"]'));
  let textNodes=0,blankTextNodes=0,blankCharacters=0,styleCharacters=0,styleWhitespaceCharacters=0;
  for(const node of nodes){const w=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);while(w.nextNode()){textNodes++;const s=w.currentNode.textContent??'';if(!s.trim()){blankTextNodes++;blankCharacters+=s.length;}}
   for(const e of [node,...node.querySelectorAll('[style]')]){const s=e.getAttribute('style')??'';styleCharacters+=s.length;styleWhitespaceCharacters+=(s.match(/\s/g)??[]).length;}}
  return {markers:nodes.length,textNodes,blankTextNodes,blankCharacters,styleCharacters,styleWhitespaceCharacters,liveElements:document.querySelectorAll('*').length};
 });
 result.passed=result.dom.markers===571;
}finally{if(t)await t.close();await browser.close();await server.close();}
await writeFile(new URL('raw.json',out),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result.dom));
