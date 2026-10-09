"""Actual PG raw-group transport against the unchanged Node warning reference.

Owned local socket only; creates/drops a unique database. No hosted connection.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import unittest
import uuid

from backend.supabase.tests import test_admin_evaluation_read_helpers as helpers

ROOT = helpers.ROOT
MIGRATION = ROOT / 'backend/supabase/migrations/20261004192657_admin_evaluation_raw_warning_groups.sql'
NODE = os.environ.get('TZUDONG_TEST_NODE', '/opt/homebrew/opt/node@24/bin/node')
NODE_PROGRAM = r"""
import {registerHooks} from 'node:module';
import {existsSync,readFileSync} from 'node:fs';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const base=process.cwd();
registerHooks({resolve(specifier,context,next){
 let path=specifier.startsWith('@/')?resolve(base,specifier.slice(2)):
 specifier.startsWith('.')&&context.parentURL?.startsWith('file:')?resolve(dirname(fileURLToPath(context.parentURL)),specifier):null;
 if(path&&!existsSync(path)&&existsSync(path+'.ts'))path+='.ts';
 return next(path?pathToFileURL(path).href:specifier,context);
}});
const {normalizeEvaluationRecord,withAdminEvaluationDisplayName}=await import('./lib/admin/normalize-evaluation-record.ts');
const {EvaluationWarningAdaptiveCodec}=await import('./lib/admin/evaluation-warning-adaptive-codec.ts');
const EvaluationRawWarningGroups=EvaluationWarningAdaptiveCodec;
const {EvaluationWarningStream}=await import('./lib/admin/evaluation-warning-stream.ts');
const {findSameVideoDuplicateWarningCandidates,formatSameVideoDuplicateWarning}=await import('./lib/admin-same-video-duplicate-warning.ts');
const {findRestaurantIdentityWarnings}=await import('./lib/admin-restaurant-identity-warning.ts');
const input=JSON.parse(readFileSync(0,'utf8'));
const normalize=row=>withAdminEvaluationDisplayName(normalizeEvaluationRecord(row));
const targets=input.targets.map(normalize);
const raw=()=>{const reader=new EvaluationRawWarningGroups(targets,input.batches[0].revision);for(const batch of input.batches)reader.add(batch);return reader.result();};
const stream=()=>{const readers=targets.map(target=>new EvaluationWarningStream(target));for(let offset=0;offset<input.rows.length;offset+=200){const rows=input.rows.slice(offset,offset+200).map(normalize);for(const reader of readers)reader.add(rows);}return Object.fromEntries(readers.map((reader,i)=>[targets[i].id,reader.result()]));};
const full=()=>{const rows=input.rows.map(normalize);return Object.fromEntries(targets.map(target=>{const all=findSameVideoDuplicateWarningCandidates(target,rows),candidates=all.slice(0,3);return [target.id,{sameVideo:{count:all.length,candidates,message:formatSameVideoDuplicateWarning(candidates,all.length)},identity:findRestaurantIdentityWarnings(target,rows)}]}));};
const start=performance.now(),cpu=process.cpuUsage();
const result=input.mode==='raw'?raw():input.mode==='stream'?stream():full();
const elapsed=performance.now()-start,used=process.cpuUsage(cpu);
if(input.mode==='compare'){assert.deepEqual(raw(),result);assert.deepEqual(stream(),result);}
console.log(JSON.stringify({digest:createHash('sha256').update(JSON.stringify(result)).digest('hex'),wallMs:elapsed,cpuMs:(used.user+used.system)/1000,maxRssKiB:process.resourceUsage().maxRSS,node:process.versions.node,icu:process.versions.icu,unicode:process.versions.unicode,targets:targets.length,rows:input.rows.length,groups:input.batches[0].totalGroups,requests:input.batches.length,bytes:input.batches.reduce((n,b)=>n+Buffer.byteLength(JSON.stringify(b)),0)}));
"""


@unittest.skipUnless(os.environ.get('TZUDONG_ADMIN_READ_HELPERS_PG') == '1', 'owned PG opt-in required')
class RawWarningGroupTests(unittest.TestCase):
    cleanup = classmethod(helpers.AdminReadHelperTests.cleanup.__func__)

    @classmethod
    def setUpClass(cls):
        helpers.AdminReadHelperTests.setUpClass.__func__(cls)
        with cls.conn.cursor() as cursor:
            # Capture existing index and ACL before the forward-only repair.
            link = 'https://youtu.be/' + 'A' * 129 + ' https://youtu.be/VALID_TOKEN'
            cursor.execute("INSERT INTO public.restaurants(id,youtube_link) VALUES(%s,%s)", (str(uuid.UUID(int=1)), link))
            cursor.execute("SELECT md5(jsonb_agg(to_jsonb(r) ORDER BY id)::text) FROM public.restaurants r")
            cls.before_rows = cursor.fetchone()[0]
            cursor.execute("SELECT video FROM pipeline_control.admin_evaluation_read_index")
            cls.before_video = cursor.fetchone()[0]
            cursor.execute("SELECT proacl::text FROM pg_proc WHERE oid='pipeline_control.admin_eval_video_id(text)'::regprocedure")
            cls.before_acl = cursor.fetchone()[0]
            cursor.execute('SELECT public.admin_evaluation_revision()'); cls.before_revision = cursor.fetchone()[0]
            cursor.execute(MIGRATION.read_text())
            cursor.execute("SELECT md5(jsonb_agg(to_jsonb(r) ORDER BY id)::text) FROM public.restaurants r")
            cls.after_rows = cursor.fetchone()[0]
            cursor.execute("SELECT video,descriptor->>'video' FROM pipeline_control.admin_evaluation_read_index")
            cls.after_video = cursor.fetchone()
            cursor.execute("SELECT proacl::text FROM pg_proc WHERE oid='pipeline_control.admin_eval_video_id(text)'::regprocedure")
            cls.after_acl = cursor.fetchone()[0]
            cursor.execute('SELECT public.admin_evaluation_revision()'); cls.after_revision = cursor.fetchone()[0]

    def setUp(self):
        with self.conn.cursor() as cursor: cursor.execute('TRUNCATE public.restaurants')

    @staticmethod
    def row(number, **changes):
        return {'id': str(uuid.UUID(int=number + 1)), 'origin_name': '같은 식당', 'approved_name': '같은 식당',
                'status': 'pending', 'created_at': '2026-01-01T00:00:00Z',
                'youtube_link': 'https://youtu.be/ABCDEFGHIJK', **changes}

    def insert(self, rows):
        from psycopg2.extras import Json
        with self.conn.cursor() as cursor:
            cursor.execute('INSERT INTO public.restaurants SELECT * FROM jsonb_populate_recordset(NULL::public.restaurants,%s)', (Json(rows),))

    def batch(self, ids, revision=None, after=None, size=1000):
        from psycopg2.extras import Json
        with self.conn.cursor() as cursor:
            cursor.execute('SET ROLE service_role')
            try:
                if revision is None:
                    cursor.execute('SELECT public.admin_evaluation_revision()'); revision = cursor.fetchone()[0]
                cursor.execute('SELECT public.admin_evaluation_raw_warning_groups(%s::uuid[],%s,%s,%s)', (ids, revision, Json(after) if after is not None else None, size))
                return cursor.fetchone()[0]
            finally: cursor.execute('RESET ROLE')

    def payload(self, ids, size=1000):
        batches = [self.batch(ids, size=size)]
        while batches[-1]['hasMore']:
            batches.append(self.batch(ids, batches[0]['revision'], batches[-1]['cursor'], size))
        with self.conn.cursor() as cursor:
            cursor.execute('SELECT to_jsonb(r) FROM public.admin_evaluation_related_rows r WHERE video_id IN (SELECT video FROM pipeline_control.admin_evaluation_read_index WHERE id=ANY(%s::uuid[])) ORDER BY created_at DESC,id ASC', (ids,))
            rows = [row[0] for row in cursor.fetchall()]
            cursor.execute('SELECT pipeline_control.admin_eval_row(r) FROM public.restaurants r WHERE id=ANY(%s::uuid[]) ORDER BY id', (ids,))
            targets = [row[0] for row in cursor.fetchall()]
        # Independently reconstruct raw equality classes and every sample's
        # global order from actual view rows, including self membership.
        expected={}
        for order,row in enumerate(rows,1):
            attrs={key:value for key,value in row.items() if key not in ['id','created_at','video_id']}
            key=json.dumps(attrs,sort_keys=True,ensure_ascii=False)
            expected.setdefault(key,[]).append({'id':row['id'],'sourceOrder':order})
        if batches[0]['mode']=='grouped':
            observed={}
            for batch in batches:
                for group in batch['groups']:
                    key=json.dumps(group['attrs'],sort_keys=True,ensure_ascii=False)
                    self.assertNotIn(key,observed);observed[key]=group
                    actual=expected[key]
                    self.assertEqual(group['count'],len(actual));self.assertEqual(group['samples'],actual[:4])
                    self.assertEqual(group['firstOrder'],actual[0]['sourceOrder'])
                    self.assertEqual(group['selfIds'],sorted(row['id'] for row in actual if row['id'] in ids))
            self.assertEqual(set(observed),set(expected))
        else:
            fields=['id','created_at','video_id','approved_name','origin_name','naver_name','google_name','phone','status','road_address','jibun_address','youtube_link','updated_by_admin_id','lat','lng','evaluation_results','name']
            decoded=[dict(zip(fields,tuple,strict=True)) for batch in batches for tuple in batch['tuples']]
            self.assertEqual(decoded,rows)
        return {'targets': targets, 'rows': rows, 'batches': batches}

    @staticmethod
    def node(payload, mode='compare'):
        result = subprocess.run([NODE, '--experimental-transform-types', '--input-type=module', '-e', NODE_PROGRAM],
                                cwd=ROOT/'apps/web', input=json.dumps({**payload, 'mode': mode}), capture_output=True, text=True)
        if result.returncode: raise AssertionError(result.stderr[-12000:])
        return json.loads(result.stdout)

    def test_forward_video_repair_preserves_rows_acl_and_advances_revision(self):
        self.assertEqual(self.before_video, 'A' * 129)
        self.assertEqual(self.after_video, ('VALID_TOKEN', 'VALID_TOKEN'))
        self.assertEqual(self.before_rows, self.after_rows)
        self.assertEqual(self.before_acl, self.after_acl)
        self.assertEqual(int(self.after_revision), int(self.before_revision) + 1)
        prefixes = ['?v=', 'youtu.be/', 'youtube.com/shorts/', 'youtube.com/embed/', 'youtube.com/live/']
        links = [prefix + 'A' * length + suffix for prefix in prefixes for length in [5,6,128,129,256]
                 for suffix in ['', ' ' + prefix + 'SECOND_VALID', ' https://youtu.be/FALLBACK_VALID']]
        links += ['elsewhere/shorts/ABCDEF', '?v='+'A'*129+'&v=VALID_TOKEN', 'youtu.be/BEFORE_VALID ?v=AFTER_VALID']
        code = "const {extractVideoIdFromYoutubeLink}=await import('./lib/dashboard/helpers.ts');console.log(JSON.stringify(JSON.parse(require('fs').readFileSync(0,'utf8')).map(extractVideoIdFromYoutubeLink)));"
        # No aliases are needed for this leaf module.
        code = code.replace("require('fs').readFileSync", "(await import('node:fs')).readFileSync")
        values = json.loads(subprocess.run([NODE, '--input-type=module', '-e', code], cwd=ROOT/'apps/web', input=json.dumps(links), capture_output=True, text=True, check=True).stdout)
        with self.conn.cursor() as cursor:
            for link, expected in zip(links, values):
                cursor.execute('SELECT pipeline_control.admin_eval_video_id(%s)', (link,)); self.assertEqual(cursor.fetchone()[0], expected)
        self.insert([self.row(0, youtube_link=links[-2])])
        with self.conn.cursor() as cursor:
            cursor.execute("SELECT video,descriptor->>'video' FROM pipeline_control.admin_evaluation_read_index")
            self.assertEqual(cursor.fetchone(), ('VALID_TOKEN','VALID_TOKEN'))
        with self.assertRaisesRegex(self.driver.Error, 'EVALUATION_CURSOR_STALE'): self.batch([self.row(0)['id']], self.before_revision)

    def test_group_counts_interleaved_ties_self_and_deleted_union_match_full_reference(self):
        rows = [self.row(i, phone='02-123-4567' if i % 2 else None, status='deleted' if i % 7 == 0 else 'pending') for i in range(4000)]
        self.insert(rows)
        payload = self.payload([row['id'] for row in rows[:30]], size=1)
        self.assertEqual(payload['batches'][0]['totalGroups'], 4)
        self.assertEqual(payload['batches'][0]['totalRows'], 4000)
        self.assertEqual(sum(group['count'] for b in payload['batches'] for group in b['groups']), 4000)
        self.node(payload)

    def test_unicode_float_display_and_raw_byte_separation_match_full_reference(self):
        names = ['\U0001ccd6','A','Ａ','a\u0897','\u0378','İSTANBUL','ΟΣ','😀식당','😁식당','A\u0315\u0300',
                 '각','각','é','e\u0301','같은 식당(추정)','같은식당 본점','a:b','ab','same\x01place','① 식당','ㄱㅏ','𐐀식당']
        rows = []
        for name in names:
            for state in range(4):
                rows.append(self.row(len(rows), origin_name=name, approved_name=name if state != 2 else None,
                                     naver_name=name + ' 본점', phone='０２-１２３４５６７' if state % 2 else '02-1234567',
                                     lat=37, lng=127, status='deleted' if state == 3 else 'pending',
                                     evaluation_results={'location_match_TF': {'eval_value': state == 2, 'naver_name': name, 'matched_provider': 'naver', 'matched_name': name}}))
        # Neighbours immediately around 20m, poles, dateline, extreme finite
        # values and non-finite Postgres float strings all stay in the JS path.
        import math
        edge = 20 / 6371000 * 180 / math.pi
        for value in [math.nextafter(edge, 0), edge, math.nextafter(edge, math.inf), -edge, 90, -90, 181, 1e300]:
            rows.append(self.row(len(rows), approved_name='abcdefghijklmnX', origin_name='abcdefghijklmnX', lat=value, lng=0))
        rows.append(self.row(len(rows), approved_name='abcdefghijklmnY', origin_name='abcdefghijklmnY', lat=0, lng=0))
        self.insert(rows)
        with self.conn.cursor() as cursor:
            cursor.execute("UPDATE public.restaurants SET lat='NaN'::float8 WHERE id=%s", (rows[-2]['id'],))
        payload = self.payload([row['id'] for row in rows], size=7)
        self.node(payload)
        attrs = [row['origin_name'] for row in payload['rows']]
        self.assertIn('é',attrs); self.assertIn('e\u0301',attrs)

    def test_revision_admission_cursor_and_invoker_permissions(self):
        rows = [self.row(i, phone=str(i)) for i in range(201)]; self.insert(rows)
        ids = [rows[0]['id']]; first = self.batch(ids, size=1)
        for args in [(ids, first['revision'], 50000, 1), (ids, first['revision'], None, 1001), (ids * 2, first['revision'], None, 1), (ids, first['revision'], {**first['cursor'],'offset':2},1), (ids, first['revision'],{**first['cursor'],'mode':'other'},1)]:
            with self.assertRaisesRegex(self.driver.Error,'EVALUATION_QUERY_INVALID'): self.batch(*args)
        for role in ['anon','authenticated']:
            with self.conn.cursor() as cursor:
                cursor.execute('SET ROLE '+role)
                try:
                    with self.assertRaises(self.driver.Error): cursor.execute('SELECT public.admin_evaluation_raw_warning_groups(%s::uuid[],%s)', (ids,first['revision']))
                finally: cursor.execute('RESET ROLE')
        with self.conn.cursor() as cursor:
            cursor.execute("SELECT prosecdef,proconfig FROM pg_proc WHERE oid='public.admin_evaluation_raw_warning_groups(uuid[],text,jsonb,integer)'::regprocedure")
            self.assertEqual(cursor.fetchone(), (False,['search_path=""']))
            cursor.execute("UPDATE public.restaurants SET phone='changed' WHERE id=%s", (ids[0],))
        with self.assertRaisesRegex(self.driver.Error,'EVALUATION_CURSOR_STALE'): self.batch(ids,first['revision'],first['cursor'])

    def test_adaptive_byte_packing_and_oversize_refusal(self):
        rows = [self.row(i, phone=str(i), road_address='가' * 40000) for i in range(201)]; self.insert(rows)
        payload = self.payload([rows[0]['id']])
        self.assertGreater(len(payload['batches']),1)
        self.assertLess(len(payload['batches'][0]['tuples']),1000)
        for batch in payload['batches']: self.assertLessEqual(len(json.dumps(batch,ensure_ascii=False).encode()),2097152)
        self.node(payload)
        with self.conn.cursor() as cursor: cursor.execute("UPDATE public.restaurants SET road_address=repeat('x',1048577) WHERE id=%s",(rows[0]['id'],))
        with self.assertRaisesRegex(self.driver.Error,'EVALUATION_WARNING_RAW_CAPACITY_EXCEEDED'): self.batch([rows[0]['id']])

    def test_exact_sql_microseconds_nulls_ties_and_bound_cursor(self):
        times=[None,'2026-01-01T00:00:00.000001Z','2026-01-01T00:00:00.000002Z','2026-01-01T00:00:00Z','infinity','-infinity']
        rows=[self.row(i,phone=str(i),created_at=times[i%len(times)]) for i in range(205)]
        self.insert(rows); ids=[row['id'] for row in rows[:5]]
        payload=self.payload(ids,size=7); self.node(payload)
        self.assertEqual(payload['batches'][0]['mode'],'flat')
        first=payload['batches'][0]
        for change in [{'afterCreated':'2026-01-01T00:00:00Z'},{'offset':8},{'pageIds':[rows[10]['id']]},{'revision':'0'},{'mode':None},{'afterId':rows[20]['id']}]:
            with self.assertRaisesRegex(self.driver.Error,'EVALUATION_QUERY_INVALID'):
                self.batch(ids,first['revision'],{**first['cursor'],**change},7)

    def test_small_one_request_density_boundary_and_small_oversize(self):
        rows=[self.row(i,phone=str(i)) for i in range(200)];self.insert(rows)
        payload=self.payload([rows[0]['id']],size=1)
        self.assertEqual(len(payload['batches']),1);self.assertEqual(len(payload['batches'][0]['tuples']),200);self.node(payload)
        with self.conn.cursor() as cursor:cursor.execute("UPDATE public.restaurants SET road_address=repeat('x',11000)")
        with self.assertRaisesRegex(self.driver.Error,'EVALUATION_WARNING_RAW_CAPACITY_EXCEEDED'):self.batch([rows[0]['id']])
        self.setUp();rows=[self.row(i,phone=str(i%10)) for i in range(1000)];self.insert(rows)
        payload=self.payload([rows[0]['id']],size=3);self.assertEqual(payload['batches'][0]['mode'],'grouped');self.node(payload)
        with self.conn.cursor() as cursor:cursor.execute("UPDATE public.restaurants SET phone='new group' WHERE id=%s",(rows[-1]['id'],))
        payload=self.payload([rows[0]['id']],size=301);self.assertEqual(payload['batches'][0]['mode'],'flat');self.node(payload)

    @unittest.skipUnless(os.environ.get('TZUDONG_UNICODE17_FIXTURES'), 'hash-pinned Unicode 17 vectors required')
    def test_all_unicode17_normalization_source_vectors_use_node_reference(self):
        path=Path(os.environ['TZUDONG_UNICODE17_FIXTURES'])/'NormalizationTest.txt'
        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),'5019ffd530751a741900c849c0e010332f142a3612234639bd200b82138a87db')
        names=[]
        for line in path.read_text().splitlines():
            content=line.split('#')[0].strip()
            if not content or content.startswith('@'):continue
            names.append(''.join(chr(int(value,16)) for value in content.split(';')[0].split()))
        self.assertEqual(len(names),20034)
        rows=[self.row(i,approved_name=name,origin_name=name,status='deleted' if i%17==0 else 'pending') for i,name in enumerate(names)]
        self.insert(rows)
        positions=sorted(set(list(range(50))+list(range(0,len(rows),401))+list(range(len(rows)-50,len(rows)))))
        result=self.node(self.payload([rows[i]['id'] for i in positions]))
        self.assertEqual(result['rows'],20034)
        self.assertEqual(result['unicode'],'17.0')


if __name__ == '__main__': unittest.main()
