import { chromium,expect } from '@playwright/test';
import { writeFile,access } from 'node:fs/promises';
const sha=process.argv[2];if(!/^[a-f0-9]{40}$/.test(sha))throw Error('INVALID_SHA');
const health=await fetch('https://www.tzudong.app/api/health',{cache:'no-store'}).then(r=>r.json());expect(health.gitSha).toBe(sha);
const root=new URL('.',import.meta.url);
for(const name of ['live-visual-after-v3.json','live-map-1440x900-v3.png','live-map-834x1112-v3.png','live-map-430x860-v3.png']){
 try{await access(new URL(name,root));throw Error('PRESERVE_EXISTING_VISUAL')}catch(e){if(e.code!=='ENOENT')throw e}
}
const browser=await chromium.launch(),rows=[];
try{for(const viewport of [{width:1440,height:900},{width:834,height:1112},{width:430,height:860}]){
 const context=await browser.newContext({viewport,permissions:[]});const page=await context.newPage();
 await page.goto('https://www.tzudong.app/',{waitUntil:'domcontentloaded',timeout:45000});
 const map=page.getByTestId('map-container');await expect(map).toBeVisible({timeout:30000});
 await expect.poll(()=>map.locator('img').count(),{timeout:30000}).toBeGreaterThan(0);
 await expect.poll(async()=>await map.getByTestId('marker').count()+await map.locator('.cluster-marker-container').count(),{timeout:30000}).toBeGreaterThan(0);
 await expect(page.getByText(/맛집 핀 배치 중/)).toBeHidden({timeout:30000});
 const file=`live-map-${viewport.width}x${viewport.height}-v3.png`;
 // Public map crop only: no auth, user profiles, search text or precise device location.
 await map.screenshot({path:new URL(file,root).pathname,animations:'disabled'});
 rows.push({viewport,path:file,mapBox:await map.boundingBox()});await context.close();
}await writeFile(new URL('live-visual-after-v3.json',root),JSON.stringify({gitSha:sha,observedAt:new Date().toISOString(),browser:browser.version(),scope:'public map-only rendered screenshots; no field, device or timing claim',rows},null,2)+'\n');console.log(JSON.stringify({captured:rows.length}));}finally{await browser.close()}
