import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CAPABILITY_PATH, isAllowedRequest, isFixtureOrigin, safeFailureCode } from './policy.mjs';

const origin = 'http://127.0.0.1:3215';
const request = (url, method = 'GET', resourceType = 'fetch') => isAllowedRequest({ url, method, resourceType }, origin);

test('only the owned loopback origin is eligible', () => {
  assert.equal(isFixtureOrigin(origin), true);
  for (const value of ['https://tzudong.com', 'http://localhost:3215', 'http://0.0.0.0:3215',
    'http://user@127.0.0.1:3215', `${origin}/fixture`, `${origin}?x=1`, `${origin}/`, 'http://127.0.0.1:0']) {
    assert.equal(isFixtureOrigin(value), false);
  }
});

test('only exact assets and the inert capability GET/HEAD are allowed', () => {
  for (const path of ['/fixture', '/environment.js', '/bundle.js', '/bundle.css', '/images/ui-noise.png', '/favicon.ico', CAPABILITY_PATH]) {
    assert.equal(request(`${origin}${path}`), true);
    assert.equal(request(`${origin}${path}`, 'HEAD'), true);
  }
});

test('external, encoded, redirected-looking, cross-port and arbitrary routes fail closed', () => {
  for (const value of ['https://example.com/bundle.js', 'http://127.0.0.1:3216/bundle.js',
    `${origin}/api/admin/jobs`, `${origin}/fixture?next=https://example.com`, `${origin}/bundle.js#x`,
    `${origin}/%62undle.js`, `${origin}/../bundle.js`, `${origin}//bundle.js`,
    `http://user@127.0.0.1:3215/bundle.js`, 'data:text/plain,fixture', 'file:///tmp/fixture']) {
    assert.equal(request(value), false);
  }
});

test('every mutation method and streaming channel is rejected', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'CONNECT']) {
    assert.equal(request(`${origin}${CAPABILITY_PATH}`, method), false);
  }
  for (const kind of ['websocket', 'eventsource', 'manifest']) assert.equal(request(`${origin}/fixture`, 'GET', kind), false);
});

test('only fixed failure codes can reach the minimized receipt', () => {
  assert.equal(safeFailureCode(new Error('QA_POLICY_DENIED')), 'QA_POLICY_DENIED');
  assert.equal(safeFailureCode(new Error('arbitrary private detail')), 'QA_FAILED');
  assert.equal(safeFailureCode({ message: 'QA_POLICY_DENIED' }), 'QA_FAILED');
});
