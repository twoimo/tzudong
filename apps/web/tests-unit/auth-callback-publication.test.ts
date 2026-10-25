import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript'),next=require('next/server');
const root=path.resolve(import.meta.dir,'..'),origin='https://publication.fixture.invalid';
function fixture(mode:{onboarding?:boolean;eligible?:boolean;confirmed?:boolean;exchangeError?:boolean}={}){
 const events:string[]=[];const context=vm.createContext({URL,URLSearchParams,Headers,Request,Response,Uint8Array,TextDecoder,TextEncoder,AbortSignal,setTimeout,clearTimeout,Date,process:{env:{NODE_ENV:'production',NEXT_PUBLIC_SITE_URL:origin}}});
 const client={auth:{exchangeCodeForSession:async()=>{events.push('exchange');return {error:mode.exchangeError?Error('synthetic-private-provider'):null};},getUser:async()=>({data:{user:{id:'11111111-1111-4111-8111-111111111111'}},error:null})}};
 const receipt={eligible:mode.eligible!==false,receipt:{policyVersionId:'policy-fixture',contentSha256:'a'.repeat(64)}};
 const cache=new Map<string,unknown>();
 function load(relative:string):any{
  if(cache.has(relative))return cache.get(relative);const record={exports:{}};
  const imported=(name:string):unknown=>{
   if(name==='next/server')return next;
   if(name==='@/lib/auth/callback-session')return {createCallbackSupabaseClient:async()=>{events.push('factory');return client;},getCallbackSessionTokens:async()=>{events.push('handoff');return {tokens:{access_token:'synthetic-access',refresh_token:'synthetic-refresh'},consumedVerifiers:['sb-fixture-v2-auth-token-code-verifier']};},revokeRejectedCallbackSession:async()=>{events.push('reject');}};
   if(name==='@/lib/privacy/eligibility')return {getCurrentPrivacyEligibility:async()=>{events.push('eligibility');return receipt;},hasLivePrivacyEligibilityReceipt:(value:any)=>value?.eligible===true};
   if(name==='@/lib/privacy/onboarding')return {ONBOARDING_CHALLENGE_COOKIE:'onboarding-fixture',clearOnboardingCookies:(r:any)=>r.cookies.delete('onboarding-fixture'),clearRejectedOnboardingCookies:(r:any)=>r.cookies.delete('onboarding-fixture'),sha256:()=> 'hash-fixture',readOnboardingChallenge:()=>mode.onboarding?{intent:'oauth',oauthNonce:'nonce-fixture',origin,challengeId:'challenge-fixture',challengeToken:'token-fixture',policyVersionId:'policy-fixture',contentSha256:'a'.repeat(64)}:null,parseFreshPrivacyOnboardingConfirmationReceipt:()=>mode.confirmed===false?null:{accepted:true}};
   if(name==='@/lib/supabase/service-role')return {createSupabaseServiceRoleClient:()=>({rpc:async()=>{events.push('confirm');return {data:{accepted:true},error:null};}})};
   if(name.startsWith('@/'))return load(name.slice(2)+'.ts');
   throw Error('UNDECLARED_FIXTURE_IMPORT');
  };
  const source=ts.transpileModule(readFileSync(path.join(root,relative),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  vm.runInContext(`(function(module,exports,require){${source}\n})`,context)(record,record.exports,imported);cache.set(relative,record.exports);return record.exports;
 }
 const route=load('app/auth/callback/route.ts');
 const request=(overrides:{origin?:string;body?:string;query?:string;type?:string}={})=>new Request(origin+'/auth/callback'+(overrides.query??''),{method:'POST',headers:{origin:overrides.origin??origin,'content-type':overrides.type??'application/json',cookie:'sb-fixture-v2-auth-token=old'+(mode.onboarding?'; onboarding-fixture=challenge':'')},body:overrides.body??JSON.stringify({code:'one-use-fixture',next:'/mypage'})});
 return {events,route,request};
}
test('callback navigation is no-store/referrerless and never exchanges or publishes the code',async()=>{
 const f=fixture();const r=await f.route.GET(new Request(origin+'/auth/callback?code=one-use-fixture&next=%2Fmypage'));expect(r.status).toBe(307);expect(new URL(r.headers.get('location')).pathname).toBe('/auth/complete');expect(r.headers.get('cache-control')).toBe('no-store');expect(r.headers.get('referrer-policy')).toBe('no-referrer');expect(r.headers.has('set-cookie')).toBe(false);expect(f.events).toEqual([]);
});
for(const onboarding of[false,true])test(`validated callback transfers a guarded browser handoff without session Set-Cookie: onboarding=${onboarding}`,async()=>{
 const f=fixture({onboarding});const r=await f.route.POST(f.request());const body=await r.json();expect(r.status).toBe(200);expect(body.ok).toBe(true);expect(body.next).toBe('/mypage');expect(body.tokens).toEqual({access_token:'synthetic-access',refresh_token:'synthetic-refresh'});expect(r.headers.get('cache-control')).toBe('no-store');expect(r.headers.get('set-cookie')??'').not.toContain('sb-');expect(f.events).toEqual(onboarding?['factory','exchange','confirm','eligibility','handoff']:['factory','exchange','eligibility','handoff']);
});
for(const mode of[{onboarding:true,confirmed:false},{onboarding:true,eligible:false},{exchangeError:true}])test('rejected callback cannot publish even a prepared session',async()=>{
 const f=fixture(mode);const r=await f.route.POST(f.request());expect(r.status).toBe(400);expect(await r.json()).toEqual({ok:false,error:'AUTH_CALLBACK_FAILED'});expect(r.headers.get('set-cookie')??'').not.toContain('sb-');expect(f.events).toContain('reject');expect(f.events).not.toContain('handoff');
});
test('existing account without eligibility keeps the exact onboarding destination',async()=>{
 const f=fixture({eligible:false});const r=await f.route.POST(f.request());expect(r.status).toBe(200);const body=await r.json();expect(new URL(body.next,origin).pathname).toBe('/');expect(new URL(body.next,origin).searchParams.get('reason')).toBe('privacy_onboarding');expect(f.events).not.toContain('reject');expect(r.headers.get('set-cookie')??'').not.toContain('sb-');
});
for(const input of[{origin:'https://other.fixture.invalid'},{query:'?code=ambiguous'},{type:'text/plain'},{body:'{"code":"one","code":"two"}'},{body:JSON.stringify({code:'a'.repeat(2049)})},{body:JSON.stringify({code:'one',next:'/',extra:true})}])test('callback rejects untrusted or ambiguous input before exchange',async()=>{
 const f=fixture();const r=await f.route.POST(f.request(input));expect(r.status>=400).toBe(true);expect(f.events).toEqual([]);expect(r.headers.get('set-cookie')??'').not.toContain('sb-');
});
