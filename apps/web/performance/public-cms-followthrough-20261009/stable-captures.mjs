import { chromium, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const output = resolve('performance/public-cms-followthrough-20261009');
const browser = await chromium.launch({headless:true,executablePath:'/Users/twoimo/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'});
const results=[];
try {for(const viewport of [{id:'desktop',width:1440,height:1000},{id:'tablet',width:820,height:1180},{id:'mobile',width:390,height:844}]){
 const context=await browser.newContext({viewport,reducedMotion:'reduce',serviceWorkers:'block'});
 await context.routeWebSocket('**/*',route=>{if(new URL(route.url()).hostname==='127.0.0.1')route.connectToServer();else route.close();});
 await context.route('**/*',route=>{const request=route.request(),url=new URL(request.url());return url.origin==='http://127.0.0.1:19872'&&!url.pathname.startsWith('/api/')&&['GET','HEAD'].includes(request.method())?route.continue():route.fulfill({status:503,json:{code:'local_read_only_check'}});});
 const page=await context.newPage();
 for(const target of [{route:'/feed',index:4,text:'리뷰 데이터를 불러오지 못했습니다.'},{route:'/leaderboard',index:8,text:'랭킹 데이터를 불러오지 못했습니다'},{route:'/stamp',index:20,text:'도장 맛집을 불러오지 못했습니다'},{route:'/user/00000000-0000-4000-8000-000000000009',index:22,text:'프로필을 불러올 수 없습니다'},{route:'/privacy/onboarding',index:17,text:'Google 로그인 후 서비스 이용에 필요한 항목을 확인해주세요.'}]){
  const result={route:target.route,index:target.index,viewport:viewport.id};
  try{
   await page.goto(`http://127.0.0.1:19872${target.route}`,{waitUntil:'domcontentloaded',timeout:45000});
   await expect(page.getByText(target.text,{exact:true})).toBeVisible({timeout:20000});
   await page.addStyleTag({content:'nextjs-portal{display:none!important}'});
   result.screenshot=`stable-${target.index}-${viewport.id}.png`;await page.screenshot({path:resolve(output,result.screenshot)});
   result.stableTerminalStateVisible=true;
   result.geometry=await page.evaluate(()=>({overflowX:Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)-innerWidth,headers:Array.from(document.querySelectorAll('[data-map-panel-header],header')).filter(e=>e.getBoundingClientRect().height>0).map(e=>Math.round(e.getBoundingClientRect().height))}));
  }catch(error){result.failure=String(error.message).split('\n')[0];await page.screenshot({path:resolve(output,`unstable-${target.index}-${viewport.id}.png`)});}
  results.push(result);writeFileSync(resolve(output,'stable-capture-results.json'),JSON.stringify(results,null,2)+'\n');console.log(`${viewport.id} ${target.route} stable=${result.stableTerminalStateVisible??false}`);
 }
 await context.close();
}}finally{await browser.close();}
