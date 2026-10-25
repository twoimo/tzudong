import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { bundleFixture, serveFixture } from '../performance/cluster-icon-readiness-20261024-v1/fixture.mjs';

const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browserTest=existsSync(chrome)?test:test.skip;
browserTest('primer uses the rendered WebP inventory once and disappears on map disposal',async()=>{
  const browser=await chromium.launch({executablePath:chrome,headless:true});
  try {
    const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    const network=await serveFixture(page,await bundleFixture(true),10);
    await page.waitForFunction(()=>[...document.querySelectorAll<HTMLImageElement>('[data-category-marker-primer] img')].length===18&&[...document.querySelectorAll<HTMLImageElement>('[data-category-marker-primer] img')].every(image=>image.complete&&image.naturalWidth>0));
    const state=await page.evaluate(()=>({hidden:(document.querySelector('[data-category-marker-primer]') as HTMLElement).hidden,
      images:[...document.querySelectorAll<HTMLImageElement>('[data-category-marker-primer] img')].map(image=>({source:image.currentSrc,priority:image.fetchPriority,decoding:image.decoding,alt:image.alt}))}));
    expect(state.hidden).toBe(true);expect(state.images).toHaveLength(18);
    expect(state.images.every(image=>image.source.endsWith('.webp')&&image.priority==='low'&&image.decoding==='async'&&image.alt==='')).toBe(true);
    await page.locator('#expand').click();
    await page.waitForFunction(()=>[...document.querySelectorAll<HTMLImageElement>('#map img')].every(image=>image.complete&&image.naturalWidth>0));
    expect(network.requests).toHaveLength(18);expect(new Set(network.requests).size).toBe(18);
    await page.evaluate(()=>{(window as unknown as {fixture:{dispose():void}}).fixture.dispose();});
    expect(await page.locator('[data-category-marker-primer]').count()).toBe(0);
    expect(await page.locator('#map [data-testid="marker"]').count()).toBe(76);
    expect(errors).toEqual([]);expect(network.unexpected).toEqual([]);
  } finally {await browser.close();}
},30_000);

browserTest('failed images and early unmount do not recreate primer nodes or write marker DOM',async()=>{
  const browser=await chromium.launch({executablePath:chrome,headless:true});
  try {
    const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await serveFixture(page,await bundleFixture(true),80,true);
    await page.evaluate(()=>{(window as unknown as {fixture:{dispose():void}}).fixture.dispose();});
    await page.locator('#expand').click();
    await page.waitForFunction(()=>[...document.querySelectorAll<HTMLImageElement>('#map img')].every(image=>image.complete));
    expect(await page.locator('[data-category-marker-primer]').count()).toBe(0);
    expect(await page.locator('#map [data-testid="marker"]').count()).toBe(76);
    expect(errors).toEqual([]);
  } finally {await browser.close();}
},30_000);

browserTest('an unsupported picture source type selects only the PNG fallback',async()=>{
  const browser=await chromium.launch({executablePath:chrome,headless:true});
  try {
    const page=await browser.newPage();
    // Exercise the browser's fallback branch without changing the host codec.
    const network=await serveFixture(page,(await bundleFixture(true)).replaceAll('image/webp','image/x-fixture-unsupported'),10);
    await page.waitForFunction(()=>[...document.querySelectorAll<HTMLImageElement>('[data-category-marker-primer] img')].every(image=>image.complete&&image.naturalWidth>0));
    await page.locator('#expand').click();
    await page.waitForFunction(()=>[...document.querySelectorAll<HTMLImageElement>('#map img')].every(image=>image.complete&&image.naturalWidth>0));
    expect(network.requests).toHaveLength(18);
    expect(network.requests.every(path=>path.endsWith('.png'))).toBe(true);
    expect(network.unexpected).toEqual([]);
  } finally {await browser.close();}
},30_000);
