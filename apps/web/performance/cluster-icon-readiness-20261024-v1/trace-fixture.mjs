import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { baseline, bundleFixture, serveFixture } from './fixture.mjs';

// Mechanism follow-up only. Tracing overhead is excluded from paired raw.json.
const results=[];
for(const [width,height] of [[1440,1000],[390,844],[820,1180]]) for(const candidate of [false,true]) {
  const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
  try {
    const page=await browser.newPage({viewport:{width,height}});
    const session=await page.context().newCDPSession(page);
    const events=[];
    session.on('Tracing.dataCollected',batch=>events.push(...batch.value));
    await session.send('Tracing.start',{categories:'devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing',transferMode:'ReportEvents'});
    await serveFixture(page,await bundleFixture(candidate));
    await page.waitForFunction(()=>{const image=document.querySelector('#map img');return image?.complete&&image.naturalWidth>0;});
    await page.evaluate(()=>document.querySelector('#expand').addEventListener('click',()=>performance.mark('fixture.expand'),{capture:true}));
    await page.locator('#expand').click();
    await page.waitForFunction(()=>[...document.querySelectorAll('#map img')].length===76&&[...document.querySelectorAll('#map img')].every(image=>image.complete&&image.naturalWidth>0));
    // Give the compositor its next two presentation opportunities, equally in
    // both arms, before stopping the diagnostic trace.
    await page.evaluate(()=>new Promise(resolveFrame=>requestAnimationFrame(()=>requestAnimationFrame(resolveFrame))));
    const completed=new Promise(resolveComplete=>session.once('Tracing.tracingComplete',resolveComplete));
    await session.send('Tracing.end');await completed;
    const expand=events.find(event=>event.name==='fixture.expand');
    if(!expand) throw new Error('Missing expansion timeline mark');
    const imageEvents=events.filter(event=>/decode.*image|image.*decode/i.test(event.name)).map(event=>({name:event.name,phase:event.ph,
      relativeToExpansionMs:(event.ts-expand.ts)/1000,durationMs:typeof event.dur==='number'?event.dur/1000:null,thread:event.tid}));
    results.push({width,height,candidate,expandMarkObserved:true,imageEvents,
      completeDecodeTaskDurationSumMs:imageEvents.filter(event=>event.phase==='X'&&event.durationMs!==null).reduce((sum,event)=>sum+event.durationMs,0)});
  } finally {await browser.close();}
}
writeFileSync(resolve(import.meta.dir,'decode-trace-summary.json'),JSON.stringify({baseline,recordedAt:new Date().toISOString(),
  scope:'Six separate local mechanism traces; event duration sums may overlap threads and are not interaction elapsed times or production measurements.',results},null,2)+'\n');
console.log(JSON.stringify(results.map(({width,candidate,imageEvents,completeDecodeTaskDurationSumMs})=>({width,candidate,events:imageEvents.length,completeDecodeTaskDurationSumMs}))));
