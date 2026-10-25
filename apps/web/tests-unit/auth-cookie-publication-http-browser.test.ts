import { expect, test } from 'bun:test';
import { chromium } from '@playwright/test';
import { parseCookieHeader, stringToBase64URL } from '@supabase/ssr';
import { readServerAuthCookies, getAuthCookieContract } from '../lib/auth/session-cookies';
import { chromeForTestingExecutable } from './fixtures/chrome-for-testing';
import path from 'node:path';

for (const denyFinalMarker of [false, true]) test(`native HTTP cannot authenticate an unfinished browser cookie batch: denied=${denyFinalMarker}`, async () => {
 const user={id:'11111111-1111-4111-8111-111111111111',aud:'authenticated'};
 const token='header.'+stringToBase64URL(JSON.stringify({sub:user.id,exp:Math.floor(Date.now()/1000)+3600}))+'.synthetic';
 let url='';
 const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(request){
  const p=new URL(request.url).pathname;
  if(p==='/auth/v1/token')return Response.json({access_token:token,refresh_token:'new-synthetic',expires_in:3600,token_type:'bearer',user});
  if(p==='/server-read'){
   const contract=getAuthCookieContract(url),all=parseCookieHeader(request.headers.get('cookie')??'');
   return Response.json({accepts:readServerAuthCookies(all,url).some(c=>c.name===contract.key)});
  }
  return new Response('<!doctype html>',{headers:{'Content-Type':'text/html'}});
 }});url=`http://127.0.0.1:${server.port}`;const contract=getAuthCookieContract(url);
 const root=path.resolve(import.meta.dir,'..');
 const built=await Bun.build({entrypoints:['native-publication-fixture'],target:'browser',format:'iife',write:false,define:{'process.env.NEXT_PUBLIC_SUPABASE_URL':JSON.stringify(url),'process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY':'"synthetic-public"'},plugins:[{name:'fixture',setup(b){b.onResolve({filter:/^native-publication-fixture$/},()=>({path:'entry',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({loader:'ts',resolveDir:root,contents:`import {supabase} from './integrations/supabase/client';globalThis.probe={read:()=>supabase.auth.getSession(),login:()=>supabase.auth.signInWithPassword({email:'synthetic@example.invalid',password:'synthetic-only'})};`}));}}]});
 if(!built.success)throw Error('PUBLICATION_FIXTURE_BUILD_FAILED');
 const browser=await chromium.launch({headless:true,executablePath:chromeForTestingExecutable()});
 try {
  const page=await browser.newPage();await page.goto(url);await page.addScriptTag({content:await built.outputs[0].text()});
  await page.evaluate(()=>(globalThis as unknown as {probe:{read():Promise<unknown>}}).probe.read());
  const result=await page.evaluate(async({contract,denyFinalMarker})=>{
   const native=Object.getOwnPropertyDescriptor(Document.prototype,'cookie')!;const observations:Array<{point:string;accepts:boolean}>=[];let wroteSession=false;
   Object.defineProperty(document,'cookie',{configurable:true,get:()=>native.get!.call(document),set:value=>{
    const text=String(value),final=text.startsWith(contract.marker+'=1');
    if(denyFinalMarker&&wroteSession&&final)return;
    native.set!.call(document,value);
    const credential=text.startsWith(contract.key+'=')&&!/max-age=0/i.test(text);
    if(credential)wroteSession=true;
    if(credential||wroteSession&&final){const xhr=new XMLHttpRequest();xhr.open('GET','/server-read',false);xhr.send();observations.push({point:credential?'credential-written-pending':'marker-committed',accepts:JSON.parse(xhr.responseText).accepts});}
   }});
   let rejected=false;try{await (globalThis as unknown as {probe:{login():Promise<unknown>}}).probe.login()}catch{rejected=true}finally{Reflect.deleteProperty(document,'cookie')}
   const after=await fetch('/server-read').then(r=>r.json());const recovered=await (globalThis as unknown as {probe:{read():Promise<{data:{session:unknown}}>}}).probe.read();
   return {rejected,observations,afterAccepts:after.accepts,hasSessionAfterRecovery:!!recovered.data.session};
  },{contract,denyFinalMarker});
  expect(result.observations[0]).toEqual({point:'credential-written-pending',accepts:false});
  expect(result.rejected).toBe(denyFinalMarker);expect(result.afterAccepts).toBe(!denyFinalMarker);expect(result.hasSessionAfterRecovery).toBe(!denyFinalMarker);
  if(!denyFinalMarker)expect(result.observations.at(-1)).toEqual({point:'marker-committed',accepts:true});
 }finally{await browser.close();await server.stop(true)}
},20000);
