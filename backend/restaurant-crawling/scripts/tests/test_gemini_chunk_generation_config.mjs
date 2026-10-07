import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { GoogleGenAI } from '@google/genai';
import { generateChunkContent } from '../gemini_chunk_video_request.mjs';

const execute = promisify(execFile);
const script = fileURLToPath(new URL('../gemini_chunk_video_request.mjs', import.meta.url));
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chunk-config-test-'));
const budget = {
    GEMINI_BUDGET_PATH: path.join(directory, 'budget.sqlite'),
    GEMINI_BUDGET_PROJECT: 'chunk-config-fixture',
    GEMINI_REQUESTS_PER_MINUTE: '100000',
    GEMINI_MAX_INFLIGHT: '1',
};
const saved = Object.fromEntries(Object.keys(budget).map(key => [key, process.env[key]]));
Object.assign(process.env, budget);
test.after(() => {
    for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    fs.rmSync(directory, { recursive: true, force: true });
});
const response = { candidates: [{ content: { role: 'model', parts: [{ text: '{"fixture":true}' }] } }] };
const contents = [{ role: 'user', parts: [
    { text: 'synthetic chunk prompt' },
    { fileData: { fileUri: 'https://generativelanguage.googleapis.com/v1beta/files/fixture', mimeType: 'video/mp4' } },
] }];
const cases = [
    ['gemini-3-flash-preview', undefined],
    ['gemini-3.1-pro-preview', undefined],
    ['gemini-3.7-flash', undefined],
    ['gemini-3.8-flash', undefined],
    ['models/gemini-3.8-flash', undefined],
    ['gemini-2.5-flash', 0.2],
    ['models/gemini-2.0-flash', 0.2],
    ['gemini-30-flash', 0.2],
    ['custom-model', 0.2],
];

test('installed SDK serializes model-specific chunk config without changing content or output limits', async () => {
    for (const [model, temperature] of cases) {
        for (const thinkingLevel of ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH', '']) {
            const requests = [];
            const ai = new GoogleGenAI({ apiKey: 'synthetic-never-sent', httpOptions: {
                fetch: async (input, init) => {
                    const request = new Request(input, init);
                    requests.push({ path: new URL(request.url).pathname, body: await request.json() });
                    return Response.json(response);
                },
            } });
            const result = await generateChunkContent(ai, model, contents[0].parts[0].text,
                { uri: contents[0].parts[1].fileData.fileUri }, 'video/mp4', thinkingLevel);
            assert.equal(result.text, '{"fixture":true}');
            assert.equal(requests.length, 1);
            assert.equal(requests[0].path, `/v1beta/models/${model.replace(/^models\//, '')}:generateContent`);
            assert.deepEqual(requests[0].body.contents, contents);
            assert.deepEqual(requests[0].body.generationConfig, {
                ...(temperature === undefined ? {} : { temperature }),
                maxOutputTokens: 4096,
                ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {}),
            }, `${model} / ${thinkingLevel || 'without thinking'}`);
        }
    }
});

