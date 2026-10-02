import {chromium} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
const here=new URL('./',import.meta.url),fixtures=JSON.parse(await readFile(new URL('marker-html-fixtures-shared-css-v1.json',here)));
const browser=await chromium.launch({headless:true});let result;
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});const css=await readFile(new URL('../../components/map/marker-icons.css',here),'utf8');await page.setContent('<style>'+css+'</style><main></main>');
 result=await page.evaluate(rows=>{
  const results=[];
  for(const row of rows){
   const b=document.createElement('div'),a=document.createElement('div');b.innerHTML=row.before;a.innerHTML=row.after;document.querySelector('main').replaceChildren(b,a);
   const before=[b,...b.querySelectorAll('*')],after=[a,...a.querySelectorAll('*')];let differences=[];let identical=before.length===after.length;
   for(let i=0;i<before.length&&identical;i++){
    const x=before[i],y=after[i];if(x.tagName!==y.tagName){identical=false;break;}
    const attrs=e=>Array.from(e.attributes).filter(x=>x.name!=='style').map(x=>[x.name,x.name==='class'?x.value.split(' ').filter(c=>!['tzudong-individual-marker','tzudong-marker-picture','tzudong-marker-image'].includes(c)).join(' '):x.value]).filter(x=>x[1]!==''||x[0]!=='class');
    if(JSON.stringify(attrs(x))!==JSON.stringify(attrs(y))){identical=false;differences.push({element:i,kind:'attrs',before:attrs(x),after:attrs(y)});}
    const xc=getComputedStyle(x),yc=getComputedStyle(y);
    for(const name of Array.from(xc))if(xc.getPropertyValue(name)!==yc.getPropertyValue(name)){identical=false;differences.push({element:i,property:name,before:xc.getPropertyValue(name),after:yc.getPropertyValue(name)});}
    const xr=x.getBoundingClientRect(),yr=y.getBoundingClientRect();if(Math.abs(xr.width-yr.width)>.01||Math.abs(xr.height-yr.height)>.01)identical=false;
   }
   if(b.textContent.replace(/\s+/g,' ').trim()!==a.textContent.replace(/\s+/g,' ').trim())identical=false;
   const blank=e=>{let n=0;const w=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);while(w.nextNode())if(!w.currentNode.textContent.trim())n++;return n;};
   results.push({differences:differences.slice(0,10),category:row.category,selected:row.selected,visits:row.visits,identicalCssAttributesTextAndBox:identical,beforeBlankTextNodes:blank(b),afterBlankTextNodes:blank(a),beforeCharacters:row.before.length,afterCharacters:row.after.length});
  }
  return {cases:results,passed:results.every(r=>r.identicalCssAttributesTextAndBox&&r.afterBlankTextNodes===0)};
 },fixtures);
}finally{await browser.close();}
Object.assign(result,{actualUserSamples:0,fieldAdmitted:0,canonicalTimingAdmitted:0,scope:'codegenerated marker fixtures, browser CSSOM/box/a11y/text equivalence, not wholeUI performance/flicker'});
await writeFile(new URL('marker-html-browser-shared-css-diagnostic-v1.json',here),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({passed:result.passed,cases:result.cases.length}));if(!result.passed)process.exitCode=1;
