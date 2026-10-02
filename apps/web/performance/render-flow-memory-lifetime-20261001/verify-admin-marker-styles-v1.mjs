import {chromium} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
const here=new URL('./',import.meta.url),fixtures=JSON.parse(await readFile(new URL('marker-html-fixtures-shared-css-v2.json',here)));
import {readRouteCss,verifyBuildRouteCssBoundaries} from '../../scripts/verify-route-css-boundaries.mjs';
import {createHash} from 'node:crypto';
const app=new URL('../../',here),dir=new URL('.next-real-sdk-candidate-final-v1-20260930/',app);
const route=readRouteCss(dir.pathname,await readFile(new URL('server/app/admin/page_client-reference-manifest.js',dir),'utf8'),'/admin/page');
const budgets=verifyBuildRouteCssBoundaries({nextDirectory:dir.pathname});
const beforeDir=new URL('.next-real-sdk-candidate-retry-v1-20260930/',app);
const beforeRoute=readRouteCss(beforeDir.pathname,await readFile(new URL('server/app/admin/page_client-reference-manifest.js',beforeDir),'utf8'),'/admin/page');
const hasMarkerStyles=route.css.includes('.tzudong-marker-picture');
const beforeHadMarkerStyles=beforeRoute.css.includes('.tzudong-marker-picture');
const browser=await chromium.launch({headless:true});let result;
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});const css=route.css;await page.setContent('<style>'+css+'</style><main></main>');
 result=await page.evaluate(rows=>{
  const results=[];
  for(const row of rows){
   const b=document.createElement('div'),a=document.createElement('div');b.innerHTML=row.before;a.innerHTML=row.after;document.querySelector('main').replaceChildren(b,a);
   const before=[b,...b.querySelectorAll('*')],after=[a,...a.querySelectorAll('*')];let identical=before.length===after.length;
   for(let i=0;i<before.length&&identical;i++){
    const x=before[i],y=after[i];if(x.tagName!==y.tagName){identical=false;break;}
    const attrs=e=>Array.from(e.attributes).filter(x=>x.name!=='style').map(x=>[x.name,x.name==='class'?x.value.split(' ').filter(c=>!['tzudong-individual-marker','tzudong-marker-picture','tzudong-marker-image'].includes(c)).join(' '):x.value]).filter(x=>x[1]!==''||x[0]!=='class');
    if(JSON.stringify(attrs(x))!==JSON.stringify(attrs(y)))identical=false;
    const xc=getComputedStyle(x),yc=getComputedStyle(y);
    for(const name of Array.from(xc))if(xc.getPropertyValue(name)!==yc.getPropertyValue(name))identical=false;
    const xr=x.getBoundingClientRect(),yr=y.getBoundingClientRect();if(Math.abs(xr.width-yr.width)>.01||Math.abs(xr.height-yr.height)>.01)identical=false;
   }
   if(b.textContent.replace(/\s+/g,' ').trim()!==a.textContent.replace(/\s+/g,' ').trim())identical=false;
   const blank=e=>{let n=0;const w=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);while(w.nextNode())if(!w.currentNode.textContent.trim())n++;return n;};
   results.push({category:row.category,selected:row.selected,visits:row.visits,identicalCssAttributesTextAndBox:identical,beforeBlankTextNodes:blank(b),afterBlankTextNodes:blank(a),beforeCharacters:row.before.length,afterCharacters:row.after.length});
  }
  return {cases:results,passed:results.every(r=>r.identicalCssAttributesTextAndBox&&r.afterBlankTextNodes===0)};
 },fixtures);
}finally{await browser.close();}
Object.assign(result,{actualUserSamples:0,fieldAdmitted:0,canonicalTimingAdmitted:0,scope:'actual compiled /admin route CSS with24 codegenerated public marker cases; no privileged admin data accessed',hasMarkerStyles,beforeHadMarkerStyles,compiledCssSha256:createHash('sha256').update(route.css).digest('hex'),adminCssBytes:route.bytes,adminTransferBytes:route.transferBytes,allRouteCssBudgets:budgets});
await writeFile(new URL('admin-marker-compiled-css-equivalence-v1.json',here),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({passed:result.passed,cases:result.cases.length,hasMarkerStyles,beforeHadMarkerStyles,adminTransferBytes:route.transferBytes,homeTransferBytes:budgets.homeTransferBytes}));if(!result.passed||!hasMarkerStyles||beforeHadMarkerStyles)process.exitCode=1;
