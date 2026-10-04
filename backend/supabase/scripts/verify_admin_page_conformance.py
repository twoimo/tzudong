#!/usr/bin/env python3
"""Read-only business-source replay into an explicitly owned temporary database."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from backend.supabase.tests.test_admin_evaluation_read_helpers import AdminReadHelperTests

SOURCE = Path('/Users/twoimo/Documents/projects/tzudong/backend/restaurant-evaluation/data/tzuyang/evaluation/transforms.jsonl')
REFERENCE = r'''
import {normalizeEvaluationRecord,withAdminEvaluationDisplayName} from './lib/admin/normalize-evaluation-record.ts';
import {filterEvaluationRecords,evaluationStats} from './lib/admin/evaluation-query.ts';
const raw=await Bun.stdin.json();
const records=raw.map(normalizeEvaluationRecord).filter(Boolean).map(withAdminEvaluationDisplayName);
const queries=[{searchQuery:'',evalFilters:{},deepLinkFilter:null}];
for(const status of ['pending','approved','hold','db_conflict','deleted','missing','not_selected','ready_for_approval','unconfirmed_map'])queries.push({searchQuery:'',evalFilters:{status},deepLinkFilter:null});
for(const key of ['visit_authenticity','rb_inference_score','review_faithfulness_score','rb_grounding_TF','category_TF','category_validity_TF','geocoding_success'])
for(const value of ['0','1','2','4','0x2','0.3','1.00000000000000001','True','False','true','false_match','false_geocode','review'])queries.push({searchQuery:'',evalFilters:{[key]:value},deepLinkFilter:null});
for(const issue of ['notSelection','ruleFalse','laajGap'])queries.push({searchQuery:'',evalFilters:{},deepLinkFilter:{issue}});
for(const term of ['식당','이름 없음','영상 제목 없음',...records.slice(0,8).map(r=>r.origin_name?.slice(0,3)).filter(Boolean)])queries.push({searchQuery:term,evalFilters:{},deepLinkFilter:null});
console.log(JSON.stringify({stats:evaluationStats(records),queries:queries.map(query=>({query,ids:filterEvaluationRecords(records,query).map(r=>r.id)}))}));
'''


def main():
    if os.environ.get('TZUDONG_ADMIN_READ_HELPERS_PG') != '1':
        raise RuntimeError('owned_database_opt_in_required')
    before = SOURCE.read_bytes()
    rows = []
    for index, line in enumerate(before.decode().splitlines()):
        if not line.strip():
            continue
        row = json.loads(line)
        row.update(id=f'00000000-0000-4000-8000-{index:012d}',
                   created_at=row.get('created_at') or '2026-01-01T00:00:00Z',
                   is_not_selected=row.get('is_not_selected', row.get('is_notSelected', False)))
        rows.append(row)
    AdminReadHelperTests.setUpClass()
    try:
        from psycopg2.extras import Json
        conn = AdminReadHelperTests.conn
        with conn.cursor() as cursor:
            cursor.execute('INSERT INTO public.restaurants SELECT * FROM jsonb_populate_recordset(NULL::public.restaurants,%s)', (Json(rows),))
            cursor.execute("SELECT to_jsonb(r)||jsonb_build_object('name',r.approved_name) FROM public.restaurants r ORDER BY created_at DESC,id ASC")
            actual_rows = [item[0] for item in cursor.fetchall()]
        reference = json.loads(subprocess.run(
            [os.environ['TZUDONG_TEST_BUN'], '-e', REFERENCE], cwd=ROOT/'apps/web',
            input=json.dumps(actual_rows), capture_output=True, text=True, check=True,
        ).stdout)
        failures = []
        with conn.cursor() as cursor:
            cursor.execute('SET ROLE service_role')
            for index, case in enumerate(reference['queries']):
                cursor.execute('SELECT public.admin_evaluation_page(%s,200,NULL,NULL)', (Json(case['query']),))
                page = cursor.fetchone()[0]
                ids = [row['id'] for row in page['records']]
                while page['hasMore']:
                    cursor.execute('SELECT public.admin_evaluation_page(%s,200,%s,%s)', (Json(case['query']), page['afterId'], page['revision']))
                    page = cursor.fetchone()[0]
                    ids.extend(row['id'] for row in page['records'])
                if ids != case['ids'] or page['filteredTotal'] != len(case['ids']) or page['stats'] != reference['stats']:
                    failures.append({'case': index, 'query': case['query'], 'expected_count': len(case['ids']), 'actual_count': len(ids),
                                     'ids_match': ids == case['ids'], 'stats_match': page['stats'] == reference['stats']})
            cursor.execute('RESET ROLE')
        assert SOURCE.read_bytes() == before, 'source_changed'
        measurements = []
        writes = []
        explain = None
        with conn.cursor() as cursor:
            cursor.execute('SET ROLE service_role')
            for repeat in range(7):
                for kind in (['catalog', 'page'] if repeat % 2 == 0 else ['page', 'catalog']):
                    start = time.perf_counter()
                    if kind == 'catalog':
                        cursor.execute('SELECT public.admin_evaluation_catalog_snapshot()')
                    else:
                        cursor.execute('SELECT public.admin_evaluation_page(%s,50,NULL,NULL)', (Json(reference['queries'][0]['query']),))
                    value = cursor.fetchone()[0]
                    elapsed = (time.perf_counter() - start) * 1000
                    measurements.append({'repeat': repeat, 'kind': kind, 'read_decode_ms': elapsed,
                                         'serialized_bytes': len(json.dumps(value, ensure_ascii=False).encode())})
            cursor.execute('RESET ROLE')
            for repeat in range(7):
                for kind in (['without_index', 'with_index'] if repeat % 2 == 0 else ['with_index', 'without_index']):
                    cursor.execute('BEGIN')
                    try:
                        if kind == 'without_index':
                            cursor.execute('ALTER TABLE public.restaurants DISABLE TRIGGER admin_eval_read_index_row')
                        started = time.perf_counter()
                        cursor.execute("UPDATE public.restaurants SET origin_name=origin_name||' fixture' WHERE id=ANY(%s::uuid[])",([r['id'] for r in rows[:50]],))
                        writes.append({'repeat':repeat,'kind':kind,'rows':cursor.rowcount,'write_ms':(time.perf_counter()-started)*1000})
                    finally: cursor.execute('ROLLBACK')
            cursor.execute('ANALYZE pipeline_control.admin_evaluation_read_index')
            cursor.execute('EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) SELECT id FROM pipeline_control.admin_evaluation_read_index WHERE pipeline_control.admin_eval_matches(descriptor,%s) ORDER BY latest DESC,created DESC,id DESC LIMIT 51',(Json(reference['queries'][0]['query']),))
            explain=cursor.fetchone()[0]
        print(json.dumps({'rows': len(rows), 'queries': len(reference['queries']), 'source_sha256': hashlib.sha256(before).hexdigest(), 'failures': failures,
                          'database_read_measurements': measurements,'write_measurements':writes,'keyset_explain':explain}, ensure_ascii=False))
        return 1 if failures else 0
    finally:
        AdminReadHelperTests.cleanup()


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as exc:
        print(json.dumps({'error_code': type(exc).__name__}))
        sys.exit(1)
