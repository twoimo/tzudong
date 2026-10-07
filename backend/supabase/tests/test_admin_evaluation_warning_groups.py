"""Warning RPC behavior against an isolated, ICU-enabled PostgreSQL fixture."""
import json
import hashlib
from pathlib import Path
import os
import random
import subprocess
import time
import unittest
import uuid

from backend.supabase.tests import test_admin_evaluation_read_helpers as read_helpers

ROOT = read_helpers.ROOT


@unittest.skipUnless(os.environ.get('TZUDONG_ADMIN_READ_HELPERS_PG') == '1', 'owned PG opt-in required')
class WarningGroupContractTests(unittest.TestCase):
    setUpClass = classmethod(read_helpers.AdminReadHelperTests.setUpClass.__func__)
    cleanup = classmethod(read_helpers.AdminReadHelperTests.cleanup.__func__)

    def setUp(self):
        with self.conn.cursor() as cursor:
            cursor.execute('TRUNCATE public.restaurants')
            if not getattr(type(self), 'warning_installed', False):
                cursor.execute((ROOT / 'backend/supabase/migrations/20261004050500_admin_evaluation_warning_groups.sql').read_text())
                type(self).warning_installed = True

    @staticmethod
    def node_reference(rows, target_ids):
        # Run the actual TypeScript source in Node 24, not Bun's ICU or a Python
        # reimplementation. The loader only resolves the project's @/ alias and
        # extensionless imports; Node's own type stripping executes the source.
        node = os.environ.get('TZUDONG_TEST_NODE', '/opt/homebrew/opt/node@24/bin/node')
        code = r"""
import {registerHooks} from 'node:module';
import {existsSync,readFileSync} from 'node:fs';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
const base=process.cwd();
registerHooks({resolve(specifier,context,next){
 let path=specifier.startsWith('@/')?resolve(base,specifier.slice(2)):
  specifier.startsWith('.')&&context.parentURL?.startsWith('file:')?resolve(dirname(fileURLToPath(context.parentURL)),specifier):null;
 if(path&&!existsSync(path)&&existsSync(path+'.ts'))path+='.ts';
 return next(path?pathToFileURL(path).href:specifier,context);
}});
const {normalizeEvaluationRecord,withAdminEvaluationDisplayName}=await import(pathToFileURL(resolve(base,'lib/admin/normalize-evaluation-record.ts')));
const {findSameVideoDuplicateWarningCandidates}=await import(pathToFileURL(resolve(base,'lib/admin-same-video-duplicate-warning.ts')));
const {isSameVideoSameOriginDeleted}=await import(pathToFileURL(resolve(base,'lib/admin-restaurant-identity-warning.ts')));
const input=JSON.parse(readFileSync(0,'utf8'));
const rows=input.rows.map(row=>withAdminEvaluationDisplayName(normalizeEvaluationRecord(row)))
 .sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)||a.id.localeCompare(b.id));
const groups=input.targets.map(id=>{
 const target=rows.find(row=>row.id===id),sameVideo=findSameVideoDuplicateWarningCandidates(target,rows);
 const deleted=target.status==='deleted'?[]:rows.filter(row=>isSameVideoSameOriginDeleted(target,row));
 return {id,sameVideo:{count:sameVideo.length,candidates:sameVideo.slice(0,3)},deleted:{count:deleted.length,ids:deleted.slice(0,3).map(row=>row.id)}};
});
console.log(JSON.stringify({runtime:{node:process.versions.node,icu:process.versions.icu,unicode:process.versions.unicode,locale:Intl.Collator().resolvedOptions().locale},groups}));
"""
        result = subprocess.run([node, '--input-type=module', '-e', code], cwd=ROOT/'apps/web',
                                input=json.dumps({'rows': rows, 'targets': target_ids}), capture_output=True, text=True, check=True)
        value = json.loads(result.stdout)
        assert value['runtime']['node'].startswith('24.') and value['runtime']['icu'].startswith('78.')
        assert value['runtime']['unicode'] == '17.0' and value['runtime']['locale'] == 'en-US'
        return value['groups']

    @staticmethod
    def row(number, **overrides):
        return {'id':str(uuid.UUID(int=number+1)), 'origin_name':'fixture', 'approved_name':'fixture',
                'status':'pending', 'created_at':'2026-01-01T00:00:00Z',
                'youtube_link':'https://youtu.be/ABCDEFGHIJK', **overrides}

    def insert(self, rows):
        from psycopg2.extras import Json
        with self.conn.cursor() as cursor:
            cursor.execute('INSERT INTO public.restaurants SELECT * FROM jsonb_populate_recordset(NULL::public.restaurants,%s)', (Json(rows),))

    def warning(self, ids, revision=None):
        with self.conn.cursor() as cursor:
            cursor.execute('SET ROLE service_role')
            try:
                if revision is None:
                    cursor.execute('SELECT public.admin_evaluation_revision()'); revision=cursor.fetchone()[0]
                cursor.execute('SELECT public.admin_evaluation_warning_groups(%s::uuid[],%s)', (ids,revision))
                return cursor.fetchone()[0]
            finally:
                cursor.execute('RESET ROLE')

    def compare(self, rows, ids=None):
        self.insert(rows); ids=ids or [row['id'] for row in rows]
        expected={g['id']:g for g in self.node_reference(rows,ids)}
        actual=self.warning(ids)
        for group in actual['groups']:
            with self.subTest(id=group['id']):
                want=expected[group['id']]
                self.assertEqual(group['sameVideo'],want['sameVideo'])
                self.assertEqual(group['deleted']['count'],want['deleted']['count'])
                self.assertEqual([r['id'] for r in group['deleted']['samples']],want['deleted']['ids'])
        return actual

    def test_unicode_nfkc_patch_and_supported_domain_match_node24(self):
        # Both single characters and adjacent combining marks matter: a singleton
        # mapping test would miss new canonical composition/CCC incompatibility.
        values=['\U0001ccd6', '\U0001ccd6\u0301', '\ua7f1', '\ua7f1\u0307', 'Ａ', '각',
                'İSTANBUL', 'ΟΣ', 'A\u0315\u0300', '😀식당', '\ufeff식당\u00a0']
        values += [chr(code) for code in range(0x1ccd6,0x1ccfa)]
        node=os.environ.get('TZUDONG_TEST_NODE','/opt/homebrew/opt/node@24/bin/node')
        code="const a=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(JSON.stringify(a.map(s=>s.normalize('NFKC'))));"
        expected=json.loads(subprocess.run([node,'-e',code],input=json.dumps(values),text=True,capture_output=True,check=True).stdout)
        with self.conn.cursor() as cursor:
            cursor.execute("SELECT unicode_version(),normalize(chr(117974),NFKC)")
            self.assertEqual(cursor.fetchone(),('15.1','\U0001ccd6'))
            for value,want in zip(values,expected):
                cursor.execute('SELECT pipeline_control.admin_warning_nfkc(%s)',(value,));self.assertEqual(cursor.fetchone()[0],want)
            for value in ['\u0897', 'a\u0315\u0897', '\U000105d2\u0307', '\U00011382\U000113c9', '\u0378']:
                with self.assertRaisesRegex(self.driver.Error,'EVALUATION_WARNING_UNICODE_UNSUPPORTED'):
                    cursor.execute('SELECT pipeline_control.admin_warning_nfkc(%s)',(value,))
        rows=[self.row(i,approved_name=name,origin_name=name) for i,name in enumerate(['\U0001ccd6 본점','A','a','Ａ','a\u0301','\U0001ccd6\u0301'])]
        self.compare(rows)

    @unittest.skipUnless(os.environ.get('TZUDONG_UNICODE17_FIXTURES'),'hash-pinned Unicode 17 files required')
    def test_unicode17_conformance_vectors_and_every_assigned_scalar(self):
        from psycopg2.extras import execute_values
        directory=Path(os.environ['TZUDONG_UNICODE17_FIXTURES'])
        files={'NormalizationTest.txt':'5019ffd530751a741900c849c0e010332f142a3612234639bd200b82138a87db',
               'SpecialCasing.txt':'efc25faf19de21b92c1194c111c932e03d2a5eaf18194e33f1156e96de4c9588'}
        for filename,expected in files.items():self.assertEqual(hashlib.sha256((directory/filename).read_bytes()).hexdigest(),expected)
        vectors=[];norm_rows=0
        for line in (directory/'NormalizationTest.txt').read_text().splitlines():
            content=line.split('#')[0].strip()
            if not content or content.startswith('@'):continue
            columns=[''.join(chr(int(code,16)) for code in col.split()) for col in content.split(';')[:5]]
            vectors.extend([value,columns[3]] for value in columns);norm_rows+=1
        # Add non-locale context cases for every special-casing record. Locale-
        # specific Turkish/Lithuanian rules must NOT replace JS toLowerCase().
        special=[]
        for line in (directory/'SpecialCasing.txt').read_text().splitlines():
            content=line.split('#')[0].strip()
            if content:
                character=chr(int(content.split(';')[0].strip(),16))
                special.extend([character,'A'+character,character+'A','A'+character+'\u0307 ','A'+character+' A'])
        node=os.environ.get('TZUDONG_TEST_NODE','/opt/homebrew/opt/node@24/bin/node')
        code=r"""const input=JSON.parse(require('fs').readFileSync(0,'utf8'));
const rows=input.vectors.map(([value,expected])=>{if(value.normalize('NFKC')!==expected)throw Error('NODE_NFKC_CONFORMANCE');return [value,expected,expected.toLowerCase()]});
for(const value of input.special){const expected=value.normalize('NFKC');rows.push([value,expected,expected.toLowerCase()]);}
let scalars=0;for(let cp=1;cp<=0x10ffff;cp++){if(cp>=0xd800&&cp<=0xdfff)continue;const value=String.fromCodePoint(cp);if(!/^\p{Assigned}$/u.test(value))continue;const expected=value.normalize('NFKC');rows.push([value,expected,expected.toLowerCase()]);scalars++;}
console.log(JSON.stringify({rows,scalars}));"""
        reference=json.loads(subprocess.run([node,'-e',code],input=json.dumps({'vectors':vectors,'special':special}),text=True,capture_output=True,check=True).stdout)
        patch=chr(0xa7f1)+''.join(chr(c) for c in range(0x1ccd6,0x1ccfa)); replacement='SABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
        admitted=rejected=0;sort_values=[]
        with self.conn.cursor() as cursor:
            for start in range(0,len(reference['rows']),1000):
                rows=reference['rows'][start:start+1000]
                actual=execute_values(cursor,"""WITH inputs(value,expected,expected_lower) AS (VALUES %s),
                  checked AS MATERIALIZED (SELECT *,unicode_assigned(translate(value,"""+cursor.mogrify('%s,%s',(patch,replacement)).decode()+""")) AS supported FROM inputs)
                  SELECT supported,CASE WHEN supported THEN pipeline_control.admin_warning_nfkc(value)=expected
                    AND lower(pipeline_control.admin_warning_nfkc(value) COLLATE pipeline_control.admin_warning_case)=expected_lower ELSE NULL END FROM checked""",rows,page_size=1000,fetch=True)
                for row,(supported,equal) in zip(rows,actual):
                    if supported:
                        admitted+=1;self.assertTrue(equal);sort_values.append(row[0])
                    else:rejected+=1
        self.assertEqual(admitted+rejected,len(reference['rows']));self.assertGreater(rejected,0)
        # Compare ICU ordering with explicit stable input-index ties on all the
        # admitted forms/scalars, not just hand-picked Latin/Korean names.
        sort_code="const a=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(JSON.stringify(a.map((value,id)=>({value,id})).sort((a,b)=>a.value.localeCompare(b.value)||a.id-b.id).map(r=>r.id)));"
        ordered=json.loads(subprocess.run([node,'-e',sort_code],input=json.dumps(sort_values),text=True,capture_output=True,check=True).stdout)
        with self.conn.cursor() as cursor:
            cursor.execute('CREATE TEMP TABLE unicode_warning_sort(id integer,value text)')
            execute_values(cursor,'INSERT INTO unicode_warning_sort VALUES %s',enumerate(sort_values),page_size=1000)
            cursor.execute('SELECT id FROM unicode_warning_sort ORDER BY value COLLATE pipeline_control.admin_warning_order,id')
            pg_order=[r[0] for r in cursor.fetchall()]
            self.assertEqual(len(pg_order),len(ordered))
            mismatch=next(((position,pg_id,node_id) for position,(pg_id,node_id) in enumerate(zip(pg_order,ordered)) if pg_id!=node_id),None)
            if mismatch:
                position,pg_id,node_id=mismatch
                self.fail(f'ICU order mismatch at {position}: PG id={pg_id} {[hex(ord(c)) for c in sort_values[pg_id]]}; Node id={node_id} {[hex(ord(c)) for c in sort_values[node_id]]}')
            cursor.execute('DROP TABLE unicode_warning_sort')
        print(json.dumps({'unicode17NormalizationRows':norm_rows,'normalizationForms':len(vectors),'specialCaseContexts':len(special),
                          'assignedUnicode17ScalarsExcludingNulAndSurrogates':reference['scalars'],'admittedMatchingNfkcAndNodeLower':admitted,
                          'explicitlyUnsupported':rejected,'icuOrderComparedValues':len(sort_values),'completeUnicode17Support':False}),flush=True)

    def test_full_groups_match_node_rules_utf16_order_deleted_and_self_exclusion(self):
        rng=random.Random(10304)
        names=['서울식당','서울식단','서울식당 본점','ＴＥＳＴ','test','İSTANBUL','ΟΣ','😀가나다','😀가나바','👩\u200d🍳식당',
               'e\u0301','é','E','\U0001ccd6','A','A (추정)','Ａ','A [alias]','구 서울 식당','서울(현)식당']
        rows=[]
        for i in range(96):
            name=names[i%len(names)]
            rows.append(self.row(i,approved_name=name if i%4 else None,origin_name=name,naver_name=name if i%3 else 'different',
                phone=['0212345678','0212345679',None][i%3],road_address=['서울길','인천길',None][i%3],
                lat=37+(i%7)*.000035,lng=127+(i%5)*.00004,status='deleted' if i%11==0 else rng.choice(['pending','approved','hold']),
                updated_by_admin_id=str(uuid.UUID(int=500)) if i%9==0 else None,
                created_at=f'2026-01-{i%27+1:02d}T00:00:00Z'))
        # One row can match both deleted origin and candidate. Inclusion/exclusion
        # must count once; overlapping tie names preserve created/id order.
        rows += [self.row(96,origin_name='서울식당',approved_name='서울식당',status='deleted'),
                 self.row(97,origin_name='서울식당',approved_name='서울식당')]
        self.compare(rows)

    def test_candidate_order_normalizes_non_fcd_combining_sequences(self):
        # ICU's default normalization=off gives these canonically equal names
        # different sort positions; Intl.Collator uses full normalization.
        names=['\u0592\u05b7\u05bc\u05a5\u05b0\u05c0\u05c4\u05ad',
               '\u05b0\u05b7\u05bc\u05a5\u0592\u05c0\u05ad\u05c4']*3
        self.compare([self.row(i,approved_name=None,naver_name=name) for i,name in enumerate(names)])

    def test_spatial_cells_preserve_antimeridian_poles_and_twenty_meter_edges(self):
        rows=[]
        for center,(lat,lng) in enumerate([(37,127),(0,179.99999),(89.99999,0),(-89.99999,0)]):
            for offset,distance in enumerate([0,19.99,20.01,35]):
                longitude=lng+distance/(6371000*3.141592653589793/180) if abs(lat)<80 else [0,90,180,-90][offset]
                if longitude>180:longitude-=360
                rows.append(self.row(center*4+offset,approved_name=['abcdefga','abcdefgb','abcdefgc','abcdefgd'][offset],
                    lat=lat,lng=longitude,youtube_link=f'https://youtu.be/VIDEO{center:06d}'))
        self.compare(rows)

    def test_banded_distance_has_the_same_threshold_decisions(self):
        rng=random.Random(99); pairs=[]
        for size in [1,2,3,4,7,10,25,50,100,256]:
            for ratio in [.14,.18,.28,.30]:
                a='가'*size; edits=max(1,round(size*ratio)); b='나'*edits+'가'*(size-edits)
                pairs.append([a,b])
        for _ in range(100):
            a=''.join(rng.choice('abc😀가') for _ in range(rng.randrange(1,25)))
            b=''.join(rng.choice('abc😀가') for _ in range(rng.randrange(1,25)))
            pairs.append([a,b])
        with self.conn.cursor() as cursor:
            for a,b in pairs:
                cursor.execute('SELECT pipeline_control.admin_warning_similarity(%s,%s)',(a,b)); exact=cursor.fetchone()[0]
                for threshold in [.72,.82,.86]:
                    cursor.execute('SELECT pipeline_control.admin_warning_similarity(%s,%s,%s)',(a,b,threshold)); actual=cursor.fetchone()[0]
                    self.assertEqual(actual>=threshold,exact>=threshold)
                    if actual>=threshold:self.assertEqual(actual,exact)
        # Also exercise the actual unmodified JS classifier, so two variants of
        # the SQL distance implementation cannot hide a shared mistake.
        rows=[];targets=[]
        for index,(a,b) in enumerate(pairs):
            for side,name in enumerate([a,b]):
                row=self.row(index*2+side,approved_name=name,phone='0212345678',
                             youtube_link=f'https://youtu.be/PAIR{index:07d}')
                rows.append(row)
                if side==0:targets.append(row['id'])
        self.compare(rows,targets)

    def test_capacity_and_unsupported_inputs_fail_closed_not_partial(self):
        for kwargs,code in [({'approved_name':'a'*257},'CAPACITY_EXCEEDED'),({'approved_name':'\u0897'},'UNICODE_UNSUPPORTED'),
                            ({'lat':91,'lng':127},'COORDINATE_UNSUPPORTED'),
                            ({'youtube_link':None,'phone':'1'*8193},'CAPACITY_EXCEEDED')]:
            with self.subTest(code=code),self.conn.cursor() as cursor:
                cursor.execute('TRUNCATE public.restaurants'); rows=[self.row(0,**kwargs)];self.insert(rows)
                with self.assertRaisesRegex(self.driver.Error,'EVALUATION_WARNING_'+code):self.warning([rows[0]['id']])
        with self.conn.cursor() as cursor:
            cursor.execute('TRUNCATE public.restaurants')
            rows=[self.row(i,approved_name='dense'+str(i),phone='0212345678') for i in range(600)]
            self.insert(rows)
            with self.assertRaisesRegex(self.driver.Error,'EVALUATION_WARNING_CAPACITY_EXCEEDED'):self.warning([r['id'] for r in rows[:200]])
            source=(ROOT/'backend/supabase/migrations/20261004050500_admin_evaluation_warning_groups.sql').read_text()
            prefix=source[source.index(' WITH targets AS MATERIALIZED ('):source.index(' ), pairs AS MATERIALIZED')]
            plan_query=(prefix+' ) SELECT count(*) FROM raw_pairs').replace('page_ids','%s::uuid[]')
            cursor.execute('EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) '+plan_query,([r['id'] for r in rows[:200]],));plan=cursor.fetchone()[0][0]
            def nodes(item):
                yield item
                for child in item.get('Plans',[]):yield from nodes(child)
            raw=next(n for n in nodes(plan['Plan']) if n.get('Subplan Name')=='CTE raw_pairs')
            self.assertEqual(raw['Actual Rows'],25001)
            print(json.dumps({'densePairExplain':{'targets':200,'relatedRows':600,'rawPairs':raw['Actual Rows'],'executionMs':plan['Execution Time']},'partialResultReturned':False}),flush=True)
            cursor.execute("UPDATE public.restaurants SET approved_name='fixture'")
            recovered=self.warning([rows[0]['id']])
            self.assertEqual(recovered['groups'][0]['sameVideo']['count'],599)
            cursor.execute('TRUNCATE public.restaurants')
            long_rows=[self.row(i,approved_name='a'*250+f'{i:06}',phone='0212345678') for i in range(20)]
            self.insert(long_rows)
            with self.assertRaisesRegex(self.driver.Error,'EVALUATION_WARNING_CAPACITY_EXCEEDED'):self.warning([r['id'] for r in long_rows])
            cursor.execute('SELECT pipeline_control.admin_warning_budget(25000,2000000)');self.assertTrue(cursor.fetchone()[0])
            for pairs,cells in [(25001,0),(1,2000001)]:
                with self.assertRaisesRegex(self.driver.Error,'EVALUATION_WARNING_CAPACITY_EXCEEDED'):
                    cursor.execute('SELECT pipeline_control.admin_warning_budget(%s,%s)',(pairs,cells))

    @unittest.skipUnless(os.environ.get('TZUDONG_WARNING_SCALE')=='1','50k local scale opt-in required')
    def test_fifty_thousand_catalog_count_and_bounded_pair_execution(self):
        # This is a real local RPC measurement, not a claimed hosted speedup.
        # Distinct physical shapes share one identity: exact aggregation avoids
        # the old 200 * 50,000 evidence evaluations, while counts stay 49,999.
        with self.conn.cursor() as cursor:
            cursor.execute("SET statement_timeout='90s';SET track_functions='pl';")
            cursor.execute("""INSERT INTO public.restaurants(id,origin_name,approved_name,status,youtube_link,phone,road_address,created_at)
              SELECT md5(i::text)::uuid,'fixture','fixture','pending','https://youtu.be/ABCDEFGHIJK',
               '0212345678','street'||i::text,'2026-01-01'::timestamptz FROM generate_series(1,50000) i""")
            cursor.execute('ANALYZE public.restaurants;ANALYZE pipeline_control.admin_evaluation_read_index')
            cursor.execute('SELECT id::text FROM public.restaurants ORDER BY id LIMIT 200');ids=[r[0] for r in cursor.fetchall()]
            cursor.execute('SELECT pg_stat_reset()')
        started=time.perf_counter();result=self.warning(ids);elapsed=time.perf_counter()-started
        self.assertEqual(len(result['groups']),200)
        self.assertTrue(all(g['sameVideo']['count']==49999 and len(g['sameVideo']['candidates'])==3 for g in result['groups']))
        with self.conn.cursor() as cursor:
            cursor.execute('SELECT pg_stat_force_next_flush()');cursor.execute('SELECT pg_stat_clear_snapshot()')
            cursor.execute("SELECT coalesce(sum(calls),0)::integer FROM pg_stat_user_functions WHERE funcname='admin_warning_evidence'");calls=cursor.fetchone()[0]
        self.assertEqual(calls,200)
        # EXPLAIN the real RPC CTE body, since EXPLAIN SELECT rpc(...) alone only
        # exposes an opaque Result node. Retain row/loop/temp-I/O statistics.
        source=(ROOT/'backend/supabase/migrations/20261004050500_admin_evaluation_warning_groups.sql').read_text()
        query=source[source.index(' WITH targets AS MATERIALIZED ('):source.index(" result:=jsonb_build_object('revision'")]
        query=query.replace(' INTO groups','').replace('page_ids','%s::uuid[]').strip().removesuffix(';')
        with self.conn.cursor() as cursor:
            cursor.execute('EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) '+query,(ids,));plan=cursor.fetchone()[0][0]
        def nodes(item):
            yield item
            for child in item.get('Plans',[]):yield from nodes(child)
        ctes={n['Subplan Name'][4:]:{'rows':n['Actual Rows'],'loops':n['Actual Loops']} for n in nodes(plan['Plan']) if n.get('Subplan Name','').startswith('CTE ')}
        self.assertEqual(ctes['related_groups']['rows'],50000);self.assertEqual(ctes['target_shapes']['rows'],200)
        self.assertEqual(ctes['raw_pairs']['rows'],0)
        print(json.dumps({'explainScenario':'50000-distinct-shapes-one-identity','executionMs':plan['Execution Time'],
                          'ctes':ctes,'tempReadBlocks':plan['Plan'].get('Temp Read Blocks',0),'tempWrittenBlocks':plan['Plan'].get('Temp Written Blocks',0)}),flush=True)
        print(json.dumps({'scenario':'50000-distinct-shapes-one-identity','targets':200,'catalog':50000,'seconds':round(elapsed,4),
                          'evidenceCalls':calls,'jsonBytes':len(json.dumps(result).encode()),'hostedPerformanceVerified':False}),flush=True)

    def test_deleted_target_never_inherits_active_target_groups(self):
        from psycopg2.extras import Json
        active, deleted = str(uuid.uuid4()), str(uuid.uuid4())
        rows = [dict(id=row_id, origin_name='같은 식당', approved_name='같은 식당',
                     status=status, youtube_link='https://youtu.be/ABCDEFGHIJK',
                     phone='0212345678', road_address='fixture street', lat=37, lng=127)
                for row_id, status in [(active, 'pending'), (deleted, 'deleted')]]
        with self.conn.cursor() as cursor:
            cursor.execute('INSERT INTO public.restaurants SELECT * FROM jsonb_populate_recordset(NULL::public.restaurants,%s)', (Json(rows),))
            cursor.execute('SET ROLE service_role')
            try:
                cursor.execute('SELECT public.admin_evaluation_revision()')
                revision = cursor.fetchone()[0]
                cursor.execute('SELECT public.admin_evaluation_warning_groups(%s::uuid[],%s)', ([active, deleted], revision))
                result = cursor.fetchone()[0]
                self.assertEqual(result['revision'], revision)
                groups = {item['id']: item for item in result['groups']}
                self.assertEqual(groups[deleted]['sameVideo'], {'count': 0, 'candidates': []})
                self.assertEqual(groups[deleted]['deleted'], {'count': 0, 'samples': []})
                self.assertEqual(groups[active]['sameVideo'], {'count': 0, 'candidates': []})
                self.assertEqual(groups[active]['deleted']['count'], 1)
                self.assertEqual(groups[active]['deleted']['samples'][0]['id'], deleted)
            finally:
                cursor.execute('RESET ROLE')

    def test_scalar_normalization_preserves_phone_and_address_rules(self):
        rows=[self.row(0,approved_name='abcdefga',road_address='\U0001ccd6 본점',phone='０２-1234-5678'),
              self.row(1,approved_name='abcdefgb',road_address='A',phone='02-1234-5678'),
              self.row(2,approved_name='abcdefgc',road_address='A',phone='０２-1234-5678'),
              self.row(3,approved_name='abcdefgd',road_address='A',jibun_address=' ',phone='０２-1234-5678'),
              self.row(4,approved_name='abcdefge',road_address='A\u00a0',phone='123456'),
              self.row(5,approved_name='abcdefgf',road_address='A',phone='١٢٣٤٥٦٧٨')]
        self.compare(rows)

    def test_revision_change_and_every_helper_permission(self):
        rows=[self.row(0),self.row(1)];self.insert(rows)
        old=self.warning([rows[0]['id']])['revision']
        with self.conn.cursor() as cursor:
            cursor.execute("UPDATE public.restaurants SET status='deleted' WHERE id=%s",(rows[1]['id'],))
            with self.assertRaisesRegex(self.driver.Error,'EVALUATION_CURSOR_STALE'):self.warning([rows[0]['id']],old)
            cursor.execute("""SELECT count(*),bool_and(NOT p.prosecdef AND p.proconfig=ARRAY['search_path=""']::text[]
              AND pg_get_userbyid(p.proowner)='postgres' AND has_function_privilege('service_role',p.oid,'EXECUTE')
              AND NOT has_function_privilege('anon',p.oid,'EXECUTE') AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE'))
              FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='pipeline_control' AND p.proname LIKE 'admin_warning_%%'""")
            count,valid=cursor.fetchone();self.assertEqual(count,12);self.assertTrue(valid)
            cursor.execute("""SELECT a.identity_arguments=p.proargtypes::text,a.grantee='service_role' FROM privacy_retention.g014_public_rpc_allowlist a
              JOIN pg_proc p ON p.oid=to_regprocedure(a.source_signature) WHERE a.source_signature='public.admin_evaluation_warning_groups(uuid[],text)'""")
            self.assertEqual(cursor.fetchone(),(True,True))
        result=self.warning([rows[0]['id']])['groups'][0]
        self.assertEqual(result['sameVideo']['count'],0);self.assertEqual(result['deleted']['count'],1)

    def test_warning_rpc_is_private_and_rejects_stale_revision(self):
        with self.conn.cursor() as cursor:
            for role in ['anon', 'authenticated']:
                cursor.execute('SET ROLE ' + role)
                try:
                    with self.assertRaises(self.driver.Error):
                        cursor.execute("SELECT public.admin_evaluation_warning_groups('{}'::uuid[],'0')")
                finally:
                    cursor.execute('RESET ROLE')
            cursor.execute('SET ROLE service_role')
            try:
                cursor.execute('SELECT public.admin_evaluation_revision()')
                revision = cursor.fetchone()[0]
                with self.assertRaisesRegex(self.driver.Error, 'EVALUATION_CURSOR_STALE'):
                    cursor.execute("SELECT public.admin_evaluation_warning_groups('{}'::uuid[],%s)", (str(int(revision) + 1),))
            finally:
                cursor.execute('RESET ROLE')


if __name__ == '__main__':
    unittest.main()
