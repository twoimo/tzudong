import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {readPrivateVerificationImage} from '/Users/twoimo/.codex/worktrees/sync-data-motion-20261012/tzudong/apps/web/lib/reviews/private-verification-handler.ts';
const req = createRequire('/Users/twoimo/.codex/worktrees/sync-data-motion-20261012/tzudong/apps/web/package.json');
const {chromium} = req('@playwright/test');
const review = '22222222-2222-4222-8222-222222222222';
const owner = '11111111-1111-4111-8111-111111111111';
const path = `${owner}/1720000000000_verification_proof.gif`;
const bytes = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64');
const counts = {read:0,download:0};
const prior = process.env.NEXT_PUBLIC_SUPABASE_URL;
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project-ref.supabase.co';
const result = {startedAtUtc:new Date().toISOString(),fixtureOnly:true,actualAdminAuthentication:false,
  actualAdminUi:false,physicalDevice:false,fieldAdmission:0,operatingWrites:0,status:'unconfirmed'};
let browser;
const server = Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request) {
  const url = new URL(request.url);
  if (url.pathname === '/') return new Response(`<p>Protocol fixture only; no real account or image</p><img alt="Synthetic GIF protocol fixture" src="/api/admin/review-verification/${review}">`,{headers:{'Content-Type':'text/html','Cache-Control':'no-store'}});
  if (url.pathname !== `/api/admin/review-verification/${review}`) return new Response(null,{status:404});
  return readPrivateVerificationImage(Promise.resolve({reviewId:review}),{
    authorize:async()=>request.headers.get('x-fixture-authorized')==='true'
      ? {ok:true} : {ok:false,response:Response.json({code:'FIXTURE_UNAUTHORIZED'},{status:401})},
    read:async()=>{counts.read++;return{data:{user_id:owner,verification_photo:path},error:null};},
    download:async()=>{counts.download++;return{data:new Blob([bytes],{type:'image/gif'}),error:null};},
  });
}});
try {
  const origin = `http://127.0.0.1:${server.port}`;
  const denied = await fetch(origin+`/api/admin/review-verification/${review}`);
  assert.equal(denied.status,401); assert.deepEqual(counts,{read:0,download:0});
  browser = await chromium.launch({channel:'chrome',headless:true});
  const context = await browser.newContext({extraHTTPHeaders:{'x-fixture-authorized':'true'},viewport:{width:390,height:844}});
  const page = await context.newPage(); await page.goto(origin,{waitUntil:'load'});
  const image = page.getByRole('img',{name:'Synthetic GIF protocol fixture'});
  const decoded = await image.evaluate(async element=>{await element.decode();return{complete:element.complete,width:element.naturalWidth,height:element.naturalHeight};});
  assert.deepEqual(decoded,{complete:true,width:1,height:1});
  const response = await context.request.get(origin+`/api/admin/review-verification/${review}`);
  assert.equal(response.status(),200);
  assert.deepEqual(await response.body(),bytes);
  assert.equal(response.headers()['content-type'],'image/gif');
  assert.equal(response.headers()['cache-control'],'private, no-store');
  assert.equal(response.headers()['x-content-type-options'],'nosniff');
  result.browser = await browser.version(); result.decoded = decoded;
  result.authorizedStatus = 200;result.unauthorizedStatus = 401;result.bytesPreserved = true;
  result.moduleSha256=createHash('sha256').update(readFileSync('/Users/twoimo/.codex/worktrees/sync-data-motion-20261012/tzudong/apps/web/lib/reviews/private-verification-handler.ts')).digest('hex');
  result.status='passed'; await context.close();
} catch {result.failureCode='BROWSER_PROTOCOL_UNCONFIRMED';process.exitCode=1;}
finally {
  if(browser)await browser.close();await server.stop(true);
  if(prior===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_URL;else process.env.NEXT_PUBLIC_SUPABASE_URL=prior;
  result.endedAtUtc=new Date().toISOString();
  writeFileSync(new URL('legacy-gif-browser-protocol-v1.json',import.meta.url),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
}
console.log(JSON.stringify({status:result.status,decoded:result.decoded??null,fixtureOnly:true,actualAdminUi:false,operatingWrites:0}));
