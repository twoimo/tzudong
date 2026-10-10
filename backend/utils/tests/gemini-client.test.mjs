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
import { createGeminiClient, generateWithProjectBudget, omitUnsupportedGeminiSampling, geminiHttpOptions, logGeminiUsage, requireGeminiText, withGeminiDeadline } from '../gemini-client.mjs';
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

test('shared client migrates the exact legacy model while preserving prompt and generation settings',async()=>{
    const bodies=[];const routes=[];
    const fixture=await serverFixture(async(req,res)=>{
        let data='';for await(const chunk of req)data+=chunk;
        bodies.push(JSON.parse(data));routes.push(req.url.split('?')[0]);
        res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(responseBody));
    });
    const config=omitUnsupportedGeminiSampling('gemini-3.7-flash',{temperature:.1,maxOutputTokens:8192,responseMimeType:'application/json',thinkingConfig:{thinkingLevel:'MEDIUM'}});
    try {
        const model=new GoogleGenerativeAI('fixture').getGenerativeModel({model:'gemini-3.7-flash',generationConfig:config},{baseUrl:fixture.baseUrl});
        await model.generateContent('fixture');
        const ai=createGeminiClient('fixture');
        const result=await generateWithProjectBudget(ai,{model:'gemini-3.7-flash',contents:'fixture',config:{...config,httpOptions:{baseUrl:fixture.baseUrl}}},1000);
        assert.equal(result.text,'{"ok":true}');
        assert.deepEqual(bodies[0].contents,bodies[1].contents);
        assert.deepEqual(bodies[0].generationConfig,bodies[1].generationConfig);
        assert.equal(routes[0],'/v1beta/models/gemini-3.7-flash:generateContent');
        assert.equal(routes[1],'/v1beta/models/gemini-3.8-flash:generateContent');
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
    assert.equal(request.model,'gemini-3.8-flash');
    assert.equal(Object.hasOwn(request.config,'temperature'),false);
    assert.equal(request.config.maxOutputTokens,4096);
    assert.equal(request.config.thinkingConfig,undefined);
    assert.equal(request.contents[0].parts[1].fileData.fileUri,'fixture-file');
    assert.equal(await leases(),0);
});

test('evaluation entrypoints keep model and thinking settings while omitting unsupported sampling', async () => {
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
        for (const model of [undefined, 'gemini-2.5-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.6-flash',
            'gemini-3.7-flash', 'models/gemini-3.7-flash', 'gemini-3.8-flash', 'models/gemini-3.8-flash', 'gemini-3.8-flash-001']) {
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
                const effectiveModel = model === undefined || model === 'gemini-3.7-flash' || model === 'models/gemini-3.7-flash'
                    ? 'gemini-3.8-flash' : model;
                const unsupported = /^models\/gemini-3\.8-flash(?:-[0-9]{3})?$|^gemini-3\.8-flash(?:-[0-9]{3})?$/.test(effectiveModel)
                    && thinking.toUpperCase() === 'MINIMAL';
                if (unsupported) {
                    await assert.rejects(task, error => error.code === 1);
                    assert.equal(fs.readFileSync(wire, 'utf8'), '');
                    assert.equal(fs.existsSync(output), false);
                    continue;
                }
                await task;
                const requests = fs.readFileSync(wire, 'utf8').trim().split('\n').map(line => JSON.parse(line));
                assert.equal(requests.length, 1);
                assert.equal(requests[0].path, `/v1beta/models/${effectiveModel.replace(/^models\//, '')}:generateContent`);
                assert.equal(requests[0].method, 'POST');
                assert.deepEqual(requests[0].body.contents, [{ role: 'user', parts: [{ text: 'synthetic evaluation prompt' }] }]);
                assert.deepEqual(requests[0].body.generationConfig, {
                    ...(['gemini-2.5-flash', 'gemini-3.5-flash'].includes(model) ? { temperature: 0.1 } : {}),
                    maxOutputTokens: 4096,
                    thinkingConfig: { thinkingLevel: script.includes('gemini_api_request') ? thinking.toUpperCase() : thinking },
                });
                assert.equal(fs.readFileSync(output, 'utf8'), '{"ok":true}');
            }
        }
    }
});

