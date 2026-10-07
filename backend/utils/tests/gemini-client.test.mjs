import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { GoogleGenAI } from '@google/genai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { generateChunkContent } from '../../restaurant-crawling/scripts/gemini_chunk_video_request.mjs';
import { createGeminiClient, generateWithProjectBudget, geminiHttpOptions, logGeminiUsage, requireGeminiText, withGeminiDeadline } from '../gemini-client.mjs';
import { withProjectBudget } from '../provider-budget.mjs';

const execute = promisify(execFile);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-budget-test-'));
const saved = Object.fromEntries(['GEMINI_BUDGET_PATH','GEMINI_BUDGET_PROJECT','GEMINI_REQUESTS_PER_MINUTE','GEMINI_MAX_INFLIGHT'].map(key => [key,process.env[key]]));
Object.assign(process.env, { GEMINI_BUDGET_PATH:path.join(directory,'budget.sqlite'), GEMINI_BUDGET_PROJECT:'sdk-fixture', GEMINI_REQUESTS_PER_MINUTE:'100000', GEMINI_MAX_INFLIGHT:'1' });
test.after(() => {
    for (const [key,value] of Object.entries(saved)) value === undefined ? delete process.env[key] : process.env[key]=value;
    fs.rmSync(directory,{recursive:true,force:true});
});
const pause = ms => new Promise(resolve => setTimeout(resolve,ms));
async function leases() {
    const {stdout}=await execute(process.env.RUN_DAILY_PYTHON || 'python3',['-c',
        'import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); print(c.execute("SELECT count(*) FROM leases").fetchone()[0]); c.close()',process.env.GEMINI_BUDGET_PATH]);
    return Number(stdout.trim());
}
const responseBody = {candidates:[{content:{role:'model',parts:[{text:'{"ok":true}'}]}}],usageMetadata:{promptTokenCount:3,candidatesTokenCount:5,totalTokenCount:8}};
test('release debt recovers in the same live process before admitting a new provider call', async () => {
    const originalPython=process.env.RUN_DAILY_PYTHON || (await execute('python3',['-c','import sys;print(sys.executable)'])).stdout.trim();
    const wrapper=path.join(directory,'release-wrapper');const flag=path.join(directory,'release-failed');
    const previousPython=process.env.RUN_DAILY_PYTHON,previousFlag=process.env.FX_RELEASE_FAILURE;
    fs.writeFileSync(wrapper,`#!${originalPython}\nimport os,sys,subprocess\nfrom pathlib import Path\nif '--lease' in sys.argv and Path(os.environ['FX_RELEASE_FAILURE']).exists():raise SystemExit(1)\nraise SystemExit(subprocess.run([${JSON.stringify(originalPython)},*sys.argv[1:]],env=os.environ).returncode)\n`,{mode:0o700});
    process.env.RUN_DAILY_PYTHON=wrapper;process.env.FX_RELEASE_FAILURE=flag;
    let calls=0;
    try {
        fs.writeFileSync(flag,'fixture');
        assert.equal(await withProjectBudget(async()=>{calls++;return 'settled';}),'settled');
        assert.equal(await leases(),1);
        await assert.rejects(withProjectBudget(async()=>{calls++;return 'must-not-start';}),/PROVIDER_BUDGET_UNAVAILABLE/);
        assert.equal(calls,1);
        fs.unlinkSync(flag);
        assert.equal(await withProjectBudget(async()=>{calls++;return 'next';},{acquireTimeoutMs:1000}),'next');
        assert.equal(calls,2);assert.equal(await leases(),0);
    } finally {
        if(previousPython===undefined)delete process.env.RUN_DAILY_PYTHON;else process.env.RUN_DAILY_PYTHON=previousPython;
        if(previousFlag===undefined)delete process.env.FX_RELEASE_FAILURE;else process.env.FX_RELEASE_FAILURE=previousFlag;
    }
});
async function removeFixtureLeases(budgetPath) {
    await execute(process.env.RUN_DAILY_PYTHON || 'python3', ['-c',
        'import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute("DELETE FROM leases"); c.commit(); c.close()', budgetPath]);
}

