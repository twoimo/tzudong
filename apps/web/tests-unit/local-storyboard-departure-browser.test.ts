import { beforeAll, afterAll, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const localTest = existsSync(chrome) ? test : test.skip;
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
let browser: Browser | undefined;
let script: string;

// Run the complete production component in React. Fetch is an in-memory
// contract fixture; browser requests are fulfilled/aborted. No app server,
// provider, credentials, paid API or existing browser/profile is touched.
beforeAll(async () => {
    if (!existsSync(chrome)) return;
    const fixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { LocalStoryboardWorkspace } from './components/admin/storyboard/LocalStoryboardWorkspace';
import { STORYBOARD_WORKFLOW } from './lib/admin/storyboard/production-contract';
const A = '${A}', B = '${B}', now = '2026-10-05T00:00:00.000Z';
const scene = n => ({sceneNo:n, title:'Scene '+n, durationSec:10, description:'Description', visualDirection:'Camera',
 narration:'Narration', caption:'Caption', productionNotes:['Note'], imagePrompt:'Image', sourceIds:[], revision:1, image:null, imageError:null});
const project = id => ({id, revision:1, status:'partial', createdAt:now, updatedAt:now,
 request:{workflow:STORYBOARD_WORKFLOW,requestId:id,prompt:'Fixture',sceneCount:5,retrieval:'none',sources:[],imageWidth:1024,imageHeight:576,
 providers:{externalAI:false,text:{id:'manual',model:''},image:{id:'manual',model:''}}},
 document:{schema:STORYBOARD_WORKFLOW,projectId:id,revision:1,generatedAt:now,title:id===A?'Project A':'Project B',logline:'Fixture',
 textProvenance:{providerId:'manual',model:'',verification:'user-import',generatedAt:now,requestId:id,responseId:null,responseModel:null,modelEvidence:'unverified'},
 scenes:Array.from({length:5},(_,i)=>scene(i+1))}});
const projects = {[A]:project(A),[B]:project(B)};
let mode='success', readFailure=false, release=null, lastEdit=null;
const calls=[], confirms=[];
const fixtureApi = window.storyboardDepartureFixture = { answer:false, legacy:0, links:0, confirms,
 mode: value=>{mode=value;}, readFailure:value=>{readFailure=value;}, release:()=>release?.(),
 applyLast:()=>apply(lastEdit.id,lastEdit.body),
 advanceOther:()=>{projects[A].revision++;projects[A].document.revision++;},
 state:()=>({calls:structuredClone(calls),confirms:[...confirms],legacy:fixtureApi.legacy,links:fixtureApi.links})};
window.confirm = text=>{confirms.push(text);return fixtureApi.answer;};
function apply(id, body) {
 const p=projects[id];p.revision++;p.document.revision=p.revision;
 p.document.scenes[body.sceneNo-1]={...body.scene,revision:p.revision,image:null,imageError:null};
}
const view = id => ({ok:true,project:structuredClone(projects[id]),job:null,events:[]});
const reply = (value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
window.fetch = async (url,init={})=>{
 const method=init.method||'GET', path=new URL(url,location.href).pathname;
 if (path==='/api/admin/storyboard/production' && method==='GET') return reply({ok:true,workers:[],projects:Object.values(projects).map(p=>({id:p.id,revision:p.revision,status:p.status,title:p.document.title,createdAt:now,updatedAt:now}))});
 const id=path.split('/').at(-1);
 if (!projects[id]) throw new Error('Unexpected fixture request');
 if(method==='GET'){calls.push({method,id});if(readFailure)throw new TypeError('Fixture offline');return reply(view(id));}
 const body=JSON.parse(init.body);calls.push({method,id,body});lastEdit={id,body};
 if(body.action!=='edit')throw new Error('Unexpected mutation');
 if(body.revision!==projects[id].revision)return reply({ok:false,errorCode:'revision_conflict'},409);
 const selected=mode;
 if(selected==='deferred')await new Promise(resolve=>{release=resolve;});
 if(selected==='reject-unapplied')throw new TypeError('Fixture lost response');
 if(selected==='wrong-view')return reply(view(id));
 apply(id,body);
 if(selected==='reject-applied')throw new TypeError('Fixture lost response');
 return reply(view(id));
};
createRoot(document.getElementById('root')).render(<>
 <a href='/admin?module=users' onClick={e=>{e.preventDefault();fixtureApi.links++;}}>Other admin page</a>
 <button data-admin-console-menu-item-mode='desktop-sidebar' aria-controls='admin-console-canvas' onClick={()=>fixtureApi.links++}>Desktop module</button>
 <button data-admin-console-menu-item-mode='mobile-dropdown' aria-controls='admin-console-canvas' onClick={()=>fixtureApi.links++}>Mobile module</button>
 <LocalStoryboardWorkspace onOpenLegacy={()=>fixtureApi.legacy++}/>
</>);
`;
    const bundle = await Bun.build({
        entrypoints: ['storyboard-departure-fixture'], target: 'browser', format: 'iife', write: false,
        define: { 'process.env.NODE_ENV': '"test"' },
        plugins: [{ name: 'offline-storyboard', setup(builder) {
            builder.onResolve({ filter: /^storyboard-departure-fixture$/ }, () => ({ path: 'fixture.tsx', namespace: 'fixture' }));
            builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: fixture, loader: 'tsx', resolveDir: join(import.meta.dir, '..') }));
            builder.onResolve({ filter: /^@\// }, ({ path }) => {
                const target = join(import.meta.dir, '..', path.slice(2));
                const resolved = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'].map(suffix => target + suffix).find(existsSync);
                return resolved ? { path: resolved } : undefined;
            });
        } }],
    });
    expect(bundle.success).toBe(true);
    script = await bundle.outputs[0].text();
    browser = await chromium.launch({ executablePath: chrome, headless: true });
});
afterAll(async () => { await browser?.close(); });

type FixtureState = {
    calls: {method: string; id: string; body?: {action: string; revision: number; scene: {title: string}}}[];
    confirms: string[]; legacy: number; links: number;
};
type Fixture = {answer: boolean; mode(value: string): void; readFailure(value: boolean): void; release(): void;
    applyLast(): void; advanceOther(): void; state(): FixtureState};
declare global { interface Window { storyboardDepartureFixture: Fixture } }

async function run(check: (page: Page) => Promise<void>) {
    if (!browser) throw new Error('Local Chrome prerequisite missing');
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(5_000);
    const errors: string[] = [], blocked: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
        if (route.request().isNavigationRequest() && route.request().url().startsWith('http://storyboard.fixture.test/')) {
            return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
        }
        blocked.push(route.request().url()); return route.abort();
    });
    try {
        await page.goto(`http://storyboard.fixture.test/admin?module=storyboard&storyboardProject=${A}`);
        await page.addScriptTag({ content: script });
        await page.getByRole('button', { name: '장면 1 편집', exact: true }).waitFor();
        await check(page);
        expect(errors).toEqual([]); expect(blocked).toEqual([]);
    } finally { await context.close(); }
}
const state = (page: Page) => page.evaluate(() => window.storyboardDepartureFixture.state());
const editor = (page: Page) => page.getByLabel('장면 제목', { exact: true });
async function edit(page: Page, title='Unsaved fixture') {
    await page.getByRole('button', { name: '장면 1 편집', exact: true }).click();
    await editor(page).fill(title);
}
async function waitEditable(page: Page) {
    await page.waitForFunction(() => {
        const button = [...document.querySelectorAll('button')].find(item => item.textContent === '장면 저장');
        return button instanceof HTMLButtonElement && !button.matches(':disabled');
    });
}

localTest('project/new/legacy/sidebar/Escape guards preserve the draft; accepted discard works', () => run(async page => {
    await edit(page);
    for (const action of [
        () => page.getByLabel('프로젝트 선택', {exact:true}).selectOption(B),
        () => page.getByRole('button', {name:'새 프로젝트',exact:true}).click(),
        () => page.getByRole('link', {name:'Other admin page'}).click(),
        () => page.getByRole('button', {name:'Desktop module',exact:true}).click(),
        () => page.getByRole('button', {name:'Mobile module',exact:true}).press('Enter'),
        () => editor(page).press('Escape'),
        () => page.getByRole('button', {name:'편집 닫기',exact:true}).click(),
    ]) {
        await action(); expect(await editor(page).inputValue()).toBe('Unsaved fixture');
        expect(await page.getByLabel('프로젝트 선택', {exact:true}).inputValue()).toBe(A);
    }
    await page.getByRole('button', {name:'연결 설정',exact:true}).click();
    await page.getByRole('button', {name:'이전 작업 공간 열기',exact:true}).click();
    const cancelled = await state(page);
    expect(cancelled.confirms).toHaveLength(8); expect(cancelled.legacy).toBe(0); expect(cancelled.links).toBe(0);
    expect(cancelled.calls.filter(item => item.method === 'POST')).toHaveLength(0);
    expect(await page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', {cancelable:true})))).toBe(true);
    await page.evaluate(() => { window.storyboardDepartureFixture.answer = true; });
    await page.getByLabel('프로젝트 선택', {exact:true}).selectOption(B);
    await page.getByRole('heading', {name:'Project B',exact:true}).waitFor();
    expect(await editor(page).count()).toBe(0);
    expect(await page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', {cancelable:true})))).toBe(false);
}), 20_000);

localTest('unchanged editor closes without confirmation; browser back cancellation retains B and its URL', () => run(async page => {
    await page.getByRole('button', {name:'장면 1 편집',exact:true}).click();
    await page.getByRole('button', {name:'편집 닫기',exact:true}).click();
    expect((await state(page)).confirms).toHaveLength(0);
    await page.getByLabel('프로젝트 선택', {exact:true}).selectOption(B);
    await page.getByRole('heading', {name:'Project B',exact:true}).waitFor();
    await edit(page, 'B retained');
    await page.evaluate(() => history.back());
    await page.waitForFunction(() => window.storyboardDepartureFixture.state().confirms.length === 1);
    expect(page.url()).toContain(B); expect(await editor(page).inputValue()).toBe('B retained');
    await page.evaluate(() => {window.storyboardDepartureFixture.answer = true; history.back();});
    await page.getByRole('heading', {name:'Project A',exact:true}).waitFor();
    expect(page.url()).toContain(A);
}), 15_000);

localTest('in-flight save blocks departure, then a matching response/readback permits clean navigation', () => run(async page => {
    await edit(page);
    await page.evaluate(() => window.storyboardDepartureFixture.mode('deferred'));
    await page.getByRole('button', {name:'장면 저장',exact:true}).click();
    await page.getByLabel('프로젝트 선택', {exact:true}).selectOption(B);
    expect(await editor(page).inputValue()).toBe('Unsaved fixture');
    expect((await state(page)).confirms).toHaveLength(0);
    expect(await page.getByText('요청 처리 중입니다. 저장 결과를 확인한 뒤 이동하세요.', {exact:true}).count()).toBe(1);
    await page.evaluate(() => window.storyboardDepartureFixture.release());
    await editor(page).waitFor({state:'detached'});
    await page.waitForFunction(() => !document.querySelector('#local-edit-1')?.matches(':disabled'));
    await page.getByLabel('프로젝트 선택', {exact:true}).selectOption(B);
    await page.getByRole('heading', {name:'Project B',exact:true}).waitFor();
    const posts=(await state(page)).calls.filter(item => item.method === 'POST');
    expect(posts).toHaveLength(1); expect(posts[0].id).toBe(A); expect(posts[0].body?.action).toBe('edit');
}), 15_000);

localTest('lost save response plus failed GET retains draft and uncertainty; only explicit retry writes', () => run(async page => {
    await edit(page);
    await page.evaluate(() => {window.storyboardDepartureFixture.mode('reject-unapplied'); window.storyboardDepartureFixture.readFailure(true);});
    await page.getByRole('button', {name:'장면 저장',exact:true}).click();
    await page.getByText('편집 내용의 저장 여부를 확인하지 못했습니다.', {exact:false}).waitFor();
    await page.getByRole('button', {name:'새 프로젝트',exact:true}).click();
    expect((await state(page)).confirms.at(-1)).toContain('저장 여부');
    expect(await editor(page).inputValue()).toBe('Unsaved fixture');
    expect((await state(page)).calls.filter(item => item.method === 'POST')).toHaveLength(1);
    await page.evaluate(() => {window.storyboardDepartureFixture.mode('success'); window.storyboardDepartureFixture.readFailure(false);});
    await page.getByRole('button', {name:'새로고침',exact:true}).click();
    await waitEditable(page);
    expect(await editor(page).inputValue()).toBe('Unsaved fixture');
    await page.getByRole('button', {name:'장면 저장',exact:true}).click();
    await editor(page).waitFor({state:'detached'});
    const posts=(await state(page)).calls.filter(item => item.method === 'POST');
    expect(posts.map(item => [item.id,item.body?.revision,item.body?.scene.title])).toEqual([[A,1,'Unsaved fixture'],[A,1,'Unsaved fixture']]);
}), 15_000);

localTest('a committed save with lost POST response is confirmed by GET without a duplicate write', () => run(async page => {
    await edit(page);
    await page.evaluate(() => window.storyboardDepartureFixture.mode('reject-applied'));
    await page.getByRole('button', {name:'장면 저장',exact:true}).click();
    await editor(page).waitFor({state:'detached'});
    expect(await page.getByRole('heading', {name:'1. Unsaved fixture',exact:true}).count()).toBe(1);
    expect((await state(page)).calls.filter(item => item.method === 'POST')).toHaveLength(1);
    expect(await page.getByText('저장한 편집 내용을 서버에서 확인했습니다.', {exact:true}).count()).toBe(1);
}), 15_000);

localTest('a structurally valid wrong POST view cannot clear the edit or claim it saved', () => run(async page => {
    await edit(page);
    await page.evaluate(() => window.storyboardDepartureFixture.mode('wrong-view'));
    await page.getByRole('button', {name:'장면 저장',exact:true}).click();
    await waitEditable(page);
    expect(await editor(page).inputValue()).toBe('Unsaved fixture');
    expect(await page.getByText('서버에 변경 사항을 저장했습니다.', {exact:true}).count()).toBe(0);
    await page.getByRole('button', {name:'편집 닫기',exact:true}).click();
    expect((await state(page)).confirms.at(-1)).toContain('저장 여부');
    await page.evaluate(() => window.storyboardDepartureFixture.mode('success'));
    await page.getByRole('button', {name:'장면 저장',exact:true}).click();
    await editor(page).waitFor({state:'detached'});
    expect((await state(page)).calls.filter(item => item.method === 'POST')).toHaveLength(2);
}), 15_000);

localTest('an unrelated newer revision preserves the uncertain draft and blocks stale retry', () => run(async page => {
    await edit(page);
    await page.evaluate(() => {window.storyboardDepartureFixture.mode('reject-unapplied'); window.storyboardDepartureFixture.advanceOther();});
    await page.getByRole('button', {name:'장면 저장',exact:true}).click();
    await page.getByText('편집을 시작한 뒤 버전이 변경되었습니다.', {exact:false}).waitFor();
    expect(await editor(page).inputValue()).toBe('Unsaved fixture');
    expect(await page.getByRole('button', {name:'장면 저장',exact:true}).isDisabled()).toBe(true);
    await page.getByRole('button', {name:'새 프로젝트',exact:true}).click();
    expect((await state(page)).confirms.at(-1)).toContain('저장 여부');
    expect((await state(page)).calls.filter(item => item.method === 'POST')).toHaveLength(1);
}), 15_000);

localTest('later readback of an earlier save rebases without dropping newer local edits', () => run(async page => {
    await edit(page, 'First edit');
    await page.evaluate(() => window.storyboardDepartureFixture.mode('reject-unapplied'));
    await page.getByRole('button', {name:'장면 저장',exact:true}).click();
    await waitEditable(page);
    await editor(page).fill('Second edit');
    await page.evaluate(() => {window.storyboardDepartureFixture.applyLast(); window.storyboardDepartureFixture.mode('success');});
    await page.getByRole('button', {name:'새로고침',exact:true}).click();
    await page.waitForFunction(() => document.body.textContent?.includes('저장한 편집 내용을 서버에서 확인했습니다.'));
    expect(await editor(page).inputValue()).toBe('Second edit');
    await waitEditable(page);
    await page.getByRole('button', {name:'장면 저장',exact:true}).click();
    await editor(page).waitFor({state:'detached'});
    const posts=(await state(page)).calls.filter(item => item.method === 'POST');
    expect(posts.map(item => [item.body?.revision,item.body?.scene.title])).toEqual([[1,'First edit'],[2,'Second edit']]);
}), 15_000);
