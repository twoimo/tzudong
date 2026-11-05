import { chromeForTestingExecutable } from './fixtures/chrome-for-testing';
import {expect,test} from 'bun:test';
import {chromium,expect as ui} from '@playwright/test';
import {stringToBase64URL} from '@supabase/ssr';
import path from 'node:path';
const root=path.resolve(import.meta.dir,'..'),key='sb-127-v3-auth-token',marker='tz-auth-v3-127';
const old='11111111-1111-4111-8111-111111111111',candidate='22222222-2222-4222-8222-222222222222',other='33333333-3333-4333-8333-333333333333';
const session=(owner:string,refresh:string)=>({access_token:stringToBase64URL(JSON.stringify({alg:'HS256',typ:'JWT'}))+'.'+stringToBase64URL(JSON.stringify({sub:owner,exp:Math.floor(Date.now()/1000)+3600,session_id:owner}))+'.c3ludGhldGlj',refresh_token:refresh,expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user:{id:owner,aud:'authenticated'}});
interface Probe {probe:{read():Promise<any>;login():Promise<any>;begin():Promise<void>;signup(input:unknown):Promise<void>;rejectNotification():void;run():void;abort():void;logout():Promise<boolean>;result:{settled:boolean;next?:string;failed?:boolean}}}
for(const mode of ['success','new-tab','replacement','empty-logout','cancel-before-save','cleanup-rejected','signup-new-tab','signup-superseded','signup-after-logout','signup-invalid','notification-rejected'] as const)test(`one browser publication boundary: ${mode}`,async()=>{
 let holdResponse=mode!=='success'&&mode!=='new-tab'&&mode!=='cancel-before-save'&&mode!=='cleanup-rejected'&&mode!=='signup-new-tab'&&mode!=='notification-rejected',responseReady=false,releaseResponse=()=>{};
 let holdUser=mode==='cancel-before-save',userReady=false,releaseUser=()=>{};let posts=0,revokes=0,revokedOnlyCandidate=true;const candidateSession=session(candidate,'candidate-synthetic');
 const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
  const u=new URL(request.url);
  if(u.pathname==='/auth/callback'&&request.method==='POST'){
   posts++;const response=Response.json({ok:true,next:'/mypage',tokens:candidateSession,consumedVerifiers:[key+'-code-verifier']},{headers:{'Cache-Control':'no-store'}});
   responseReady=true;if(holdResponse)await new Promise<void>(r=>{releaseResponse=r;});return response;
  }
  if(u.pathname==='/auth/v1/token')return Response.json(session(other,'other-synthetic'));
  if(u.pathname==='/auth/v1/user'){
   const token=request.headers.get('Authorization')?.split(' ')[1]??'';const owner=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).sub;
   if(owner===candidate&&holdUser){userReady=true;await new Promise<void>(r=>{releaseUser=r;});}
   return Response.json({id:owner,aud:'authenticated'});
  }
  if(u.pathname==='/auth/v1/logout'){
   revokes++;revokedOnlyCandidate&&=request.headers.get('Authorization')==='Bearer '+candidateSession.access_token&&u.searchParams.get('scope')==='local';return new Response(null,{status:204});
  }
  return new Response('<!doctype html>',{headers:{'Content-Type':'text/html'}});
 }});
 const url=`http://127.0.0.1:${server.port}`;
 const built=await Bun.build({entrypoints:['oauth-commit-fixture'],target:'browser',format:'iife',write:false,define:{'process.env.NEXT_PUBLIC_SUPABASE_URL':JSON.stringify(url),'process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY':'"synthetic-public"'},plugins:[{name:'fixture',setup(b){
  b.onResolve({filter:/^oauth-commit-fixture$/},()=>({path:'entry',namespace:'fixture'}));b.onResolve({filter:/^@\//},a=>({path:Bun.resolveSync('./'+a.path.slice(2),root)}));
  b.onLoad({filter:/.*/,namespace:'fixture'},()=>({loader:'ts',resolveDir:root,contents:`import {supabase} from './integrations/supabase/client';import{beginBrowserOAuthIntent,completeBrowserOAuthCallback,publishBrowserSignupPkce}from'./lib/auth/browser-oauth-commit';import{captureBrowserLogout}from'./lib/auth/browser-logout';let intent;const controller=new AbortController();const result={settled:false};globalThis.probe={result,rejectNotification:()=>{supabase.auth.onAuthStateChange((event,session)=>{if(event==='SIGNED_IN'&&session?.user.id==='22222222-2222-4222-8222-222222222222')throw new Error('synthetic-notification-failure');});},read:()=>supabase.auth.getSession(),login:()=>supabase.auth.signInWithPassword({email:'other@fixture.invalid',password:'synthetic-only'}),begin:async()=>{intent=await beginBrowserOAuthIntent();},signup:input=>publishBrowserSignupPkce(intent,input),abort:()=>controller.abort(),logout:()=>captureBrowserLogout().clearIfCurrent(()=>true),run:()=>{void completeBrowserOAuthCallback('one-use-fixture','/mypage',controller.signal).then(next=>{result.settled=true;result.next=next;},()=>{result.settled=true;result.failed=true;})}};`}));
 }}]});if(!built.success)throw Error('OAUTH_COMMIT_FIXTURE_BUILD_FAILED');
 const browser=await chromium.launch({executablePath:chromeForTestingExecutable(),headless:true});
 try{
  const context=await browser.newContext();await context.addCookies([{name:marker,value:'1',url},{name:key+'-code-verifier',value:'synthetic-verifier',url},...(mode==='empty-logout'?[]:[{name:key,value:'base64-'+stringToBase64URL(JSON.stringify(session(old,'old-synthetic'))),url}])]);
  const a=await context.newPage(),b=await context.newPage();const script=await built.outputs[0].text();
  for(const page of[a,b]){await page.goto(url+'/auth/complete');await page.addScriptTag({content:script});await page.evaluate(()=>(globalThis as unknown as Probe).probe.read());}
  await a.evaluate(()=>(globalThis as unknown as Probe).probe.begin());
  const intentSafe=await a.evaluate(()=>{const records=[...Object.entries(sessionStorage),...Object.entries(localStorage)].filter(([name])=>name.startsWith('tz-oauth-intent:'));return records.length===1&&records.every(([,raw])=>{const item=JSON.parse(String(raw));return Object.keys(item).sort().join(',')==='digest,id,version'&&/^[0-9a-f]{64}$/.test(item.digest);});});expect(intentSafe).toBe(true);
  const callbackPage=mode==='new-tab'||mode==='signup-new-tab'?b:a;
  if(mode.startsWith('signup-')){
   if(mode==='signup-superseded')await b.evaluate(()=>(globalThis as unknown as Probe).probe.begin());
   if(mode==='signup-after-logout')expect(await b.evaluate(()=>(globalThis as unknown as Probe).probe.logout())).toBe(true);
   const beforeSignup=(await context.cookies()).map(c=>[c.name,c.value]).sort();
   const accepted=await a.evaluate(input=>(globalThis as unknown as Probe).probe.signup(input).then(()=>true,()=>false),[{name:mode==='signup-invalid'?'unrelated-cookie':key+'-code-verifier',value:'guarded-signup-verifier',remove:false}]);
   if(mode!=='signup-new-tab'){expect(accepted).toBe(false);expect((await context.cookies()).map(c=>[c.name,c.value]).sort()).toEqual(beforeSignup);expect(posts).toBe(0);await context.close();return;}
   expect(accepted).toBe(true);
  }
  if(mode==='notification-rejected')await a.evaluate(()=>(globalThis as unknown as Probe).probe.rejectNotification());
  let before:unknown;
  if(mode==='cleanup-rejected'){
   before=(await context.cookies()).map(c=>[c.name,c.value]).sort();
   await a.evaluate(verifier=>{const original=Object.getOwnPropertyDescriptor(Document.prototype,'cookie')!;Object.defineProperty(document,'cookie',{configurable:true,get:()=>original.get!.call(document),set:value=>{if(String(value).startsWith(verifier+'=')&&/max-age=0/i.test(String(value)))return;original.set!.call(document,value);}});},key+'-code-verifier');
  }
  await callbackPage.evaluate(()=>(globalThis as unknown as Probe).probe.run());
  await ui.poll(()=>responseReady).toBe(true);
  if(mode==='replacement'){expect(await b.evaluate(()=>(globalThis as unknown as Probe).probe.login().then(r=>!!r.data.session))).toBe(true);before=(await context.cookies()).map(c=>[c.name,c.value]).sort();}
  if(mode==='empty-logout'){expect(await b.evaluate(()=>(globalThis as unknown as Probe).probe.logout())).toBe(true);before=(await context.cookies()).map(c=>[c.name,c.value]).sort();}
  if(mode==='cancel-before-save'){await ui.poll(()=>userReady).toBe(true);await a.evaluate(()=>(globalThis as unknown as Probe).probe.abort());before=(await context.cookies()).map(c=>[c.name,c.value]).sort();holdUser=false;releaseUser();}
  holdResponse=false;releaseResponse();
  await callbackPage.waitForFunction(()=>(globalThis as unknown as Probe).probe.result.settled);
  const result=await callbackPage.evaluate(()=>(globalThis as unknown as Probe).probe.result);
  if(mode==='success'||mode==='new-tab'||mode==='signup-new-tab'||mode==='notification-rejected'){
   expect(result.next).toBe('/mypage');expect(await a.evaluate(()=>(globalThis as unknown as Probe).probe.read().then(r=>r.data.session?.user.id))).toBe(candidate);
   expect((await context.cookies()).some(c=>c.name===key+'-code-verifier')).toBe(false);expect(revokes).toBe(0);
  }else{expect(result.failed).toBe(true);expect((await context.cookies()).map(c=>[c.name,c.value]).sort()).toEqual(before);expect(revokes).toBe(1);expect(revokedOnlyCandidate).toBe(true);}
  expect(posts).toBe(1);await context.close();
 }finally{holdResponse=false;holdUser=false;releaseResponse();releaseUser();await browser.close();await server.stop(true);}
},20000);
