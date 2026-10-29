import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadRecord, priorQuery, terminalQuery, expectedTerminal, disposition,
  preflightSql, reconcileSql } from '../scripts/sponsorship-sql-successor.mjs';
import { statementSpans } from '../scripts/supabase-migration-transaction.mjs';

const record = loadRecord();
const hash = value => createHash('sha256').update(value).digest('hex');
const before = {
  identity: true, catalog: true,
  ledger: { count: 97, priorHash: record.manifest.priorLedger.sha256,
    targets: record.plans.map(p => ({ version: p.version, present: false, equal: false })) },
  revision: { count: 1, singletonCount: 1, value: '38' },
  data: { businessCount: 4, businessHash: hash('business'), cohortCount: 2,
    cohortHash: hash('cohort'), indexCount: 4, indexHash: hash('index'),
    untouchedCount: 2, untouchedHash: hash('untouched') },
};
const sql = terminalQuery(record, before);
const occurrences = (text, part) => text.split(part).length - 1;
const outsideStrings = text => text.replace(/'(?:''|[^'])*'/g, "''");

// Split only the outer JSON constructor's arguments, leaving nested SQL and
// quoted catalog definitions intact. This checks the actual generated schema.
function argumentsOf(text, marker) {
  const start = text.indexOf(marker);
  assert.notEqual(start, -1);
  const args = [];
  let depth = 0, quoted = false, from = start + marker.length;
  for (let i = from; i < text.length; i++) {
    const char = text[i];
    if (char === "'") {
      if (quoted && text[i + 1] === "'") { i++; continue; }
      quoted = !quoted;
    }
    if (quoted) continue;
    if (char === '(') depth++;
    if (char === ')' && depth-- === 0) {
      args.push(text.slice(from, i).trim());
      return args;
    }
    if (char === ',' && depth === 0) { args.push(text.slice(from, i).trim()); from = i + 1; }
  }
  assert.fail('unterminated JSON constructor');
}