test('pipeline connectivity probe preserves request caps, funded priority and once-only uncertain receipts', async t => {
    const probe = fileURLToPath(new URL('../../bin/probe_gemini_pipeline.mjs', import.meta.url));
    const fixture = path.join(directory, 'pipeline-probe');
    fs.mkdirSync(fixture);
    const preload = path.join(fixture, 'transport.mjs');
    fs.writeFileSync(preload, `import fs from 'node:fs';
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.hostname !== 'generativelanguage.googleapis.com') throw new Error('UNEXPECTED_FIXTURE_HOST');
  const value = request.headers.get('x-goog-api-key');
  const keySource = value === 'synthetic-funded-key' ? 'funded'
    : value === 'synthetic-generic-key' ? 'generic' : value === 'synthetic-legacy-key' ? 'legacy' : 'unexpected';
  fs.appendFileSync(process.env.FX_PROBE_WIRE, JSON.stringify({ path: url.pathname, method: request.method,
    body: await request.json(), keySource }) + '\\n');
  if (process.env.FX_PROBE_MODE === 'crash') process.exit(86);
  if (process.env.FX_PROBE_MODE === 'lost_ack') throw new TypeError('synthetic response unavailable');
  if (process.env.FX_PROBE_MODE === 'hold') await new Promise(resolve => setTimeout(resolve, 800));
  if (process.env.FX_PROBE_MODE === '403') return Response.json({error:{code:403,message:'synthetic denial',status:'PERMISSION_DENIED'}},{status:403});
  return Response.json({ ...${JSON.stringify(responseBody)}, ...(process.env.FX_PROBE_RESPONSE_MODEL === undefined ? {} : {modelVersion:process.env.FX_PROBE_RESPONSE_MODEL}) });
};\n`);
    const setup = (name, source, mode = 'ok', responseModel) => {
        const credentials = path.join(fixture, `${name}.env`);
        const output = path.join(fixture, `${name}.json`);
        const wire = path.join(fixture, `${name}.wire`);
        fs.writeFileSync(credentials, source, { mode: 0o600 });
        fs.writeFileSync(wire, '');
        const env = { PATH: process.env.PATH, RUN_DAILY_PYTHON: process.env.RUN_DAILY_PYTHON || 'python3',
            GEMINI_BUDGET_PATH: path.join(fixture, `${name}.sqlite`), GEMINI_BUDGET_PROJECT: 'offline-probe-fixture',
            GEMINI_REQUESTS_PER_MINUTE: '37', GEMINI_MAX_INFLIGHT: '1', FX_PROBE_WIRE: wire, FX_PROBE_MODE: mode,
            ...(responseModel === undefined ? {} : { FX_PROBE_RESPONSE_MODEL: responseModel }) };
        const invoke = () => execute(process.execPath, ['--import', preload, probe, '--output', output, '--credential-env', credentials], { env });
        const requests = () => fs.readFileSync(wire, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
        return { output, wire, invoke, requests };
    };
    const allKeys = 'GEMINI_CREDITS_API_KEY=synthetic-funded-key\nGEMINI_API_KEY=synthetic-generic-key\nGEMINI_API_KEY_BYEON=synthetic-legacy-key\n';
    const assertRequest = (request, keySource) => {
        assert.equal(request.keySource, keySource);
        assert.equal(request.path, '/v1beta/models/gemini-3.8-flash:generateContent');
        assert.equal(request.method, 'POST');
        assert.deepEqual(request.body.generationConfig, { maxOutputTokens: 4096, thinkingConfig: { thinkingLevel: 'MEDIUM' } });
        for (const name of ['temperature', 'topP', 'topK', 'top_p', 'top_k']) assert.equal(Object.hasOwn(request.body.generationConfig, name), false);
    };
    await t.test('funded key is authoritative and request/CLI/receipt caps are retained', async () => {
        const fx = setup('funded', allKeys);
        const { stdout } = await fx.invoke();
        assert.equal(fx.requests().length, 1); assertRequest(fx.requests()[0], 'funded');
        const report = JSON.parse(fs.readFileSync(fx.output, 'utf8'));
        assert.equal(report.model, 'gemini-3.8-flash');
        assert.equal(report.credentialSource, 'GEMINI_CREDITS_API_KEY');
        assert.deepEqual(report.config, { maxOutputTokens: 4096, thinkingConfig: { thinkingLevel: 'MEDIUM' } });
        assert.deepEqual(report.configuredBudget, { projectScope: 'offline-probe-fixture', requestsPerMinute: 37, concurrency: 1 });
        assert.equal(report.configuredMaxAttempts, 1); assert.equal(report.apiCallsStarted, 1);
        assert.equal(report.status, 'ok'); assert.equal(report.resultUnconfirmed, false);
        assert.equal(report.responseModelVersion, null); assert.equal(report.responseModelProvenance, 'not_reported');
        assert.deepEqual(report.usage, { promptTokenCount: 3, candidatesTokenCount: 5, totalTokenCount: 8 });
        assert.equal(report.moneySpent, null);
        assert.deepEqual(Object.keys(JSON.parse(stdout)).sort(), ['apiCallsStarted', 'elapsedMs', 'status', 'usage']);
        assert.equal(fs.statSync(fx.output).mode & 0o777, 0o600);
        const saved = fs.readFileSync(fx.output, 'utf8');
        await assert.rejects(fx.invoke(), error => error.code === 1 && error.stderr.includes('GEMINI_PROBE_FAILED'));
        assert.equal(fx.requests().length, 1); assert.equal(fs.readFileSync(fx.output, 'utf8'), saved);
        for (const secret of ['synthetic-funded-key', 'synthetic-generic-key', 'synthetic-legacy-key']) {
            assert.equal(saved.includes(secret), false); assert.equal(stdout.includes(secret), false);
        }
    });
    await t.test('SDK model provenance preserves a returned revision and rejects unknown metadata', async () => {
        for (const [name, returned, expected, provenance] of [
            ['reported-base', 'gemini-3.8-flash', 'gemini-3.8-flash', 'sdk_reported_supported_id'],
            ['reported-revision', 'models/gemini-3.8-flash-001', 'gemini-3.8-flash-001', 'sdk_reported_supported_id'],
            ['reported-other-family', 'gemini-3.7-flash', null, 'unrecognized'],
            ['reported-unsafe', 'provider diagnostic synthetic-funded-key', null, 'unrecognized'],
        ]) {
            const fx = setup(name, allKeys, 'ok', returned);
            await fx.invoke(); assert.equal(fx.requests().length, 1);
            const raw = fs.readFileSync(fx.output, 'utf8');
            const report = JSON.parse(raw);
            assert.equal(report.model, 'gemini-3.8-flash'); assert.equal(report.status, 'ok');
            assert.equal(report.responseModelVersion, expected); assert.equal(report.responseModelProvenance, provenance);
            assert.equal(raw.includes('provider diagnostic'), false); assert.equal(raw.includes('synthetic-funded-key'), false);
        }
    });
    await t.test('blank funded key retains the explicit generic credential fallback', async () => {
        const fx = setup('generic', 'GEMINI_CREDITS_API_KEY=" "\nGEMINI_API_KEY=synthetic-generic-key\nGEMINI_API_KEY_BYEON=synthetic-legacy-key\n');
        await fx.invoke(); assert.equal(fx.requests().length, 1); assertRequest(fx.requests()[0], 'generic');
        assert.equal(JSON.parse(fs.readFileSync(fx.output, 'utf8')).credentialSource, 'GEMINI_API_KEY');
    });
    await t.test('blank generic credential retains the legacy alias fallback', async () => {
        const fx = setup('legacy', 'GEMINI_API_KEY=" "\nGEMINI_API_KEY_BYEON=synthetic-legacy-key\n');
        await fx.invoke(); assert.equal(fx.requests().length, 1); assertRequest(fx.requests()[0], 'legacy');
    });
    await t.test('missing credential starts no SDK request and creates no misleading receipt', async () => {
        const fx = setup('missing', 'GEMINI_CREDITS_API_KEY=" "\nGEMINI_API_KEY=" "\n');
        await assert.rejects(fx.invoke(), error => error.code === 1);
        assert.deepEqual(fx.requests(), []); assert.equal(fs.existsSync(fx.output), false);
    });
    await t.test('funded authentication error does not rotate to another key or retry', async () => {
        const fx = setup('denied', allKeys, '403');
        await assert.rejects(fx.invoke(), error => error.code === 1);
        assert.equal(fx.requests().length, 1); assertRequest(fx.requests()[0], 'funded');
        const report = JSON.parse(fs.readFileSync(fx.output, 'utf8'));
        assert.equal(report.status, 'auth_failed'); assert.equal(report.httpStatus, 403);
        assert.equal(report.apiCallsStarted, 1); assert.equal(report.credentialSource, 'GEMINI_CREDITS_API_KEY');
    });
    await t.test('lost response remains uncertain and the same output cannot resend', async () => {
        const fx = setup('lost', allKeys, 'lost_ack');
        await assert.rejects(fx.invoke(), error => error.code === 1);
        const report = JSON.parse(fs.readFileSync(fx.output, 'utf8'));
        assert.equal(fx.requests().length, 1); assert.equal(report.apiCallsStarted, 1);
        assert.equal(report.status, 'api_unavailable'); assert.equal(report.resultUnconfirmed, true);
        await assert.rejects(fx.invoke(), error => error.code === 1); assert.equal(fx.requests().length, 1);
    });
    await t.test('process interruption leaves a running once-only receipt before request dispatch', async () => {
        const fx = setup('crash', allKeys, 'crash');
        await assert.rejects(fx.invoke(), error => error.code === 86);
        const report = JSON.parse(fs.readFileSync(fx.output, 'utf8'));
        assert.equal(report.status, 'running'); assert.equal(report.resultUnconfirmed, true);
        assert.equal(report.apiCallsStarted, 1); assert.equal(fx.requests().length, 1);
        await assert.rejects(fx.invoke(), error => error.code === 1); assert.equal(fx.requests().length, 1);
    });
    await t.test('overlapping CLI runs sharing an output admit only one request', async () => {
        const fx = setup('overlap', allKeys, 'hold');
        const first = fx.invoke().then(value => ({ value }), error => ({ error }));
        for (let index = 0; index < 100 && fx.requests().length === 0; index++) await pause(20);
        assert.equal(fx.requests().length, 1);
        assert.equal(JSON.parse(fs.readFileSync(fx.output, 'utf8')).status, 'running');
        await assert.rejects(fx.invoke(), error => error.code === 1);
        const completed = await first;
        if (completed.error) throw completed.error;
        assert.equal(fx.requests().length, 1); assert.equal(JSON.parse(fs.readFileSync(fx.output, 'utf8')).status, 'ok');
    });
});

test('shared sampling policy removes only unsupported fields and never mutates caller config', async () => {
    const original = { temperature: 0.2, topP: 0.8, topK: 30, top_p: 0.9, top_k: 20,
        maxOutputTokens: 8192, responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'HIGH' } };
    const before = structuredClone(original);
    for (const model of ['gemini-3.5-flash-lite', 'models/gemini-3.5-flash-lite-001', 'gemini-3.6-flash',
        'gemini-3.7-flash', 'models/gemini-3.7-flash-001', 'gemini-3.8-flash', 'gemini-3.10-flash', 'gemini-4.0-flash']) {
        const config = omitUnsupportedGeminiSampling(model, original);
        assert.deepEqual(config, { maxOutputTokens: 8192, responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'HIGH' } });
        let wire;
        await generateWithProjectBudget({ models: { generateContent: async value => { wire = value; return { text: 'fixture' }; } } }, { model, contents: 'fixture', config: original });
        assert.equal(wire.model, model === 'gemini-3.7-flash' ? 'gemini-3.8-flash' : model);
        for (const name of ['temperature', 'topP', 'topK', 'top_p', 'top_k']) assert.equal(Object.hasOwn(wire.config, name), false);
        assert.equal(wire.config.maxOutputTokens, 8192); assert.deepEqual(wire.config.thinkingConfig, { thinkingLevel: 'HIGH' });
    }
    for (const model of ['gemini-2.0-flash', 'models/gemini-2.5-flash', 'gemini-3-flash-preview',
        'gemini-3.1-pro-preview', 'gemini-3.5-flash', 'gemini-30-flash', 'custom-model']) {
        assert.deepEqual(omitUnsupportedGeminiSampling(model, original), original);
    }
    assert.deepEqual(original, before);
    assert.deepEqual(omitUnsupportedGeminiSampling('gemini-3.7-flash'), {});
    assert.equal(await leases(), 0);
});

