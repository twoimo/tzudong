import {launch,setup,ready,metrics,save} from './runtime.mjs';
import {panMockMap,zoomMockMap} from '../../tests/mobile-home-map-helpers.ts';
const run=await launch(),result={receipt:run.receipt,browser:run.browser.version(),cases:[]};
try{for(const mobile of [false,true])for(const count of [3,735,2000]){
 const t=await setup(run.browser,{mobile,count});
 await ready(t.page);const load=await metrics(t.page);const marks=[];
 const start=async(name,action)=>{const before=await t.page.evaluate(()=>performance.now());await action();await t.page.waitForTimeout(500);marks.push({name,start:before,end:await t.page.evaluate(()=>performance.now())});};
 await start('zoom',()=>zoomMockMap(t.page,15));await start('pan',()=>panMockMap(t.page,10,0));
 if(mobile)await t.page.getByLabel('맛집 검색 열기').click();
 await start('search',()=>t.page.getByLabel('맛집 검색어 입력').fill('실험맛집0001'));
 const buttons=t.page.getByRole('button',{name:/실험맛집0001/});
 if(await buttons.count())await start('detail',()=>buttons.first().click());
 await start('back',()=>t.page.goBack());
 const m=await metrics(t.page);result.cases.push({mobile,count,load,metrics:m,marks,requests:t.requests,errors:t.errors});
 console.log(JSON.stringify({mobile,count,loadMs:load.now,dom:m.dom,longTasks:m.longTasks.length,maxTask:Math.max(0,...m.longTasks.map(x=>x.duration)),errors:t.errors}));
 await t.page.screenshot({path:new URL(`explore-${mobile?'mobile':'desktop'}-${count}.png`,import.meta.url).pathname});await t.context.close();
 }
 await save('explore-v1',result);
}finally{await run.close();}
