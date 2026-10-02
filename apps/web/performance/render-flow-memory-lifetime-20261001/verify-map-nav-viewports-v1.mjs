import {writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
import {serve,pageSetup,ready} from './real-sdk-runtime.mjs';
import {verifyBuildRouteCssBoundaries} from '../../scripts/verify-route-css-boundaries.mjs';
const result={scope:'production nav-v4 actual remote SDK; synthetic public REST; viewport changes and pan',cases:[],fieldAdmitted:0};
process.env.SDK_CANDIDATE_BUILD_LABEL='nav-v4';const server=await serve('candidate'),browser=await chromium.launch({headless:true});
let t;
try {
 result.cssBudget=verifyBuildRouteCssBoundaries({nextDirectory:new URL('../../'+server.receipt.distDir+'/',import.meta.url).pathname});
 t=await pageSetup(browser,{mobile:true,count:735,cpu:1});await ready(t);
 for(const size of [{width:390,height:844},{width:467,height:810},{width:844,height:390},{width:1279,height:900},{width:1280,height:900},{width:1440,height:900},{width:390,height:844}]){
  await t.page.setViewportSize(size);await t.page.waitForTimeout(450);
  const check=await t.page.evaluate(()=>{const map=document.querySelector('[data-testid=map-container]').getBoundingClientRect(),nav=document.querySelector('.mobile-bottom-nav'),n=nav?.getBoundingClientRect(),copyright=document.querySelector('.map_copyright')?.getBoundingClientRect();return {width:innerWidth,height:innerHeight,mapBottom:map.bottom,mapHeight:map.height,navTop:n?.top??null,navHeight:n?.height??null,mapCreates:window.__actualSdkProbe.sdkMapCreates,overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth),copyrightBottom:copyright?.bottom??null,retired:getComputedStyle(document.querySelector('[data-home-static-skeleton]')).display==='none'};});
  const isMobile=check.width<1280;
  result.cases.push({...check,passed:check.mapCreates===1&&check.overflow===0&&check.mapHeight>0&&(isMobile?Math.abs(check.mapBottom-check.navTop)<.5&&check.copyrightBottom<=check.navTop+.5:check.navTop===null&&Math.abs(check.mapBottom-check.height)<.5)});
 }
 await t.page.screenshot({path:new URL('map-nav-candidate-portrait-v1.png',import.meta.url).pathname});
 result.passed=result.cases.every(x=>x.passed);
}catch{result.passed=false;result.failureCode='map_nav_viewport_validation_unavailable';}
finally {if(t)await t.close();await browser.close();await server.close();}
await writeFile(new URL('map-nav-viewports-v1.json',import.meta.url),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({passed:result.passed,cases:result.cases.length}));if(!result.passed)process.exitCode=1;
