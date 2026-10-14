import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { buildReviewCandidateCriteria, buildReviewCandidateUnionFilter, readRestaurantReviewCandidates, RESTAURANT_REVIEW_CANDIDATE_SELECT } from '/Users/twoimo/.codex/worktrees/mobile-nav-read-20261012/tzudong/apps/web/lib/restaurant-review-candidate-reader.ts';
const here = new URL('./', import.meta.url);
const sourceRoot = '/Users/twoimo/.codex/worktrees/mobile-nav-read-20261012/tzudong/apps/web';
const require = createRequire(sourceRoot + '/package.json');
const { createClient } = require('@supabase/supabase-js');
const env = require('dotenv').parse(readFileSync('/Users/twoimo/Documents/projects/tzudong/apps/web/.env.local'));
assert.equal(new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname, 'aqlcofblfxdrjhhdmarw.supabase.co');
assert.ok(env.NEXT_PUBLIC_SUPABASE_ANON_KEY.startsWith('sb_publishable_'));
assert.equal(process.versions.node, '24.21.0');
const bytes = readFileSync(new URL('live-database-plan-v1.json', here));
const plan = JSON.parse(bytes);
let requests = 0;
const statuses = {};
const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: async (url, options) => {
    assert.equal(options?.method ?? 'GET', 'GET');
    assert.ok(++requests <= plan.maxRequests, 'READ_BUDGET_EXCEEDED');
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
    statuses[String(response.status)] = (statuses[String(response.status)] ?? 0) + 1;
    return response;
  } },
});
const receipt = { startedAtUTC: new Date().toISOString(), planSha256: createHash('sha256').update(bytes).digest('hex'),
  sourceSha256: createHash('sha256').update(readFileSync(sourceRoot + '/lib/restaurant-review-candidate-reader.ts')).digest('hex'),
  credentialKind: 'publishable', role: 'anonymous', actualDatabase: true, samples: [], responseDataPersisted: false,
  credentialsPersisted: false, operatingWrites: 0, fieldAdmission: 0, performanceAdmission: 0 };
try {
  const seed = await client.from('restaurants').select(RESTAURANT_REVIEW_CANDIDATE_SELECT).eq('status', 'approved').order('id').limit(2);
  assert.ok(!seed.error && seed.data?.length === 2, 'SEED_READ_UNAVAILABLE');
  const cases = seed.data.map((row, index) => ({ label: `public-restaurant-${index + 1}`,
    names: [row.approved_name || row.naver_name || row.origin_name || row.google_name].filter(Boolean),
    addresses: [row.road_address || row.jibun_address].filter(Boolean) }));
  cases.push({ label: 'reserved-literal-empty', names: ['__tzudong_probe_20261014__,(x).:"\\'], addresses: ['__tzudong_probe_address_20261014__,(x).:"\\'] });
  for (const scenario of cases) {
    assert.ok(scenario.names.length === 1, 'MISSING_LOOKUP_NAME');
    const criteria = buildReviewCandidateCriteria(scenario.names, scenario.addresses);
    const filter = buildReviewCandidateUnionFilter(criteria);
    const readOne = async ({ field, value }) => {
      const response = await client.from('restaurants').select(RESTAURANT_REVIEW_CANDIDATE_SELECT).eq(field, value);
      assert.ok(!response.error && Array.isArray(response.data), 'LEGACY_PUBLIC_READ_FAILED');
      return response;
    };
    let exactCount;
    const readUnion = async text => {
      const response = await client.from('restaurants').select(RESTAURANT_REVIEW_CANDIDATE_SELECT, { count: 'exact' }).or(text);
      assert.ok(!response.error && Array.isArray(response.data), 'UNION_PUBLIC_READ_FAILED');
      exactCount = response.count;
      return response;
    };
    for (let repeat = 0; repeat < plan.pairedRepeatsPerCase; repeat++) {
      const output = {};
      for (const kind of repeat % 2 ? ['union', 'legacy'] : ['legacy', 'union']) {
        const n = requests, start = performance.now();
        const data = kind === 'legacy' ? (await Promise.all(criteria.map(readOne))).flatMap(x => x.data) :
          await readRestaurantReviewCandidates({ names: scenario.names, addresses: scenario.addresses, readUnion, readOne });
        output[kind] = { ids: [...new Set(data.map(x => x.id))].sort(), elapsedMs: performance.now() - start,
          requests: requests - n, rawRows: data.length };
      }
      assert.deepEqual(output.legacy.ids, output.union.ids, 'LIVE_CANDIDATE_ID_SET_MISMATCH');
      assert.equal(exactCount, output.union.rawRows, 'UNION_COUNT_INCOMPLETE');
      assert.equal(output.union.requests, 1, 'UNEXPECTED_LIVE_FALLBACK');
      receipt.samples.push({ case: scenario.label, repeat, filterEncodedBytes: encodeURIComponent(filter).length,
        predicateCount: criteria.length, equalCandidateIdSet: true, exactCount,
        uniqueIds: output.union.ids.length, legacyRequests: output.legacy.requests, unionRequests: output.union.requests,
        legacyElapsedMs: output.legacy.elapsedMs, unionElapsedMs: output.union.elapsedMs });
    }
  }
  receipt.passed = true;
} catch {
  receipt.passed = false;
  receipt.failureCode = 'READ_ONLY_LIVE_CONTRACT_FAILED';
  process.exitCode = 1;
} finally {
  receipt.requests = requests; receipt.statuses = statuses; receipt.completedAtUTC = new Date().toISOString();
  writeFileSync(new URL('live-database-readback-v1.json', here), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ passed: receipt.passed, samples: receipt.samples.length, requests, statuses }));
}
