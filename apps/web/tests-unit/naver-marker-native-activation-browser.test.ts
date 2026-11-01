import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { chromium, type Page } from '@playwright/test';
import { chromeForTestingExecutable } from './fixtures/chrome-for-testing';
const appRoot = join(import.meta.dir, '..');
type Fixture = { counts: Record<string, number>; update(): void; recycle(): void; move(): void; clear(): void;
  acquire(id: string, name: string, key: string, map?: number): void; oldButton: HTMLButtonElement; saved: HTMLButtonElement;
  a: { element: HTMLElement }; pool: { release(id: string): void } };
const entry = `
import { markerPool } from './lib/marker-pool';
import { createIndividualMarkerHTML, createClusterMarkerHTML } from './lib/cluster-marker';
const counts={a:0,updated:0,b:0,cluster:0,other:0,sdk:0,registrations:0,removals:0};
function map(){const root=document.body.appendChild(document.createElement('div'));root.style='display:flex;gap:40px;min-height:80px';const add=root.addEventListener.bind(root),remove=root.removeEventListener.bind(root);root.addEventListener=(t,h,o)=>{if(t==='click'&&o===true)counts.registrations++;add(t,h,o)};root.removeEventListener=(t,h,o)=>{if(t==='click'&&o===true)counts.removals++;remove(t,h,o)};return{root,getElement(){return root}}}
class Marker{constructor({map,position,icon}){this.element=document.createElement('div');this.position=position;this.setIcon(icon);this.setMap(map);this.element.addEventListener('click',e=>{if(e.detail>0){counts.sdk++;this.listener?.(e)}})}getMap(){return this.map}setMap(m){this.map=m;if(m)m.root.append(this.element);else this.element.remove()}getPosition(){return this.position}setPosition(p){this.position=p}getIcon(){return this.icon}setIcon(i){this.icon=i;this.element.innerHTML=i.content}getElement(){return this.element}setZIndex(){}}
window.naver={maps:{Marker,Event:{addListener(m,t,h){m.listener=h;return{m,h}},removeListener({m,h}){if(m.listener===h)m.listener=undefined}}}};
const maps=[map(),map()];const icon=(id,name)=>({content:createIndividualMarkerHTML('한식',false,0,id,name),anchor:{x:16,y:16}});
const acquire=(id,name,key,which=0)=>markerPool.acquire(id,{id},icon(id,name),maps[which],()=>counts[key]++);
const a=acquire('a','합성 A','a');
markerPool.acquire('cluster',{id:'cluster'},{content:createClusterMarkerHTML({type:'Feature',geometry:{type:'Point',coordinates:[127,37]},properties:{cluster:true,cluster_id:1,point_count:2,point_count_abbreviated:2}},['한식'],0),anchor:{x:16,y:16}},maps[0],()=>counts.cluster++);
const other=maps[0].root.appendChild(document.createElement('button'));other.textContent='다른 지도 제어';other.onclick=()=>counts.other++;
window.fixture={counts,pool:markerPool,a,acquire,update(){acquire('a','새 합성 A','updated')},recycle(){this.oldButton=a.element.querySelector('button');markerPool.release('a');acquire('b','합성 B','b')},move(){acquire('a','합성 A','updated',1)},clear(){markerPool.clear()}};
`;
async function bundle(broken = false) {
  const result = await Bun.build({ entrypoints: ['native-marker-fixture'], target: 'browser', format: 'iife', write: false,
    plugins: [{ name: 'native-marker-fixture', setup(build) {
      build.onResolve({ filter: /^native-marker-fixture$/ }, () => ({ path: 'entry', namespace: 'fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'ts', resolveDir: appRoot }));
      if (broken) build.onLoad({ filter: /[/\\]lib[/\\]marker-pool\.ts$/ }, args => {
        const source = readFileSync(args.path, 'utf8'), anchor = 'this.retainNativeActivation(marker, map);';
        if (source.split(anchor).length !== 2) throw new Error('NATIVE_ACTIVATION_MUTATION_ANCHOR_DRIFT');
        return { contents: source.replace(anchor, ''), loader: 'ts', resolveDir: join(appRoot, 'lib') };
      });
      build.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync('./' + args.path.slice(2), appRoot) }));
    }}] });
  expect(result.success).toBe(true); return result.outputs[0].text();
}
async function fixture(run: (page: Page) => Promise<void>, broken = false) {
  const browser = await chromium.launch({ executablePath: chromeForTestingExecutable(), headless: true });
  try { const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
    await page.route('**/*', route => route.request().resourceType() === 'document'
      ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><body></body></html>' }) : route.abort());
    await page.goto('https://native-marker-fixture.test/'); await page.addScriptTag({ content: await bundle(broken) }); await run(page);
  } finally { await browser.close(); }
}
const counts = (page: Page) => page.evaluate(() => (window as unknown as { fixture: Fixture }).fixture.counts);
describe('current native marker activation through a pointer-only SDK', () => {
  test('individual and cluster Enter/Space/pointer activate exactly once, leaving other controls alone', async () => {
    await fixture(async page => {
      for (const name of ['합성 A 상세 보기', '맛집 2곳 모아보기, 지도 확대']) {
        const b=page.getByRole('button',{name,exact:true});await b.focus();await page.keyboard.press('Enter');await page.keyboard.press('Space');await b.click();
      }
      expect(await counts(page)).toMatchObject({a:3,cluster:3,sdk:2,registrations:1});
      await page.getByRole('button',{name:'다른 지도 제어',exact:true}).focus();await page.keyboard.press('Enter');
      expect(await counts(page)).toMatchObject({a:3,cluster:3,other:1});
    });
  },30_000);
  test('omitting the bridge reproduces keyboard failure with a working pointer control', async () => {
    await fixture(async page => {const b=page.getByRole('button',{name:'합성 A 상세 보기',exact:true});await b.focus();await page.keyboard.press('Enter');await page.keyboard.press('Space');expect(await counts(page)).toMatchObject({a:0,registrations:0});await b.click();expect(await counts(page)).toMatchObject({a:1,sdk:1})},true);
  },30_000);
  test('new callbacks and replaced icon DOM retain current ownership without root-listener growth', async () => {
    await fixture(async page => {await page.evaluate(()=>(window as unknown as {fixture:Fixture}).fixture.update());const b=page.getByRole('button',{name:'새 합성 A 상세 보기',exact:true});await b.focus();await page.keyboard.press('Enter');expect(await counts(page)).toMatchObject({a:0,updated:1,registrations:1})});
  },30_000);
  test('recycled handles and detached old button references cannot invoke stale callbacks', async () => {
    await fixture(async page => {await page.evaluate(()=>{const f=(window as unknown as {fixture:Fixture}).fixture;f.recycle();f.oldButton.click()});const b=page.getByRole('button',{name:'합성 B 상세 보기',exact:true});await b.focus();await page.keyboard.press('Space');expect(await counts(page)).toMatchObject({a:0,b:1,registrations:1})});
  },30_000);
  test('inert, aria-hidden and disabled markers have no native activation authority', async () => {
    await fixture(async page => {await page.evaluate(()=>{const e=(window as unknown as {fixture:Fixture}).fixture.a.element,b=e.querySelector('button')!;e.inert=true;b.click();e.inert=false;e.setAttribute('aria-hidden','true');b.click();e.removeAttribute('aria-hidden');e.hidden=true;b.click();e.hidden=false;e.setAttribute('aria-disabled','true');b.click();e.removeAttribute('aria-disabled');b.disabled=true;b.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:0}));b.disabled=false});expect(await counts(page)).toMatchObject({a:0,sdk:0})});
  },30_000);
  test('moving maps and clearing dispose root listeners before a later single owned activation', async () => {
    await fixture(async page => {await page.evaluate(()=>{const f=(window as unknown as {fixture:Fixture}).fixture;f.move();f.pool.release('cluster')});await page.getByRole('button',{name:'합성 A 상세 보기',exact:true}).focus();await page.keyboard.press('Enter');expect(await counts(page)).toMatchObject({updated:1,registrations:2,removals:1});await page.evaluate(()=>{const f=(window as unknown as {fixture:Fixture}).fixture;f.saved=f.a.element.querySelector('button')!;f.clear();f.saved.click();f.acquire('b','합성 B','b',1)});await page.getByRole('button',{name:'합성 B 상세 보기',exact:true}).focus();await page.keyboard.press('Enter');expect(await counts(page)).toMatchObject({updated:1,b:1,registrations:3,removals:2})});
  },30_000);
});
