import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

// Keep service-role/auth mocks out of the shared Bun module registry.
const worker = String.raw`
import { mock } from 'bun:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

let authStatus = 200;
let serviceCreations = 0;
let legacyProjection = false;
let failureTable = '';
let throwRead = false;
const queries = [];
const ids = Array.from({ length: 10 }, (_, index) => '10000000-0000-4000-8000-' + String(index + 1).padStart(12, '0'));
const restaurantRows = ids.map((id, index) => ({
  id, approved_name: '합성 맛집 ' + (index + 1), categories: ['한식'],
  road_address: '합성 주소', jibun_address: null, lat: 37.5 + index * 0.001,
  lng: 127 + index * 0.001, youtube_meta: { videoId: 'fixture' },
  source_type: 'youtube', status: 'approved', is_missing: false, is_not_selected: false,
}));
const proposalRows = [0, 1].map(index => ({
  id: '20000000-0000-4000-8000-' + String(2 - index).padStart(12, '0'),
  restaurant_id: ids[0], run_id: '30000000-0000-4000-8000-000000000001',
  overlay_type: 'trend', proposal_status: 'pending', label: '합성 제안',
  score: 1, score_breakdown: {}, evidence: {}, proposal_hash: 'a'.repeat(64),
  created_at: '2026-10-22T01:00:00.000Z', updated_at: '2026-10-22T01:00:00.000Z',
  restaurants: { id: ids[0], approved_name: restaurantRows[0].approved_name, lat: 37.5, lng: 127, status: 'approved' },
}));
const overlayRows = [{ restaurant_id: ids[0], overlay_type: 'trend', label: '합성 활성 표시', is_active: true, updated_at: '2026-10-22T01:00:00.000Z' }];
let results = {
  restaurants: restaurantRows,
  admin_restaurant_map_overlay_proposals: proposalRows,
  admin_restaurant_map_overlays: overlayRows,
};
const bareName = /(?:^|[,(])\s*name\s*(?=[,)]|$)/;
assert(bareName.test('id,name'));
assert(bareName.test('id,name:approved_name,name'));
assert(!bareName.test('id,name:approved_name'));
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
        select(fields) { query.fields = fields; return builder; },
        eq(column, value) { query.filters.push([column, value]); return builder; },
        in(column, values) { query.filters.push([column, values]); return builder; },
        order(column, options) { query.orders.push([column, options]); return builder; },
        or(value) { query.cursor = value; return builder; },
        limit(value) { query.limit = value; return builder; },
        overrideTypes() { return builder; },
        then(resolve) {
          const selected = legacyProjection ? query.fields.replaceAll('name:approved_name', 'name') : query.fields;
          if (bareName.test(selected) || failureTable === table) {
            if (throwRead) throw new Error('private-query-diagnostic');
            return Promise.resolve({ data: null, error: { code: '42703', message: 'private-query-diagnostic' } }).then(resolve);
          }
          let rows = results[table].filter(row => query.filters.every(([column, value]) => Array.isArray(value) ? value.includes(row[column]) : row[column] === value));
          for (const [column, options] of [...query.orders].reverse()) {
            rows.sort((a, b) => String(a[column]).localeCompare(String(b[column])) * (options.ascending ? 1 : -1));
          }
          if (query.cursor) {
            const boundary = query.cursor.match(/^created_at\.lt\.([^,]+),and\(created_at\.eq\.[^,]+,id\.lt\.([^\)]+)\)$/);
            assert(boundary);
            rows = rows.filter(row => row.created_at < boundary[1] || (row.created_at === boundary[1] && row.id < boundary[2]));
          }
          return Promise.resolve({ data: rows.slice(0, query.limit), error: null }).then(resolve);
        },
      };
      return builder;
    } };
  },
}));
const { GET: candidatesGET } = await import('./app/api/admin/routes/candidates/route.ts');
const { GET: proposalsGET } = await import('./app/api/admin/trend-proposals/route.ts');
const request = (path, query = '') => new NextRequest('http://fixture.test/api/admin/' + path + query);
const endpoints = [
  { get: candidatesGET, path: 'routes/candidates', error: 'admin_route_candidates_failed' },
  { get: proposalsGET, path: 'trend-proposals', error: 'trend_proposal_list_failed' },
];
const assertNoStore = response => assert.equal(response.headers.get('cache-control'), 'no-store');
let checks = 0;
for (const endpoint of endpoints) {
  for (const status of [401, 403]) {
    authStatus = status;
    const response = await endpoint.get(request(endpoint.path));
    assert.equal(response.status, status);
    assertNoStore(response);
    assert.equal(serviceCreations, 0);
    assert.equal(queries.length, 0);
    checks++;
  }
}
authStatus = 200;
for (const endpoint of endpoints) {
  legacyProjection = true;
  const response = await endpoint.get(request(endpoint.path));
  assert.equal(response.status, 502);
  assertNoStore(response);
  assert.deepEqual(await response.json(), { ok: false, error: endpoint.error });
  checks++;
}
legacyProjection = false;
queries.length = 0;
let response = await candidatesGET(request('routes/candidates', '?limit=500&anchorRestaurantId=' + ids[9] + '&bbox=126,37,128,38'));
assert.equal(response.status, 200);
assertNoStore(response);
let body = await response.json();
assert.equal(body.items.length, 7);
assert(body.items.some(item => item.id === ids[9]));
assert(body.items.every(item => item.name.startsWith('합성 맛집 ')));
assert.equal(body.candidateReadback.candidateLimit, 7);
assert.equal(queries[0].limit, 500);
assert.deepEqual(queries[0].filters, [['status', 'approved'], ['is_missing', false], ['is_not_selected', false]]);
assert(queries[0].fields.includes('name:approved_name'));
assert(!bareName.test(queries[0].fields));
checks++;

queries.length = 0;
response = await proposalsGET(request('trend-proposals', '?limit=1&overlayType=trend&restaurantId=' + ids[0]));
assert.equal(response.status, 200);
assertNoStore(response);
body = await response.json();
assert.equal(body.items.length, 1);
assert.equal(body.items[0].restaurant.name, restaurantRows[0].approved_name);
assert.equal(body.items[0].conflict.hasActiveOverlay, true);
assert.equal(body.pageInfo.hasMore, true);
assert.equal(typeof body.pageInfo.nextCursor, 'string');
assert.equal(queries[0].limit, 2);
assert.deepEqual(queries[0].filters, [['proposal_status', 'pending'], ['overlay_type', 'trend'], ['restaurant_id', ids[0]]]);
assert.deepEqual(queries[0].orders, [['created_at', { ascending: false }], ['id', { ascending: false }]]);
assert(queries[0].fields.includes('restaurants(id, name:approved_name,'));
assert(!bareName.test(queries[0].fields));
assert(!queries[0].fields.includes('!inner'));
assert.deepEqual(queries[1].filters, [['restaurant_id', [ids[0]]], ['overlay_type', ['trend']], ['is_active', true]]);
checks++;

const cursor = body.pageInfo.nextCursor;
queries.length = 0;
results.admin_restaurant_map_overlay_proposals = [{ ...proposalRows[1], restaurants: null }];
results.admin_restaurant_map_overlays = [];
assert(proposalRows[1].id < proposalRows[0].id);
response = await proposalsGET(request('trend-proposals', '?limit=1&cursor=' + encodeURIComponent(cursor)));
body = await response.json();
assert.equal(response.status, 200);
assert.equal(body.items[0].restaurant.name, '이름 확인 필요');
assert.equal(body.items[0].conflict.hasActiveOverlay, false);
assert.equal(body.pageInfo.hasMore, false);
assert.equal(body.pageInfo.nextCursor, null);
assert.equal(queries[0].cursor, 'created_at.lt.' + proposalRows[0].created_at + ',and(created_at.eq.' + proposalRows[0].created_at + ',id.lt.' + proposalRows[0].id + ')');
checks++;

for (const [get, path, query] of [
  [candidatesGET, 'routes/candidates', '?bbox=0,0,0,0'],
  [candidatesGET, 'routes/candidates', '?anchorRestaurantId=bad'],
  [proposalsGET, 'trend-proposals', '?cursor=bad'],
]) {
  const before = serviceCreations;
  response = await get(request(path, query));
  assert.equal(response.status, 400);
  assertNoStore(response);
  assert.equal(serviceCreations, before);
  checks++;
}
for (const endpoint of endpoints) {
  queries.length = 0;
  results = { restaurants: [], admin_restaurant_map_overlay_proposals: [], admin_restaurant_map_overlays: [] };
  response = await endpoint.get(request(endpoint.path));
  assert.equal(response.status, 200);
  assertNoStore(response);
  assert.deepEqual((await response.json()).items, []);
  assert.equal(queries.length, 1);
  checks++;
}
results = { restaurants: restaurantRows, admin_restaurant_map_overlay_proposals: proposalRows, admin_restaurant_map_overlays: overlayRows };
for (const [get, path, table, error] of [
  [candidatesGET, 'routes/candidates', 'restaurants', 'admin_route_candidates_failed'],
  [proposalsGET, 'trend-proposals', 'admin_restaurant_map_overlay_proposals', 'trend_proposal_list_failed'],
  [proposalsGET, 'trend-proposals', 'admin_restaurant_map_overlays', 'trend_proposal_list_failed'],
]) {
  failureTable = table;
  for (const throws of [false, true]) {
    throwRead = throws;
    response = await get(request(path));
    assert.equal(response.status, 502);
    assertNoStore(response);
    assert.deepEqual(await response.json(), { ok: false, error });
    checks++;
  }
}
console.log(JSON.stringify({ checks, hostedReads: 0 }));
`;

test('admin candidate and trend GETs read the physical schema while preserving their guarded query contracts', () => {
  const result = Bun.spawnSync([process.execPath, '--eval', worker], {
    cwd: resolve(import.meta.dir, '..'), env: process.env, stdout: 'pipe', stderr: 'pipe',
  });
  expect(new TextDecoder().decode(result.stderr)).toBe('');
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(new TextDecoder().decode(result.stdout))).toEqual({ checks: 20, hostedReads: 0 });
});
