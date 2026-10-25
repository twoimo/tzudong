import { test, expect } from 'bun:test';
import { chromium, expect as browserExpect } from '@playwright/test';

test('home search memory survives route unmount, isolates owners, and never writes browser storage', async () => {
  const entry = `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {useHomeRouteMemory} from './hooks/use-home-route-memory';
    function Search({owner}){const [value,setValue]=useHomeRouteMemory(owner,'search','');return <input aria-label="search" value={value} onChange={e=>setValue(e.target.value)}/>}
    function App(){const [open,setOpen]=useState(true);const [owner,setOwner]=useState('a');return <><button onClick={()=>setOpen(!open)}>route</button><button onClick={()=>setOwner(owner==='a'?'b':'a')}>owner</button>{open&&<Search owner={owner}/>}</>}
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient()}><App/></QueryClientProvider>);`;
  const build = await Bun.build({entrypoints:['route-fixture'],target:'browser',format:'iife',write:false,define:{'process.env.NODE_ENV':'"test"'},plugins:[{name:'fixture',setup(builder){builder.onResolve({filter:/^route-fixture$/},()=>({path:'entry',namespace:'fixture'}));builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:entry,loader:'tsx',resolveDir:import.meta.dir+'/..'}));}}]});
  expect(build.success).toBe(true);
  const browser = await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
  try {
    const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><div id="root"></div>'}));await page.goto('https://fixture.test/');
    await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw new Error('STORAGE_WRITE_FORBIDDEN')};});
    await page.addScriptTag({content:await build.outputs[0].text()});
    const field=page.getByRole('textbox',{name:'search'});await field.fill('합성 검색어');
    await page.getByRole('button',{name:'route',exact:true}).click();await browserExpect(field).toHaveCount(0);await page.getByRole('button',{name:'route',exact:true}).click();await browserExpect(field).toHaveValue('합성 검색어');
    await page.getByRole('button',{name:'owner',exact:true}).click();await browserExpect(field).toHaveValue('');await field.fill('다른 합성 검색어');
    await page.getByRole('button',{name:'owner',exact:true}).click();await browserExpect(field).toHaveValue('합성 검색어');expect(errors).toEqual([]);
  } finally {await browser.close();}
},30000);
