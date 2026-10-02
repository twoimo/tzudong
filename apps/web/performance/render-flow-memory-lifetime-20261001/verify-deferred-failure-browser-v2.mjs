import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {serve,pageSetup,ready} from './real-sdk-runtime.mjs';
const label=process.argv[2],build=process.argv[3];if(!/^[a-z0-9-]+$/.test(label)||!/^[a-z0-9-]+$/.test(build))throw Error('new label/build required');
const out=new URL(`deferred-failure-${label}/`,import.meta.url);await mkdir(out);process.env.SDK_CANDIDATE_BUILD_LABEL=build;
const result={label,build,startedAt:new Date().toISOString(),fieldAdmitted:0,performanceAdmitted:0,scope:'actual remote Naver SDK with explicitly injected offscreen LatLng constructor failure after provider readiness; diagnostic, not performance SDK proof',injectedSyntheticId:'00000000-0000-4000-8000-000000000000'};
let server,browser,t;
try{
 server=await serve('candidate');result.buildId=server.receipt.buildId;result.inputs=server.receipt.inputs;browser=await chromium.launch({headless:true});t=await pageSetup(browser,{count:735,cpu:4});
 result.sdk=await ready(t);
 await t.page.evaluate(()=>{const maps=window.naver.maps;window.__ownedFault={count:0,timestamps:[]};const proxy=new Proxy(maps.LatLng,{construct(target,args,newTarget){if(Number(args[0])===37.5){window.__ownedFault.count++;window.__ownedFault.timestamps.push(performance.now());throw Error('synthetic_owned_offscreen_position_failure');}return Reflect.construct(target,args,newTarget);}});maps.LatLng=proxy;window.__ownedFault.installed=maps.LatLng===proxy;});
 result.faultInstallation=await t.page.evaluate(()=>({installed:window.__ownedFault.installed,offscreenSyntheticLatitude:37.5}));
 await t.page.locator('.cluster-marker-container').filter({hasText:'735'}).click();await t.page.waitForFunction(()=>window.__actualSdkProbe.first>0);await t.page.waitForTimeout(3000);
 result.first=await t.page.evaluate(()=>({faults:window.__ownedFault.count,time:performance.now(),visible:document.visibilityState,markers:document.querySelectorAll('[data-testid=marker]').length,mapCreates:window.__actualSdkProbe.sdkMapCreates}));
 await t.page.waitForTimeout(1500);result.second=await t.page.evaluate(()=>({faults:window.__ownedFault.count,time:performance.now(),timestamps:window.__ownedFault.timestamps,visible:document.visibilityState,markers:document.querySelectorAll('[data-testid=marker]').length,mapCreates:window.__actualSdkProbe.sdkMapCreates}));
 result.sixRetryLimitPlusInitial=7;result.bounded=result.first.faults<=7&&result.first.faults===result.second.faults&&result.second.faults>0;result.visibleContentRetained=result.second.markers>0&&result.second.mapCreates===1&&result.second.visible==='visible';
 await t.page.screenshot({path:new URL('visible-map.png',out).pathname});
}catch{result.failureCode='owned_failure_diagnostic_unavailable';}
finally{if(t)await t.close();if(browser)await browser.close();if(server)await server.close();}
result.endedAt=new Date().toISOString();await writeFile(new URL('raw.json',out),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({build,bounded:result.bounded,visibleContentRetained:result.visibleContentRetained,firstFaults:result.first?.faults,secondFaults:result.second?.faults,failureCode:result.failureCode}));