test('successful result releases the captured acquisition scope even if the caller changes its environment', async () => {
    const originalPath=process.env.GEMINI_BUDGET_PATH;let calls=0;
    const expected={text:'settled-result',usageMetadata:{totalTokenCount:8}};
    try {
        const result=await withProjectBudget(async()=>{
            calls++;process.env.GEMINI_BUDGET_PATH=directory;return expected;
        });
        assert.strictEqual(result,expected);assert.equal(calls,1);
    } finally {
        process.env.GEMINI_BUDGET_PATH=originalPath;
        await removeFixtureLeases(originalPath);
    }
    assert.equal(await leases(),0);
});

test('provider error identity survives caller environment changes during cooldown and release', async () => {
    const originalPath=process.env.GEMINI_BUDGET_PATH;
    const expected=Object.assign(new Error('synthetic-provider-failure'),{headers:{'retry-after':'1'}});
    try {
        await assert.rejects(withProjectBudget(async()=>{
            process.env.GEMINI_BUDGET_PATH=directory;throw expected;
        }),error=>error===expected);
    } finally {
        process.env.GEMINI_BUDGET_PATH=originalPath;
        await removeFixtureLeases(originalPath);
    }
});
async function serverFixture(handler) {
    const server=createServer(handler);
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
    return {server,baseUrl:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(resolve=>server.close(resolve))};
}

test('installed SDK default and explicit one-attempt policy each send exactly one HTTP request',async()=>{
    let requests=0;
    const fixture=await serverFixture((_req,res)=>{requests++;res.writeHead(503,{'content-type':'application/json'});res.end('{"error":{"message":"fixture","code":503}}');});
    try {
        for (const httpOptions of [{baseUrl:fixture.baseUrl},{...geminiHttpOptions(1000),baseUrl:fixture.baseUrl}]) {
            const ai=new GoogleGenAI({apiKey:'fixture',httpOptions});
            await assert.rejects(ai.models.generateContent({model:'gemini-3.7-flash',contents:'fixture'}),error=>error.status===503);
        }
        assert.equal(requests,2);
    } finally {await fixture.close();}
});

test('legacy and current SDK preserve model, prompt and generation settings on the wire',async()=>{
    const bodies=[];const routes=[];
    const fixture=await serverFixture(async(req,res)=>{
        let data='';for await(const chunk of req)data+=chunk;
        bodies.push(JSON.parse(data));routes.push(req.url.split('?')[0]);
        res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(responseBody));
    });
    const config={temperature:.1,maxOutputTokens:8192,responseMimeType:'application/json',thinkingConfig:{thinkingLevel:'MEDIUM'}};
    try {
        const model=new GoogleGenerativeAI('fixture').getGenerativeModel({model:'gemini-3.7-flash',generationConfig:config},{baseUrl:fixture.baseUrl});
        await model.generateContent('fixture');
        const ai=createGeminiClient('fixture');
        const result=await generateWithProjectBudget(ai,{model:'gemini-3.7-flash',contents:'fixture',config:{...config,httpOptions:{baseUrl:fixture.baseUrl}}},1000);
        assert.equal(result.text,'{"ok":true}');
        assert.deepEqual(bodies[0].contents,bodies[1].contents);
        assert.deepEqual(bodies[0].generationConfig,bodies[1].generationConfig);
        assert.deepEqual(routes[0],routes[1]);
        assert.equal(await leases(),0);
    }finally{await fixture.close();}
});

