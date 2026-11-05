import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

// Keep auth/service mocks in a child process, isolated from the general suite.
const worker = String.raw`
import { mock } from 'bun:test';
import assert from 'node:assert/strict';

let authStatus = 200;
let serviceCreations = 0;
let parentResult = { data: [], error: null };
let itemResult = { data: [], error: null };
const queries = [];
const parent = { id: 'submission-a', status: 'pending' };
const item = { id: 'item-a', submission_id: parent.id };

mock.module('@/lib/auth/require-admin', () => ({
  requireAdmin: async () => authStatus === 200
    ? { ok: true, userId: 'admin-fixture' }
    : { ok: false, response: Response.json({ error: 'Denied' }, { status: authStatus }) },
}));
mock.module('@/lib/supabase/service-role', () => ({
  createSupabaseServiceRoleClient: () => {
    serviceCreations++;
    return { from(table) {
      const query = { table, filters: [], orders: [] };
      queries.push(query);
      const builder = {
        select(fields) { query.fields = fields.split(',').map(field => field.trim()); return builder; },
        in(column, values) { query.filters.push([column, values]); return builder; },
        order(column, options) { query.orders.push([column, options]); return builder; },
        overrideTypes() { return builder; },
        then(resolve) {
          const result = table === 'restaurant_submissions' ? parentResult : itemResult;
          if (result instanceof Error) throw result;
          return Promise.resolve(result).then(resolve);
        },
      };
      return builder;
    } };
  },
}));
const { GET } = await import('./app/api/admin/submissions/route.ts');
const assertPrivate = response => assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0');
let checks = 0;
for (const status of [401, 403]) {
  authStatus = status;
  const response = await GET();
  assert.equal(response.status, status);
  assertPrivate(response);
  assert.equal(serviceCreations, 0);
  assert.deepEqual(queries, []);
  checks++;
}
authStatus = 200;
let response = await GET();
assert.equal(response.status, 200);
assertPrivate(response);
assert.deepEqual(await response.json(), { submissions: [], items: [] });
assert.deepEqual(queries.map(query => query.table), ['restaurant_submissions']);
checks++;

queries.length = 0;
parentResult = { data: [parent, { id: 'submission-b', status: 'partially_approved' }], error: null };
itemResult = { data: [item], error: null };
response = await GET();
assert.equal(response.status, 200);
assertPrivate(response);
assert.deepEqual(await response.json(), { submissions: parentResult.data, items: [item] });
assert.deepEqual(queries.map(query => query.table), ['restaurant_submissions', 'restaurant_submission_items']);
assert.deepEqual(queries[0].filters, [['status', ['pending', 'partially_approved']]]);
assert.deepEqual(queries[0].orders, [['created_at', { ascending: false }]]);
assert.deepEqual(queries[1].filters, [['submission_id', ['submission-a', 'submission-b']]]);
assert.deepEqual(queries[1].orders, [['created_at', { ascending: true }]]);
assert.deepEqual(queries[1].fields, ['id', 'submission_id', 'youtube_link', 'tzuyang_review', 'target_restaurant_id', 'item_status', 'rejection_reason', 'created_at']);
assert(!queries[0].fields.includes('*'));
checks++;

for (const failedRead of ['parent', 'items']) {
  for (const failure of [
    { data: null, error: { message: 'private-provider-diagnostic' } },
    { data: null, error: null },
    new Error('private-provider-diagnostic'),
  ]) {
    queries.length = 0;
    parentResult = failedRead === 'parent' ? failure : { data: [parent], error: null };
    itemResult = failedRead === 'items' ? failure : { data: [item], error: null };
    response = await GET();
    assert.equal(response.status, 500);
    assertPrivate(response);
    assert.deepEqual(await response.json(), { code: 'submission_read_failed' });
    assert.equal(queries.length, failedRead === 'parent' ? 1 : 2);
    checks++;
  }
}
parentResult = { data: [parent], error: null };
itemResult = { data: [], error: null };
response = await GET();
assert.equal(response.status, 200);
assert.deepEqual(await response.json(), { submissions: [parent], items: [] });
checks++;
console.log(JSON.stringify({ checks, hostedReads: 0 }));
`;

test('submissions GET gates privileged reads and returns only the selected parents with their items', () => {
  const result = Bun.spawnSync([process.execPath, '--eval', worker], {
    cwd: resolve(import.meta.dir, '..'), env: process.env, stdout: 'pipe', stderr: 'pipe',
  });
  const stderr = new TextDecoder().decode(result.stderr);
  expect(stderr).toBe('');
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(new TextDecoder().decode(result.stdout))).toEqual({ checks: 11, hostedReads: 0 });
});
