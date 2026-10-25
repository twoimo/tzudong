import {test,expect} from 'bun:test';
import {chromium} from '@playwright/test';
import {bundle,type TabFixture} from './fixtures/draft-mixed-fixture';
for(const legacy of ['base','v6','v7'] as const)for(const suspended of [false,true])for(const kind of ['review','submission','edit'])for(const operation of ['save','delete-one','delete-all'])test(`mixed ${legacy}/${suspended?'frozen':'active'} current ${kind} protects fresh draft from stale ${operation}`,async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{
  const context=await browser.newContext();await context.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));const a=await context.newPage(),b=await context.newPage();await a.goto('https://draft-mixed.test/');await a.addScriptTag({content:await bundle(legacy)});await b.goto('https://draft-mixed.test/');await b.addScriptTag({content:await bundle(null)});
  await a.evaluate(()=>(globalThis as unknown as TabFixture).__tab.activate());await a.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.save(kind,'구버전 합성 초안'),kind);await a.evaluate(({kind,operation})=>(globalThis as unknown as TabFixture).__tab.start(kind,operation),{kind,operation});await a.waitForFunction(()=>(globalThis as unknown as TabFixture).__tab.entered);
  const cdp=await context.newCDPSession(a);if(suspended)await cdp.send('Page.setWebLifecycleState',{state:'frozen'});
  await b.evaluate(()=>(globalThis as unknown as TabFixture).__tab.clear());await b.evaluate(()=>(globalThis as unknown as TabFixture).__tab.activate());await b.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.save(kind,'신버전 새 세션 합성 초안'),kind);
  if(suspended)await cdp.send('Page.setWebLifecycleState',{state:'active'});
  await a.evaluate(()=>(globalThis as unknown as TabFixture).__tab.release());await a.evaluate(()=>(globalThis as unknown as TabFixture).__tab.pending);expect(await b.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.read(kind),kind)).toBe('신버전 새 세션 합성 초안');
 }finally{await browser.close();}
},20000);

for(const kind of ['review','submission','edit'])for(const operation of ['save','delete-one','delete-all'])test(`mixed v6/frozen A-B-A ${kind} protects both owners from ${operation}`,async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{
  const context=await browser.newContext();await context.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));const a=await context.newPage(),b=await context.newPage();await a.goto('https://draft-mixed.test/');await a.addScriptTag({content:await bundle('v6')});await b.goto('https://draft-mixed.test/');await b.addScriptTag({content:await bundle(null)});await a.evaluate(()=>(globalThis as unknown as TabFixture).__tab.activate());await a.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.save(kind,'이전 A 세션 합성 초안'),kind);await a.evaluate(({kind,operation})=>(globalThis as unknown as TabFixture).__tab.start(kind,operation),{kind,operation});await a.waitForFunction(()=>(globalThis as unknown as TabFixture).__tab.entered);const cdp=await context.newCDPSession(a);await cdp.send('Page.setWebLifecycleState',{state:'frozen'});
  await b.evaluate(()=>(globalThis as unknown as TabFixture).__tab.clear());const other='22222222-2222-4222-8222-222222222222';await b.evaluate(id=>(globalThis as unknown as TabFixture).__tab.activate(id),other);await b.evaluate(({kind,other})=>(globalThis as unknown as TabFixture).__tab.save(kind,'B 소유자의 별도 합성 초안',other),{kind,other});await b.evaluate(()=>(globalThis as unknown as TabFixture).__tab.activate());await b.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.save(kind,'돌아온 A의 새 합성 초안'),kind);
  await cdp.send('Page.setWebLifecycleState',{state:'active'});await a.evaluate(()=>(globalThis as unknown as TabFixture).__tab.release());await a.evaluate(()=>(globalThis as unknown as TabFixture).__tab.pending);expect(await b.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.read(kind),kind)).toBe('돌아온 A의 새 합성 초안');const row=await b.evaluate(({kind,other})=>(globalThis as unknown as TabFixture).__tab.data(kind,true,other),{kind,other});expect(row?.content??row?.name??row?.restaurant_name).toBe('B 소유자의 별도 합성 초안');
 }finally{await browser.close();}
},20000);