test('shared client rejects minimal thinking on effective 3.8 before quota admission', async () => {
    let calls=0;
    const ai={models:{generateContent:async()=>{calls++;return {text:'must-not-run'};}}};
    for (const model of ['gemini-3.8-flash','models/gemini-3.8-flash','gemini-3.8-flash-001',
        'gemini-3.7-flash','models/gemini-3.7-flash']) {
        await assert.rejects(generateWithProjectBudget(ai,{model,contents:'fixture',config:{thinkingConfig:{thinkingLevel:'minimal'}}}),
            {code:'GEMINI_THINKING_LEVEL_UNSUPPORTED'});
    }
    assert.equal(calls,0);
    assert.equal(await leases(),0);

    let request;
    await generateWithProjectBudget({models:{generateContent:async value=>{request=value;return {text:'ok'};}}},
        {model:'gemini-2.5-flash',contents:'fixture',config:{thinkingConfig:{thinkingLevel:'MINIMAL'}}});
    assert.equal(request.model,'gemini-2.5-flash');
    assert.deepEqual(request.config.thinkingConfig,{thinkingLevel:'MINIMAL'});
    assert.equal(await leases(),0);
});

test('crawler and final merge entrypoints retain older explicit sampling and modern request caps', async () => {
    const local = path.join(directory, 'crawler-sampling');fs.mkdirSync(local);
    const prompt = path.join(local, 'prompt.txt'), chunks = path.join(local, 'chunks.json'), output = path.join(local, 'output.txt'), transcript = path.join(local, 'transcript.jsonl');
    const preload = path.join(local, 'transport.mjs'), wire = path.join(local, 'wire.jsonl');
    fs.writeFileSync(prompt, 'synthetic prompt {CHUNK_JSON_DATA} {FULL_TRANSCRIPT}');
    fs.writeFileSync(chunks, '{"synthetic":true}');
    fs.writeFileSync(transcript, '{"transcript":[{"start":1,"text":"synthetic transcript"}]}\n');
    fs.writeFileSync(preload, `import fs from 'node:fs';
globalThis.fetch = async (input, init) => {
 const request = new Request(input, init);const url = new URL(request.url);
 if (url.hostname !== 'generativelanguage.googleapis.com') throw new Error('UNEXPECTED_FIXTURE_HOST');
 fs.appendFileSync(process.env.FX_CRAWLER_WIRE,JSON.stringify({path:url.pathname,body:await request.json()})+'\\n');
 return Response.json(${JSON.stringify(responseBody)});
};\n`);
    for (const kind of ['crawl', 'merge']) {
        let expectedContents;
        const script = fileURLToPath(new URL(kind === 'crawl' ? '../../restaurant-crawling/scripts/gemini_api_request.mjs' : '../../restaurant-crawling/scripts/final_merge_chunk.mjs', import.meta.url));
        for (const model of [undefined, 'gemini-2.5-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.6-flash',
            'gemini-3.7-flash', 'models/gemini-3.7-flash', 'gemini-3.8-flash']) {
            fs.writeFileSync(wire, '');fs.rmSync(output,{force:true});
            const env={PATH:process.env.PATH,GEMINI_API_KEY:'synthetic-crawler-key',FX_CRAWLER_WIRE:wire,
                GEMINI_BUDGET_PATH:path.join(local,'budget.sqlite'),GEMINI_BUDGET_PROJECT:'offline-crawler-fixture',
                GEMINI_REQUESTS_PER_MINUTE:'100000',GEMINI_MAX_INFLIGHT:'1',...(model?{CURRENT_MODEL:model}:{})};
            await execute(process.execPath,['--import',preload,script,...(kind==='crawl'?[prompt,output]:[prompt,output,chunks,transcript])],{env});
            const requests=fs.readFileSync(wire,'utf8').trim().split('\n').map(line=>JSON.parse(line));assert.equal(requests.length,1);
            expectedContents ??= requests[0].body.contents;assert.deepEqual(requests[0].body.contents,expectedContents);
            const effectiveModel=!model||model==='gemini-3.7-flash'||model==='models/gemini-3.7-flash'?'gemini-3.8-flash':model;
            assert.equal(requests[0].path,`/v1beta/models/${effectiveModel.replace(/^models\//,'')}:generateContent`);
            assert.deepEqual(requests[0].body.generationConfig,{
                ...(['gemini-2.5-flash','gemini-3.5-flash'].includes(model)?{temperature:kind==='crawl'?0.2:0.1}:{}),
                maxOutputTokens:kind==='crawl'?4096:8192,...(kind==='merge'?{responseMimeType:'application/json'}:{}),
                thinkingConfig:{thinkingLevel:kind==='crawl'?'LOW':'MEDIUM'},
            });
            assert.equal(fs.readFileSync(output,'utf8'),'{"ok":true}');
        }
    }
});
