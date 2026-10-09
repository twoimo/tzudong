import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureQuery } from './fixture-query-v7.mjs';
test('JSON published date sorts descending with nulls last before limit and offset', () => {
  const rows = [{id:'null',youtube_meta:null},{id:'old',youtube_meta:{publishedAt:'2025-01-01'}},
    {id:'new',youtube_meta:{publishedAt:'2026-01-01'}},{id:'empty',youtube_meta:{}}];
  const params = new URLSearchParams({ order: 'youtube_meta->>publishedAt.desc.nullslast', limit:'2', select:'id' });
  assert.deepEqual(fixtureQuery(rows,params).data,[{id:'new'},{id:'old'}]);
  params.set('offset','1'); assert.deepEqual(fixtureQuery(rows,params).data,[{id:'old'},{id:'null'}]);
});
test('unsupported JSON order and null semantics fail explicitly', () => {
  for (const order of ['unknown->>publishedAt.desc','youtube_meta->>publishedAt.desc.other','created_at.desc.nullslast.extra'])
    assert.throws(()=>fixtureQuery([],new URLSearchParams({order})),/fixture_order_unsupported/);
});
