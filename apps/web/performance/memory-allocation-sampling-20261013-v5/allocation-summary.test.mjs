import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeAllocationProfile } from './allocation-summary-v1.mjs';
const node = (id, selfSize, url = '', functionName = 'f', children = []) => ({ id, selfSize, callFrame: { url, functionName, lineNumber: 2, columnNumber: 3 }, children });
const profile = head => ({ head, samples: [{ nodeId: head.id, size: head.selfSize }] });
test('native child attribution uses nearest public script and counts bytes once', () => {
  const r = summarizeAllocationProfile(profile(node(1, 10, 'https://localhost:3000/_next/static/chunks/app/home.js?private=secret', 'app', [node(2, 20)])));
  assert.equal(r.estimatedLiveBytes, 30); assert.equal(r.byNearestScriptAncestor['app-chunk'], 30);
  assert.ok(!JSON.stringify(r).includes('private')); assert.ok(!JSON.stringify(r).includes('secret'));
});
test('provider query credentials, nonallowlisted names and URLs are excluded', () => {
  const r = summarizeAllocationProfile(profile(node(1, 10, 'https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=secret', 'private query [user]')));
  assert.equal(r.byNearestScriptAncestor['naver-sdk'], 10); assert.equal(r.topAllocationStacks[0].stack[0].function, 'unnamed');
  assert.ok(!JSON.stringify(r).includes('secret')); assert.ok(!JSON.stringify(r).includes('[user]'));
});
test('unknown-script group prevents incorrectly inheriting app allocations', () => {
  const r = summarizeAllocationProfile(profile(node(1, 1, 'https://localhost/_next/static/chunks/a.js', 'app', [node(2, 100, 'https://external.test/private?token=x')])));
  assert.equal(r.byNearestScriptAncestor['other-script'], 100); assert.ok(!JSON.stringify(r).includes('external.test'));
});
test('cyclic or duplicate profile nodes reject rather than hang or double count', () => {
  const n = node(1, 1); n.children.push(n); assert.throws(() => summarizeAllocationProfile(profile(n)), /PROFILE_NODE/);
});
test('invalid allocation or unknown sample rejects', () => {
  assert.throws(() => summarizeAllocationProfile(profile(node(1, -1))), /PROFILE_NODE/);
  assert.throws(() => summarizeAllocationProfile({ head: node(1, 1), samples: [{ nodeId: 2, size: 1 }] }), /PROFILE_SAMPLE/);
});
