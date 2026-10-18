import { chromium,expect } from '@playwright/test';
import { writeFile,access } from 'node:fs/promises';
const [phase,sha]=process.argv.slice(2);if(!['before','after'].includes(phase)||!/^[a-f0-9]{40}$/.test(sha))throw Error('INVALID_INPUT');
const target=new URL(`live-history-${phase}-v4.json`,import.meta.url);
try{await access(target);throw Error('PRESERVE_EXISTING_RECEIPT')}catch(e){if(e.code!=='ENOENT')throw e}
const h=await fetch('https://www.tzudong.app/api/health',{cache:'no-store'}).then(r=>r.json());expect(h.gitSha).toBe(sha);
const browser=await chromium.launch(),result={phase,gitSha:sha,deploymentId:h.deploymentId,browser:browser.version(),startedAt:new Date().toISOString(),scope:'anonymous real SDK full-navigation detail restoration; exact marker visibility is observational and unproven, not a passing gate; no row bodies, query URLs, account mutations, device/field/performance claim',rows:[]};
let stage='start';
try{for(const viewport of [{width:1440,height:900},{width:834,height:1112},{width:430,height:860}]){
 const context=await browser.newContext({viewport,permissions:[]});const page=await context.newPage();stage='map-ready';
 await page.goto('https://www.tzudong.app/',{waitUntil:'domcontentloaded',timeout:45000});
 const map=page.getByTestId('map-container');await expect(map).toBeVisible({timeout:30000});
 await expect.poll(()=>page.evaluate(()=>typeof window.naver?.maps?.Map),{timeout:30000}).toBe('function');
 const markers=map.getByTestId('marker');let clusterOpens=0;
 while(await markers.count()===0&&clusterOpens<4){await map.locator('.cluster-marker-container').first().click({timeout:15000});clusterOpens++;await expect.poll(async()=>await markers.count()+await map.locator('.cluster-marker-container').count(),{timeout:15000}).toBeGreaterThan(0);}
 stage='open-detail';await expect(markers.first()).toBeVisible({timeout:20000});await markers.first().click();
 const detail=page.getByTestId('restaurant-detail-panel');await expect(detail).toBeVisible({timeout:30000});
 const id=new URL(page.url()).searchParams.get('restaurant');expect(/^[A-Za-z0-9_-]{1,128}$/.test(id||'')).toBe(true);
 stage='visit-feed';await page.goto('https://www.tzudong.app/feed',{waitUntil:'domcontentloaded',timeout:45000});
 await expect(page.getByRole('heading',{name:/^(?:쯔동여지도 )?리뷰(?:\s|$)/})).toBeVisible({timeout:30000});
 stage='history-back';await page.goBack({waitUntil:'domcontentloaded',timeout:45000});await expect(detail).toBeVisible({timeout:30000});
 expect(new URL(page.url()).searchParams.get('restaurant')).toBe(id);
 stage='restored-map';await expect(map).toBeVisible({timeout:30000});
 await expect.poll(()=>map.locator('img').count(),{timeout:30000}).toBeGreaterThan(0);
 const retained=page.locator(`[data-testid="marker"][data-restaurant-id="${id}"]`);
 const exactMarkerCount=await retained.count(),exactMarkerVisible=exactMarkerCount>0&&await retained.first().isVisible();
 const markerCount=await map.getByTestId('marker').count(),clusterCount=await map.locator('.cluster-marker-container').count();
 stage='close-restored-detail';await detail.getByRole('button',{name:/^(?:맛집 상세 닫기|이전 목록으로 돌아가기|이전 화면으로 돌아가기)$/}).click();await expect(detail).toHaveCount(0,{timeout:20000});
 result.rows.push({viewport,clusterOpens,sameRestaurantRestored:true,exactOriginalMarkerVisible:exactMarkerVisible,exactMarkerCount,markerCount,clusterCount,detailClosed:true});await context.close();
}result.status='passed';}catch{result.status='failed';result.failedStage=stage;}finally{result.completedAt=new Date().toISOString();await writeFile(target,JSON.stringify(result,null,2)+'\n',{flag:'wx'});await browser.close()}
console.log(JSON.stringify(result));if(result.status!=='passed')throw Error('PUBLIC_HISTORY_ASSERTION_FAILED');
