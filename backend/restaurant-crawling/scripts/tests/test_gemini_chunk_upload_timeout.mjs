import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { uploadChunkVideo } from '../gemini_chunk_video_request.mjs';
import { createGeminiClient } from '../../../utils/gemini-client.mjs';

const START_URL = 'https://generativelanguage.googleapis.com/upload/v1beta/files';
const BODY_URL = 'https://generativelanguage.googleapis.com/resumable-fixture';
const FILE = { name: 'files/fixture', uri: 'https://files.example.invalid/file', mimeType: 'video/mp4', state: 'ACTIVE' };

function startResponse() {
  return new Response('{}', { status: 200, headers: { 'x-goog-upload-url': BODY_URL, 'content-type': 'application/json' } });
}

function finalResponse() {
  return new Response(JSON.stringify({ file: FILE }), {
    status: 200, headers: { 'x-goog-upload-status': 'final', 'content-type': 'application/json' },
  });
}

function missingRouteResponse() {
  return new Response(JSON.stringify({ error: { code: 404, message: 'fixture route missing', status: 'NOT_FOUND' } }), {
    status: 404, headers: { 'content-type': 'application/json' },
  });
}

function fileFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chunk-upload-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'fixture.mp4');
  const bytes = Buffer.from('fixture-video');
  fs.writeFileSync(file, bytes);
  return { file, bytes };
}

test('pinned SDK chunk upload sends resumable start and literal file bytes with the client timeout', async t => {
  const installed = JSON.parse(fs.readFileSync(new URL('../../../node_modules/@google/genai/package.json', import.meta.url)));
  const lock = JSON.parse(fs.readFileSync(new URL('../../../package-lock.json', import.meta.url)));
  assert.equal(installed.version, '2.24.0');
  assert.equal(installed.version, lock.packages['node_modules/@google/genai'].version);
  const { file, bytes } = fileFixture(t);
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    requests.push({ url, init });
    if (url === START_URL) return startResponse();
    if (url === BODY_URL) return finalResponse();
    return missingRouteResponse();
  });
  const uploaded = await uploadChunkVideo(createGeminiClient('fixture'), file, 'video/mp4', 'fixture-display');
  assert.deepEqual(uploaded, FILE);
  assert.equal(requests.length, 2);
  const [start, body] = requests;
  const startHeaders = new Headers(start.init.headers);
  assert.equal(start.url, START_URL);
  assert.equal(start.init.method, 'POST');
  assert.equal(startHeaders.get('x-goog-upload-protocol'), 'resumable');
  assert.equal(startHeaders.get('x-goog-upload-command'), 'start');
  assert.equal(startHeaders.get('x-goog-upload-header-content-length'), String(bytes.length));
  assert.equal(startHeaders.get('x-goog-upload-header-content-type'), 'video/mp4');
  assert.equal(startHeaders.get('x-server-timeout'), '300');
  assert.equal(JSON.parse(start.init.body).file.displayName, 'fixture-display');
  assert.equal(body.url, BODY_URL);
  assert.equal(body.init.method, 'POST');
  const bodyHeaders = new Headers(body.init.headers);
  assert.equal(bodyHeaders.get('x-goog-upload-command'), 'upload, finalize');
  assert.equal(bodyHeaders.get('x-goog-upload-offset'), '0');
  assert.equal(bodyHeaders.get('x-server-timeout'), '300');
  assert.deepEqual(Buffer.from(await body.init.body.arrayBuffer()), bytes);
});

test('pinned SDK reproduces the legacy per-call timeout route failure without retrying', async t => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    requests.push({ url, init });
    return missingRouteResponse();
  });
  const ai = createGeminiClient('fixture');
  await assert.rejects(ai.files.upload({
    file: new Blob(['fixture-video'], { type: 'video/mp4' }),
    config: { mimeType: 'video/mp4', displayName: 'fixture-display', httpOptions: { timeout: 300000 } },
  }), error => error.status === 404);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://generativelanguage.googleapis.com/v1beta/upload/v1beta/files');
  const headers = new Headers(requests[0].init.headers);
  assert.equal(headers.get('x-goog-upload-protocol'), null);
  assert.equal(headers.get('x-goog-upload-command'), null);
});

for (const stalledPhase of ['start', 'body']) {
  test(`upload ${stalledPhase} deadline retains work until the SDK timeout and transport settlement`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const startDelay = stalledPhase === 'body' ? 1000 : 0;
    let announce;
    const started = new Promise(resolve => { announce = resolve; });
    let release;
    let transportSignal;
    let deadlineSignal;
    let requests = 0;
    t.mock.method(globalThis, 'fetch', (url, init) => {
      requests++;
      assert.ok(url === START_URL || url === BODY_URL);
      if (stalledPhase === 'body' && url === START_URL) {
        t.mock.timers.tick(startDelay);
        return Promise.resolve(startResponse());
      }
      transportSignal = init.signal;
      announce();
      // Aborting is not proof of settlement: hold the transport until released.
      return new Promise((_resolve, reject) => { release = () => reject(new DOMException('fixture abort', 'AbortError')); });
    });
    const ai = createGeminiClient('fixture');
    const actualUpload = ai.files.upload.bind(ai.files);
    t.mock.method(ai.files, 'upload', params => {
      deadlineSignal = params.config.abortSignal;
      return actualUpload(params);
    });
    const upload = uploadChunkVideo(ai, new Blob(['fixture-video'], { type: 'video/mp4' }), 'video/mp4', 'fixture-display');
    let settled = false;
    const observed = upload.then(() => { settled = true; }, error => { settled = true; throw error; });
    const rejected = assert.rejects(observed, { code: 'GEMINI_API_TIMEOUT' });
    await started;
    assert.ok(deadlineSignal instanceof AbortSignal);
    assert.ok(transportSignal instanceof AbortSignal);
    t.mock.timers.tick(299999 - startDelay);
    assert.equal(deadlineSignal.aborted, false);
    assert.equal(transportSignal.aborted, false);
    t.mock.timers.tick(1);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(deadlineSignal.aborted, true);
    // SDK 2.24 does not forward UploadFileConfig.abortSignal. Its per-request
    // timeout starts later for the body; do not claim a hard total-time abort.
    assert.equal(transportSignal.aborted, stalledPhase === 'start');
    assert.equal(settled, false);
    if (startDelay) {
      t.mock.timers.tick(startDelay);
      assert.equal(transportSignal.aborted, true);
      assert.equal(settled, false);
    }
    release();
    await rejected;
    assert.equal(requests, stalledPhase === 'start' ? 1 : 2);
  });
}
