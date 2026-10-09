import {chromium,expect} from '@playwright/test';
import {writeFileSync} from 'node:fs';
const output='performance/graph-cms-followthrough-20261009';
const origin='http://127.0.0.1:20384';
const browser=await chromium.launch({headless:true,executablePath:'/Users/twoimo/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'});
const results={source:'actual-readLocalKnowledgeGraph-current-materialization-with-synthetic-admin-session',viewports:[],pageErrors:[],externalBlocked:0,mutationsBlocked:0};
try{
 for(const size of [{name:'desktop',width:1440,height:1000},{name:'tablet',width:834,height:1112},{name:'mobile',width:390,height:844}]){
  const context=await browser.newContext({viewport:size,reducedMotion:'reduce'});
  await context.addInitScript(()=>localStorage.setItem('tzudong:e2e-admin-shell-bypass','1'));
  await context.route('**/*',route=>{const r=route.request(),u=new URL(r.url());if(![origin,'http://127.0.0.1:20383'].includes(u.origin)){results.externalBlocked++;return route.fulfill({status:503,body:''});}if(!['GET','HEAD','OPTIONS'].includes(r.method())){results.mutationsBlocked++;return route.fulfill({status:405,body:''});}return route.continue();});
  const page=await context.newPage();page.on('pageerror',e=>results.pageErrors.push(e.name));
  await page.goto(origin+'/admin?module=knowledge-graph',{waitUntil:'domcontentloaded',timeout:90000});
  const panel=page.locator('[data-admin-knowledge-graph-panel]');
  await expect(panel.getByRole('group',{name:'지식 연결 그래프'})).toBeVisible({timeout:90000});
  await expect(panel.locator('header')).toContainText('분석 0 / 1,071');
  await expect(panel.getByText('30개 · 연결 88',{exact:true})).toBeVisible();
  const initialNodeLabels=await panel.locator('[data-knowledge-node] text').allTextContents();
  await page.screenshot({path:`${output}/${size.name}-initial.png`});
  await panel.getByRole('textbox',{name:'지식 검색'}).fill('원성식당');
  await expect(panel.locator('[data-knowledge-node]')).toHaveCount(1);
  await panel.locator('[data-knowledge-node]').click();
  const dialog=page.getByRole('dialog');await expect(dialog).toContainText('3Z-ngM3DVi0 · 자막 1차 검토');
  await expect(dialog).toContainText('시각 미검토');
  await page.screenshot({path:`${output}/${size.name}-selected.png`});
  const detailText=await dialog.innerText();
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
  await panel.getByRole('textbox',{name:'지식 검색'}).fill('');await expect(panel.locator('[data-knowledge-node]')).toHaveCount(30);
  await panel.getByRole('button',{name:'지식 목록과 분석 현황 열기'}).click();await expect(page.getByRole('dialog').getByRole('list',{name:'지식 목록'}).getByRole('button')).toHaveCount(30);
  await page.screenshot({path:`${output}/${size.name}-list.png`});
  await expect(page.getByRole('dialog')).toContainText('대기 1,071 · 실패 0');
  await page.keyboard.press('Escape');
  await panel.getByRole('textbox',{name:'지식 검색'}).fill('no-current-graph-match');await expect(panel.getByText('일치하는 지식이 없습니다.',{exact:true})).toBeVisible();
  const overflow=await page.evaluate(()=>({document:document.documentElement.scrollWidth>innerWidth,body:document.body.scrollWidth>innerWidth}));
  results.viewports.push({...size,initialNodes:initialNodeLabels.length,captionLabelsVisibleWithoutTitle:initialNodeLabels.filter(x=>/^[a-zA-Z0-9_-]{10,11}…$/.test(x)).length,searchBySummary:true,selected:true,firstPassDetail:true,detailDescribesUnverified:detailText.includes('미검증'),listCount:30,escape:true,emptySearch:true,overflow});
  await context.close();
 }
}catch(e){results.failure=e.message.split('\n')[0];process.exitCode=1;}finally{await browser.close();writeFileSync(output+'/browser-results.json',JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results));}