test('deadline aborts but does not release a project permit while the SDK promise remains unsettled',async()=>{
    let settle;let announced;const started=new Promise(resolve=>announced=resolve);
    let signal;let secondStarted=false;
    const first=generateWithProjectBudget({models:{generateContent:request=>{signal=request.config.abortSignal;announced();return new Promise(resolve=>settle=resolve);}}},{model:'gemini-3.7-flash',contents:'fixture'},20);
    const observed=first.then(()=>null,error=>error);
    await started;await pause(30);
    assert.equal(signal.aborted,true);
    const second=generateWithProjectBudget({models:{generateContent:async()=>{secondStarted=true;return {text:'ok'};}}},{model:'gemini-3.7-flash',contents:'fixture'},1000);
    await pause(35);
    try {
        assert.equal(secondStarted,false);assert.equal(await leases(),1);
    }finally{settle({text:'late response'});}
    assert.equal((await observed).code,'GEMINI_API_TIMEOUT');
    assert.equal((await second).text,'ok');assert.equal(await leases(),0);
});

test('SDK HTTP timeout aborts transport, publishes no success and leaves no lease',async()=>{
    let closed=false;
    const fixture=await serverFixture((req,_res)=>req.on('close',()=>{closed=true;}));
    try {
        const ai=createGeminiClient('fixture');
        await assert.rejects(generateWithProjectBudget(ai,{model:'gemini-3.7-flash',contents:'fixture',config:{httpOptions:{baseUrl:fixture.baseUrl}}},40),error=>error.code==='GEMINI_API_TIMEOUT');
        assert.equal(await leases(),0);assert.equal(closed,true);
    }finally{fixture.server.closeAllConnections();await fixture.close();}
});

test('Retry-After from real SDK response headers applies a shared project cooldown',async()=>{
    let requests=0;
    const fixture=await serverFixture((_req,res)=>{
        requests++;res.writeHead(429,{'content-type':'application/json','retry-after':'1'});res.end('{"error":{"message":"fixture","code":429}}');
    });
    try {
        const ai=createGeminiClient('fixture');
        await assert.rejects(generateWithProjectBudget(ai,{model:'gemini-3.7-flash',contents:'fixture',config:{httpOptions:{baseUrl:fixture.baseUrl}}},1000),error=>error.status===429);
        assert.equal(requests,1);
        const start=Date.now();
        await generateWithProjectBudget({models:{generateContent:async()=>({text:'ok'})}},{model:'gemini-3.7-flash',contents:'fixture'},1000);
        assert.ok(Date.now()-start>=800);assert.equal(await leases(),0);
    }finally{await fixture.close();}
});

test('already-cancelled requests never invoke SDK and invalid deadlines fail closed',async()=>{
    const controller=new AbortController();controller.abort();let calls=0;
    const ai={models:{generateContent:()=>{calls++;return Promise.resolve({text:'bad'});}}};
    await assert.rejects(generateWithProjectBudget(ai,{config:{abortSignal:controller.signal}}),{code:'GEMINI_REQUEST_ABORTED'});
    await assert.rejects(withGeminiDeadline(()=>null,0),{code:'GEMINI_TIMEOUT_INVALID'});
    assert.equal(calls,0);
});

test('usage logs include thinking counts and exclude content or provider diagnostics',()=>{
    const logs=[];
    logGeminiUsage({text:'must-not-be-logged',usageMetadata:{promptTokenCount:3,thoughtsTokenCount:7,totalTokenCount:10,candidatesTokenCount:-1,secret:'must-not-be-logged'}},line=>logs.push(line));
    assert.deepEqual(logs,['GEMINI_USAGE {"promptTokenCount":3,"thoughtsTokenCount":7,"totalTokenCount":10}']);
});

test('empty or blocked SDK text cannot be published as a completed result',()=>{
    for(const result of [{},{text:''},{text:'  '},{text:null}]) assert.throws(()=>requireGeminiText(result),{code:'GEMINI_EMPTY_RESPONSE'});
    assert.equal(requireGeminiText({text:'{"ok":true}'}),'{"ok":true}');
});

