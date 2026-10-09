import { describe, expect, test } from 'bun:test';
import { buildEvaluationCatalog, EvaluationCatalogCache, evaluationCatalogPage } from '@/lib/admin/evaluation-catalog';
import { normalizeEvaluationRecord, withAdminEvaluationDisplayName } from '@/lib/admin/normalize-evaluation-record';
import { summarizeEvaluationRecord } from '@/lib/admin/evaluation-summary';
import { getAddressConsistencyStatus } from '@/lib/admin-address-consistency';
import { getEvaluationCompletenessIssues } from '@/lib/admin-evaluation-completeness';
import { parseEvaluationPageQuery } from '@/lib/admin/evaluation-page-query';
import { filterEvaluationRecords } from '@/lib/admin/evaluation-query';
import { findSameVideoDuplicateWarningCandidates } from '@/lib/admin-same-video-duplicate-warning';
import { findRestaurantIdentityWarnings } from '@/lib/admin-restaurant-identity-warning';

const query = { searchQuery: '', evalFilters: {}, deepLinkFilter: null };
function row(index: number, extra: Record<string, unknown> = {}) {
  return { id: `00000000-0000-0000-0000-${String(index).padStart(12, '0')}`, approved_name: `fixture-${index}`, name: `fixture-${index}`, origin_name: `fixture-${index}`,
    youtube_link: `https://youtu.be/${String(index).padStart(11, 'a')}`, created_at: '2026-01-01T00:00:00Z', status: 'pending', geocoding_success: false, ...extra };
}

describe('revision-bound evaluation pages', () => {
  test('enumerates more than the old 10000-row cap without omissions or duplicates', () => {
    const catalog = buildEvaluationCatalog({ revision: '1', records: Array.from({length:10011}, (_, index) => row(index)) });
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const page = evaluationCatalogPage(catalog, query, 200, cursor);
      expect(page.records.length).toBeLessThanOrEqual(200);
      expect(page.stats.total).toBe(10011);
      ids.push(...page.records.map(record => record.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(ids.length).toBe(10011);
    expect(new Set(ids).size).toBe(10011);
  });
  test('rejects stale, cross-filter, malformed and out-of-bounds cursors', () => {
    const original = buildEvaluationCatalog({revision:'1',records:[row(1),row(2)]});
    const cursor = evaluationCatalogPage(original,query,1).nextCursor!;
    expect(() => evaluationCatalogPage({...original,revision:'2'},query,1,cursor)).toThrow('EVALUATION_CURSOR_STALE');
    expect(() => evaluationCatalogPage(original,{...query,searchQuery:'different'},1,cursor)).toThrow('EVALUATION_CURSOR_INVALID');
    expect(() => evaluationCatalogPage(original,query,1,'not-json')).toThrow('EVALUATION_CURSOR_INVALID');
    expect(() => evaluationCatalogPage(original,query,201)).toThrow('EVALUATION_QUERY_INVALID');
    expect(() => parseEvaluationPageQuery(new URLSearchParams('filters=%7B%22unknown%22%3A%221%22%7D'))).toThrow();
  });
  test('coalesces cold requests, refreshes revisions and never caches errors', async () => {
    const cache = new EvaluationCatalogCache(); let calls = 0;
    const load = async () => { calls++; await new Promise(resolve => setTimeout(resolve,1)); return {revision:'1',records:[row(1)]}; };
    const results = await Promise.all(Array.from({length:20},()=>cache.get('1',load)));
    expect(calls).toBe(1); expect(results.every(result=>result === results[0])).toBe(true);
    await expect(cache.get('2', async()=>{throw new Error('fixture');})).rejects.toThrow();
    const fresh = await cache.get('2',async()=>({revision:'2',records:[row(2)]}));
    expect(fresh.records[0].id).toBe(row(2).id);
  });
  test('keeps complete global statistics and related-video warnings outside the page', () => {
    const records = [row(1,{status:'approved',youtube_link:'https://youtu.be/abcdefghijk',approved_name:'same',origin_name:'same'}),row(2,{youtube_link:'https://youtu.be/abcdefghijk',approved_name:'same',origin_name:'same'})];
    const catalog = buildEvaluationCatalog({revision:'1',records});
    const page = evaluationCatalogPage(catalog,{...query,evalFilters:{status:'pending'}},1);
    expect(page.records.length).toBe(1); expect(page.stats.approved).toBe(1); expect(page.stats.pending).toBe(1);
    const related = catalog.byVideo.get('abcdefghijk')!;
    expect(findSameVideoDuplicateWarningCandidates(page.records[0],related).length).toBe(1);
    expect(findRestaurantIdentityWarnings(page.records[0],related)).toEqual(findRestaurantIdentityWarnings(page.records[0],catalog.records));
  });
  test('shares search, date ordering, status and deep-link semantics', () => {
    const records = [row(1,{status:'deleted'}),row(2,{is_missing:true}),row(3,{is_not_selected:true,geocoding_false_stage:0}),row(4,{youtube_meta:{title:'special',publishedAt:'2026-03-01',is_shorts:false,duration:10,ads_info:{is_ads:false,what_ads:null}}})];
    const catalog = buildEvaluationCatalog({revision:'1',records});
    expect(evaluationCatalogPage(catalog,query).records[0].id).toBe(row(4).id);
    for (const state of ['deleted','missing','not_selected']) {
      const selection = {...query,evalFilters:{status:state}};
      expect(evaluationCatalogPage(catalog,selection).records.map(r=>r.id)).toEqual(filterEvaluationRecords(catalog.records,selection).map(r=>r.id));
    }
    expect(evaluationCatalogPage(catalog,{...query,searchQuery:'special'}).filteredTotal).toBe(1);
    expect(evaluationCatalogPage(catalog,{...query,deepLinkFilter:{issue:'notSelection',reason:'평가 미대상(address null 등)'}}).filteredTotal).toBe(1);
  });
});

describe('lazy evidence projection',()=>{
  test('preserves address status and exact missing-value/basis findings across all summary states',()=>{
    const statuses=['pending','approved','deleted','missing','not_selected','db_conflict'];
    const reasons=[null,'insufficient_evidence','multi_candidate','cross_country_mismatch'];
    let cases=0;
    for(const status of statuses) for(const reason of reasons) for(const geocoding of [true,false]) {
      const raw=row(++cases,{status,geocoding_success:geocoding,reasoning_basis:'fixture basis',evaluation_results:{location_match_TF:{eval_value:geocoding,pending_reason:reason},visit_authenticity:{eval_value:1,eval_basis:'fixture basis'}}});
      const full=withAdminEvaluationDisplayName(normalizeEvaluationRecord(raw)!);
      const summary=normalizeEvaluationRecord(summarizeEvaluationRecord(raw,full))!;
      expect(getAddressConsistencyStatus(summary)).toBe(getAddressConsistencyStatus(full));
      expect(getEvaluationCompletenessIssues(summary)).toEqual(getEvaluationCompletenessIssues(full));
      expect(summary.reasoning_basis).toBeNull();
      expect(full.reasoning_basis).toBe('fixture basis');
    }
    expect(cases).toBe(48);
  });
});