describe('terminal snapshot evaluation and guarded descriptor projection', () => {
  it('retains the exact full preflight snapshot once, with an optimization fence', () => {
    const prior = priorQuery(record);
    const data = prior.slice(prior.indexOf("'data',") + "'data',".length, -') AS state'.length);
    assert.equal(occurrences(sql, data), 1);
    assert.ok(sql.includes(`snapshot AS MATERIALIZED (SELECT ${data} AS d)`));
    for (const aggregate of ['string_agg(to_jsonb(r)::text', 'string_agg(r.id::text',
      'string_agg(to_jsonb(i)::text']) {
      assert.equal(occurrences(sql, aggregate), occurrences(data, aggregate));
    }
    // Reuse the count already captured with the index hash, rather than scan again.
    assert.equal(occurrences(sql, 'SELECT count(*) FROM pipeline_control.admin_evaluation_read_index)'), 1);
    assert.ok(sql.includes("'indexCountCorrect',(d->>'indexCount')::bigint=2+2"));
  });

  it('compares the complete pinned catalog once and reuses its boolean for both guards', () => {
    assert.equal(occurrences(sql, record.manifest.catalogExpression), 1);
    const after = `'${JSON.stringify(record.manifest.catalogAfter).replaceAll("'", "''")}'::jsonb`;
    assert.ok(sql.includes(`catalog AS MATERIALIZED (SELECT (${record.manifest.catalogExpression}=${after}) AS ok)`));
    assert.ok(sql.includes("'catalog',catalog.ok"));
    const executable = outsideStrings(sql);
    assert.equal(occurrences(executable, 'CASE WHEN catalog.ok THEN'), 2);
    assert.equal(occurrences(executable, 'pipeline_control.admin_eval_descriptor('), 1);
    assert.ok(!executable.includes('pipeline_control.admin_record_compose('));
  });

  it('guards the call itself and selects only the original cohort before materializing descriptors', () => {
    const prior = priorQuery(record);
    const candidate = prior.match(/'cohortCount',\(SELECT count\(\*\) FROM public\.restaurants r WHERE ([\s\S]*?)\),\n 'cohortHash'/)?.[1];
    assert.ok(candidate);
    assert.ok(sql.includes(`expected AS MATERIALIZED (
 SELECT r.id, CASE WHEN catalog.ok THEN pipeline_control.admin_eval_descriptor(to_jsonb(r)||jsonb_build_object('name',r.approved_name)) ELSE NULL END AS d
 FROM public.restaurants r CROSS JOIN catalog WHERE catalog.ok AND (${candidate}))`));
    assert.ok(sql.includes('CASE WHEN catalog.ok THEN NOT EXISTS('));
    assert.ok(sql.includes("OR i.video IS DISTINCT FROM expected.d->>'video')) ELSE false END"));
  });

  it('retains missing-index LEFT JOIN detection and all four null-safe descriptor comparisons', () => {
    assert.ok(sql.includes('SELECT 1 FROM expected LEFT JOIN pipeline_control.admin_evaluation_read_index i ON i.id=expected.id'));
    const condition = sql.match(/WHERE \(i\.id IS NULL OR ([\s\S]*?)\)\) ELSE false END/)?.[1];
    assert.equal(condition, `i.descriptor IS DISTINCT FROM expected.d
 OR i.latest IS DISTINCT FROM (expected.d->>'latest')::numeric OR i.created IS DISTINCT FROM (expected.d->>'created')::numeric
 OR i.video IS DISTINCT FROM expected.d->>'video'`);
  });

  it('preserves the single state row schema and every preimage comparison', () => {
    assert.equal(statementSpans(sql).length, 1);
    assert.match(sql, /^SELECT state FROM \(WITH /);
    assert.ok(sql.endsWith('AS state FROM snapshot CROSS JOIN catalog) terminal'));
    const args = argumentsOf(sql, "SELECT jsonb_build_object('identity',");
    // The marker consumed the first key; restore it to inspect all pairs.
    args.unshift("'identity'");
    assert.equal(args.length % 2, 0);
    const keys = args.filter((_, index) => index % 2 === 0).map(key => key.slice(1, -1));
    assert.deepEqual(keys, Object.keys(expectedTerminal(record, before)));
    for (const prefix of ['business', 'cohort', 'untouched']) {
      assert.ok(sql.includes(`'${prefix}Unchanged',d->'${prefix}Hash'='"${before.data[`${prefix}Hash`]}"'::jsonb AND d->'${prefix}Count'='${before.data[`${prefix}Count`]}'::jsonb`));
    }
  });

  it('fails closed on drift, missing/null results, and each failed data predicate', () => {
    const expected = expectedTerminal(record, before);
    assert.equal(disposition(record, { prior: before, terminal: expected }, before), 'committed');
    const driftedPrior = { ...before, catalog: false };
    for (const catalog of [false, null, undefined]) {
      const terminal = { ...expected, catalog, cohortCorrect: false };
      assert.equal(disposition(record, { prior: driftedPrior, terminal }, before), 'conflict_or_unconfirmed');
      assert.equal(disposition(record, { prior: before, terminal }, before), 'not_applied_no_retry');
    }
    for (const key of ['businessUnchanged', 'cohortUnchanged', 'untouchedUnchanged', 'indexCountCorrect', 'cohortCorrect']) {
      for (const value of [false, null, undefined]) {
        assert.equal(disposition(record, { prior: before, terminal: { ...expected, [key]: value } }, before),
          'committed_schema_ledger_postcommit_data_unverified');
      }
    }
    for (const terminal of [null, {}]) {
      assert.notEqual(disposition(record, { prior: driftedPrior, terminal }, before), 'committed');
    }
  });

  it('keeps read-only wrappers and their existing deadlines', () => {
    for (const query of [preflightSql(record), reconcileSql(record, before)]) {
      assert.ok(query.includes('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;'));
      assert.ok(query.includes("SET LOCAL statement_timeout='15s'; SET LOCAL lock_timeout='2s';"));
      assert.ok(statementSpans(query).every(span => /^(SET|SELECT)\b/.test(span.token.trim())));
    }
  });
});