test('thinking fallback retains Gemini 3 default sampling and chunk output limit',async()=>{
    let request;
    const ai={models:{generateContent:async value=>{request=value;return {text:'{"ok":true}'};}}};
    await generateChunkContent(ai,'gemini-3.7-flash','fixture',{uri:'fixture-file',mimeType:'video/mp4'},'video/mp4','');
    assert.equal(Object.hasOwn(request.config,'temperature'),false);
    assert.equal(request.config.maxOutputTokens,4096);
    assert.equal(request.config.thinkingConfig,undefined);
    assert.equal(request.contents[0].parts[1].fileData.fileUri,'fixture-file');
    assert.equal(await leases(),0);
});

test('evaluation entrypoints keep model and thinking settings while omitting sampling only for 3.8', async () => {
    const input = path.join(directory, 'compatibility-input.txt');
    const output = path.join(directory, 'compatibility-output.txt');
    const wire = path.join(directory, 'compatibility-wire.jsonl');
    const preload = path.join(directory, 'compatibility-transport.mjs');
    fs.writeFileSync(input, 'synthetic evaluation prompt');
    // All SDK HTTP requests terminate here; no real key, headers or network leave the child.
    fs.writeFileSync(preload, `import fs from 'node:fs';
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.hostname !== 'generativelanguage.googleapis.com') throw new Error('UNEXPECTED_FIXTURE_HOST');
  fs.appendFileSync(process.env.FX_COMPATIBILITY_WIRE, JSON.stringify({ path: url.pathname, method: request.method, body: await request.json() }) + '\\n');
  return Response.json(${JSON.stringify(responseBody)});
};\n`);
    const scripts = ['../../restaurant-evaluation/scripts/gemini_api_request.mjs', '../../bin/review_recheck_gemini.mjs'];
    for (const script of scripts) {
        for (const model of [undefined, 'gemini-3.7-flash', 'gemini-3.8-flash', 'models/gemini-3.8-flash']) {
            for (const thinking of ['LOW', 'MEDIUM', 'HIGH', 'MINIMAL', 'minimal']) {
                fs.writeFileSync(wire, '');
                fs.rmSync(output, { force: true });
                const env = {
                    PATH: process.env.PATH,
                    GEMINI_API_KEY: 'synthetic-compatibility-key',
                    GEMINI_BUDGET_PATH: path.join(directory, 'compatibility-budget.sqlite'),
                    GEMINI_BUDGET_PROJECT: 'compatibility-fixture',
                    GEMINI_REQUESTS_PER_MINUTE: '100000', GEMINI_MAX_INFLIGHT: '1',
                    FX_COMPATIBILITY_WIRE: wire, LAAJ_THINKING_LEVEL: thinking,
                    ...(model ? { PRIMARY_MODEL: model } : {}),
                };
                const task = execute(process.execPath, ['--import', preload, fileURLToPath(new URL(script, import.meta.url)), input, output], { env });
                const unsupported = model?.includes('gemini-3.8-flash') && thinking.toUpperCase() === 'MINIMAL';
                if (unsupported) {
                    await assert.rejects(task, error => error.code === 1);
                    assert.equal(fs.readFileSync(wire, 'utf8'), '');
                    assert.equal(fs.existsSync(output), false);
                    continue;
                }
                await task;
                const requests = fs.readFileSync(wire, 'utf8').trim().split('\n').map(line => JSON.parse(line));
                assert.equal(requests.length, 1);
                assert.equal(requests[0].path, `/v1beta/models/${(model || 'gemini-3.7-flash').replace(/^models\//, '')}:generateContent`);
                assert.equal(requests[0].method, 'POST');
                assert.deepEqual(requests[0].body.contents, [{ role: 'user', parts: [{ text: 'synthetic evaluation prompt' }] }]);
                assert.deepEqual(requests[0].body.generationConfig, {
                    ...(model?.includes('gemini-3.8-flash') ? {} : { temperature: 0.1 }),
                    maxOutputTokens: 4096,
                    thinkingConfig: { thinkingLevel: script.includes('gemini_api_request') ? thinking.toUpperCase() : thinking },
                });
                assert.equal(fs.readFileSync(output, 'utf8'), '{"ok":true}');
            }
        }
    }
});