const preload = path.join(directory, 'offline-transport.mjs');
const wire = path.join(directory, 'wire.jsonl');
const prompt = path.join(directory, 'prompt.txt');
const video = path.join(directory, 'video.mp4');
const output = path.join(directory, 'result.txt');
fs.writeFileSync(prompt, contents[0].parts[0].text);
fs.writeFileSync(video, 'synthetic video bytes');
// Intercept every request at the SDK transport, including upload and cleanup.
// Only synthetic request bodies are retained; headers and keys are never written.
fs.writeFileSync(preload, `
import fs from 'node:fs';
import net from 'node:net';
net.Socket.prototype.connect = () => { throw new Error('EXTERNAL_IO_FORBIDDEN'); };
const originalTimeout = globalThis.setTimeout;
globalThis.setTimeout = (callback, delay, ...args) => originalTimeout(callback, [2000, 30000].includes(delay) ? 0 : delay, ...args);
let generations = 0;
const file = { name: 'files/fixture', uri: ${JSON.stringify(contents[0].parts[1].fileData.fileUri)}, mimeType: 'video/mp4', state: 'ACTIVE' };
globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname !== 'generativelanguage.googleapis.com') throw new Error('UNEXPECTED_FIXTURE_HOST');
    if (url.pathname.endsWith(':generateContent')) {
        generations++;
        fs.appendFileSync(process.env.FX_WIRE, JSON.stringify({ path: url.pathname, body: await request.json() }) + '\\n');
        const scenario = process.env.FX_SCENARIO;
        const failed = scenario === 'thinking' ? generations === 1 : scenario !== 'success';
        if (failed) {
            const code = scenario === 'forbidden' ? 403 : scenario === 'quota' ? 429 : 400;
            const message = scenario === 'thinking' ? 'thinkingConfig is not supported' : scenario === 'model' ? 'model is not supported' : 'synthetic provider rejection';
            return Response.json({ error: { code, message } }, { status: code, headers: { 'retry-after': '0' } });
        }
        return Response.json(${JSON.stringify(response)});
    }
    if (url.pathname.endsWith('/upload/v1beta/files')) return Response.json({}, { headers: { 'x-goog-upload-url': 'https://generativelanguage.googleapis.com/fixture-upload' } });
    if (url.pathname === '/fixture-upload') return Response.json({ file }, { headers: { 'x-goog-upload-status': 'final' } });
    if (url.pathname === '/v1beta/files/fixture' && request.method === 'GET') return Response.json(file);
    if (url.pathname === '/v1beta/files/fixture' && request.method === 'DELETE') {
        fs.appendFileSync(process.env.FX_WIRE, JSON.stringify({ cleanup: true }) + '\\n');
        return Response.json({});
    }
    console.error('UNEXPECTED_FIXTURE_REQUEST', request.method, url.pathname);
    throw new Error('UNEXPECTED_FIXTURE_REQUEST');
};
`);

test('chunk CLI keeps sampling through thinking fallback and propagates other provider failures', async () => {
    for (const model of [undefined, 'gemini-3.8-flash', 'models/gemini-3.8-flash', 'gemini-2.5-flash']) {
        for (const scenario of ['success', 'thinking', 'model', 'forbidden', 'quota']) {
            fs.writeFileSync(wire, '');
            fs.rmSync(output, { force: true });
            const child = execute(process.execPath, ['--import', preload, script, prompt, output, video], {
                env: {
                    PATH: process.env.PATH, ...budget,
                    GEMINI_API_KEY: 'synthetic-never-sent',
                    GEMINI_CHUNK_THINKING_LEVEL: 'low',
                    FX_WIRE: wire, FX_SCENARIO: scenario,
                    ...(model ? { CURRENT_MODEL: model } : {}),
                },
                timeout: 15000,
            });
            if (scenario === 'success' || scenario === 'thinking') await child;
            else await assert.rejects(child, error => error.code === (scenario === 'quota' ? 42 : 1));
            const records = fs.readFileSync(wire, 'utf8').trim().split('\n').map(line => JSON.parse(line));
            const requests = records.filter(record => !record.cleanup);
            assert.equal(requests.length, scenario === 'success' ? 1 : 2, `${model} / ${scenario}`);
            assert.equal(records.filter(record => record.cleanup).length, ['success', 'thinking'].includes(scenario) ? 1 : 2);
            for (const [index, request] of requests.entries()) {
                assert.equal(request.path, `/v1beta/models/${(model || 'gemini-3.7-flash').replace(/^models\//, '')}:generateContent`);
                assert.deepEqual(request.body.contents, contents);
                assert.deepEqual(request.body.generationConfig, {
                    ...(model === 'gemini-2.5-flash' ? { temperature: 0.2 } : {}),
                    maxOutputTokens: 4096,
                    ...(scenario === 'thinking' && index === 1 ? {} : { thinkingConfig: { thinkingLevel: 'LOW' } }),
                });
            }
            if (['success', 'thinking'].includes(scenario)) assert.equal(fs.readFileSync(output, 'utf8'), '{"fixture":true}');
            else assert.equal(fs.existsSync(output), false);
        }
    }
});
