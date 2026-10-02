import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {physicalBrowser,usbSerial} from './real-sdk-runtime.mjs';
const result={startedAt:new Date().toISOString(),scope:'owned Chrome public HTTPS QA tab; native pixels, no location or private response retained',captures:[],fieldAdmitted:0};
let browser,page;
try {
 const serial=usbSerial(),boot='https://www.tzudong.app/?__qa=footer-pixels-after-v1&__perf_mobile='+randomUUID();
 execFileSync('adb',['-s',serial,'shell','input','keyevent','224'],{stdio:'ignore'});
 result.stage='native Chrome start';
 execFileSync('adb',['-s',serial,'shell','am','start','-a','android.intent.action.VIEW','-d',"'"+boot+"'",'-p','com.android.chrome'],{stdio:'ignore'});
 result.stage='connect browser protocol';browser=await physicalBrowser();
 result.stage='owned new page';page=await browser.contexts()[0].newPage();
 await page.goto(boot,{waitUntil:'domcontentloaded',timeout:30000});await page.bringToFront();
 result.stage='SDK and visible navigation';
 await page.waitForFunction(()=>document.visibilityState==='visible'&&window.naver?.maps?.Map&&document.querySelectorAll('.cluster-marker-container,[data-testid=marker]').length&&document.querySelector('.mobile-bottom-nav'),{timeout:45000});
 await page.evaluate(()=>navigator.wakeLock?.request('screen').then(x=>window.__ownedPixelWake=x).catch(()=>null));
 result.dom=await page.evaluate(()=>{const m=document.querySelector('[data-testid=map-container]').getBoundingClientRect(),n=document.querySelector('.mobile-bottom-nav').getBoundingClientRect();return {visible:document.visibilityState,mapBottom:m.bottom,navTop:n.top,overlap:Math.max(0,m.bottom-n.top),viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},legacyBottomRectangle:!!document.querySelector('[data-home-static-skeleton] [class~=h-14]')};});
 result.geometryPass=result.dom.overlap<=.5;result.stage='native captures';
 for(let i=0;i<6;i++){
  execFileSync('adb',['-s',serial,'shell','input','keyevent','224'],{stdio:'ignore'});
  if(await page.evaluate(()=>document.visibilityState)!=='visible')throw Error('owned page not visible');
  const file=`/tmp/tzudong-owned-native-chrome-footer-after-v1-${i}.png`;
  await writeFile(file,execFileSync('adb',['-s',serial,'exec-out','screencap','-p'],{timeout:10000,maxBuffer:20*1024*1024}),{flag:'wx'});
  result.captures.push({temporaryPath:file,t:new Date().toISOString(),inspected:false});
  if(i===2){const p=await page.evaluate(()=>({x:innerWidth*.5,y:innerHeight*.4}));const c=await page.context().newCDPSession(page);await c.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p]});for(let k=1;k<=8;k++)await c.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:p.x+k*8,y:p.y}]});await c.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await c.detach();}
 }
 result.passed=result.geometryPass===true;
}catch(e){result.passed=false;result.failureCode=e.message==='owned command timeout'?'owned_protocol_timeout':'native_chrome_pixel_review_unavailable';}
finally {if(page)await page.close().catch(()=>{});if(browser)await browser.close().catch(()=>{});}
result.endedAt=new Date().toISOString();await writeFile(new URL('native-chrome-footer-pixels-after-v1.json',import.meta.url),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({passed:result.passed,stage:result.stage,captures:result.captures.length}));
