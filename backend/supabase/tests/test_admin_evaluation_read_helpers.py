"""Compare actual PG normalization with the shared TypeScript implementation."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import unittest
import uuid

ROOT=Path(__file__).resolve().parents[3]
SOURCE=ROOT/'backend/supabase/migrations/20261003212017_admin_evaluation_read_helpers.sql'


@unittest.skipUnless(os.environ.get('TZUDONG_ADMIN_READ_HELPERS_PG')=='1','owned PG opt-in required')
class AdminReadHelperTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import psycopg2
        cls.driver=psycopg2
        socket=os.environ['TZUDONG_TEST_PG_SOCKET']
        if not socket.startswith('/'):raise ValueError('absolute_owned_socket_required')
        cls.args={'host':socket,'port':int(os.environ.get('TZUDONG_TEST_PG_PORT','18797')),'user':'postgres'}
        cls.admin=psycopg2.connect(dbname='postgres',**cls.args);cls.admin.autocommit=True
        cls.db='admin_read_'+uuid.uuid4().hex
        with cls.admin.cursor() as cursor:cursor.execute('CREATE DATABASE '+cls.db+" TEMPLATE template0 ENCODING 'UTF8'")
        cls.addClassCleanup(cls.cleanup)
        cls.conn=psycopg2.connect(dbname=cls.db,**cls.args);cls.conn.autocommit=True
        cls.conn.set_client_encoding('UTF8')
        with cls.conn.cursor() as cursor:
            cursor.execute('CREATE SCHEMA pipeline_control; GRANT USAGE ON SCHEMA pipeline_control TO service_role;')
            cursor.execute('CREATE SCHEMA privacy_retention; CREATE TABLE privacy_retention.g014_public_rpc_allowlist(function_schema name,function_name name,identity_arguments text,grantee name,source_signature text,UNIQUE(source_signature,grantee));')
            cursor.execute((ROOT/'backend/supabase/migrations/20260124_create_restaurants.sql').read_text())
            cursor.execute('ALTER TABLE public.restaurants ADD COLUMN google_name text; GRANT SELECT ON public.restaurants TO service_role;')
            cursor.execute((ROOT/'backend/supabase/migrations/20261002235102_admin_evaluation_pagination.sql').read_text())
            cursor.execute(SOURCE.read_text())
            cursor.execute((ROOT/'backend/supabase/migrations/20261003215116_admin_evaluation_keyset_queries.sql').read_text())
            cursor.execute((ROOT/'backend/supabase/migrations/20261004003503_admin_evaluation_display_revision.sql').read_text())

    @classmethod
    def cleanup(cls):
        if hasattr(cls,'conn'):cls.conn.close()
        with cls.admin.cursor() as cursor:cursor.execute('DROP DATABASE '+cls.db+' WITH(FORCE)')
        cls.admin.close()

    def test_normalized_metrics_match_typescript_for_valid_and_corrupt_inputs(self):
        bun=os.environ.get('TZUDONG_TEST_BUN') or shutil.which('bun')
        if not bun:raise RuntimeError('pinned_bun_required')
        code='''import {parseEvaluationResults} from './lib/admin/normalize-evaluation-record.ts';
const cases=[null,[],{},'invalid'];
const keys=['visit_authenticity','rb_inference_score','review_faithfulness_score','rb_grounding_TF','category_TF','category_validity_TF'];
for(const key of keys)for(const value of [null,{},[],{eval_value:1},{eval_value:true},{eval_value:'1'},{eval_value:false,eval_basis:3},{eval_value:true,category_revision:4},{eval_value:true,category_revision:null,eval_basis:'proof'}])cases.push({[key]:value});
for(const value of [null,{},[],{eval_value:true,match_status:'matched',evidence_families:['source_geo','provider_candidate'],pending_reason:null,matched_provider:'naver'},
{eval_value:3,match_status:'other',evidence_families:['unknown'],evidence_summary:['x',null]},
{evidence_families:{bad:1},naver_address:'invalid',matched_address:{roadAddress:'street',x:1,y:null},second_pass:{attempted:true,provider:null,duration_ms:5,timed_out:2}},
{evidence_summary:[],evidence_families:[],naver_address:[{}],second_pass:null,matched_address:null,falseMessage:null}])cases.push({location_match_TF:value});
console.log(JSON.stringify(cases.map(input=>({input,expected:parseEvaluationResults(input)}))));'''
        values=json.loads(subprocess.run([bun,'-e',code],cwd=ROOT/'apps/web',capture_output=True,text=True,check=True).stdout)
        with self.conn.cursor() as cursor:
            cursor.execute('SET ROLE service_role')
            for value in values:
                with self.subTest(input=value['input']):
                    cursor.execute('SELECT pipeline_control.admin_eval_metrics(%s::jsonb)',(json.dumps(value['input']),))
                    self.assertEqual(cursor.fetchone()[0],value['expected'])
            cursor.execute('RESET ROLE')
        self.assertEqual(len(values),65)

    def test_browser_roles_cannot_call_private_read_helpers(self):
        for role in ['anon','authenticated']:
            with self.conn.cursor() as cursor:
                cursor.execute('SET ROLE '+role)
                with self.assertRaises(self.driver.Error):cursor.execute("SELECT pipeline_control.admin_eval_metrics('{}'::jsonb)")
                cursor.execute('RESET ROLE')

    def test_status_flags_match_the_shared_consumer_even_for_overlap_states(self):
        bun=os.environ.get('TZUDONG_TEST_BUN') or shutil.which('bun')
        code='''import {normalizeEvaluationRecord} from './lib/admin/normalize-evaluation-record.ts';
import {isAdminEvaluationRecordMissing,isAdminEvaluationRecordNotSelected,isAdminEvaluationRecordReadyForApproval,isAdminEvaluationRecordUnconfirmedMapLocation} from './lib/admin/evaluation-records.ts';
const cases=[];const good={visit_authenticity:{eval_value:1},rb_inference_score:{eval_value:1},rb_grounding_TF:{eval_value:true},review_faithfulness_score:{eval_value:1},category_TF:{eval_value:true},category_validity_TF:{eval_value:true}};
for(const status of ['pending','approved','deleted','missing','geocoding_failed','not_selected','hold','unknown'])for(const reason of [null,'ambiguous_chain','multi_candidate','insufficient_evidence','unknown'])for(const is_missing of [false,true]){
const input={id:'fixture',status,is_missing,geocoding_success:true,evaluation_results:{...good,location_match_TF:{pending_reason:reason}}};const r=normalizeEvaluationRecord(input);
cases.push({input,expected:{status:r.status,missing:isAdminEvaluationRecordMissing(r),not_selected:isAdminEvaluationRecordNotSelected(r),ready_for_approval:isAdminEvaluationRecordReadyForApproval(r),unconfirmed_map:isAdminEvaluationRecordUnconfirmedMapLocation(r)}});}
console.log(JSON.stringify(cases));'''
        values=json.loads(subprocess.run([bun,'-e',code],cwd=ROOT/'apps/web',capture_output=True,text=True,check=True).stdout)
        with self.conn.cursor() as cursor:
            cursor.execute('SET ROLE service_role')
            for value in values:
                with self.subTest(input=value['input']):
                    cursor.execute('SELECT pipeline_control.admin_eval_flags(%s::jsonb)',(json.dumps(value['input']),))
                    self.assertEqual(cursor.fetchone()[0],value['expected'])
            cursor.execute('RESET ROLE')
        self.assertEqual(len(values),80)

    def test_display_names_match_normalized_typescript_alias_and_branch_rules(self):
        bun=os.environ.get('TZUDONG_TEST_BUN') or shutil.which('bun')
        code='''import {normalizeEvaluationRecord,withAdminEvaluationDisplayName} from './lib/admin/normalize-evaluation-record.ts';
const cases=[];const names=['같은 식당','같은식당 본점','식당(현) 같은식당','ＴＥＳＴ 본점','다른 식당','같은식당 서울역점','같은 식당 · 2호점'];
for(const origin of names)for(const candidate of names)for(const passed of [false,true]){
const input={id:'fixture',origin_name:origin,naver_name:candidate,evaluation_results:{location_match_TF:{eval_value:passed,match_status:passed?'matched':'failed',matched_provider:'naver',matched_name:candidate}}};
cases.push({input,expected:withAdminEvaluationDisplayName(normalizeEvaluationRecord(input)).restaurant_name});}
console.log(JSON.stringify(cases));'''
        cases=json.loads(subprocess.run([bun,'-e',code],cwd=ROOT/'apps/web',capture_output=True,text=True,check=True).stdout)
        with self.conn.cursor() as cursor:
            for case in cases:
                with self.subTest(input=case['input']):
                    cursor.execute('SELECT pipeline_control.admin_eval_display_name(%s::jsonb)',(json.dumps(case['input']),))
                    self.assertEqual(cursor.fetchone()[0],case['expected'])
        self.assertEqual(len(cases),98)

    def test_address_status_matches_geocode_recovery_and_risk_gates(self):
        bun=os.environ.get('TZUDONG_TEST_BUN') or shutil.which('bun')
        code='''import {normalizeEvaluationRecord,withAdminEvaluationDisplayName} from './lib/admin/normalize-evaluation-record.ts';
import {getAddressConsistencyStatus} from './lib/admin-address-consistency.ts';
const cases=[];for(const geo of [null,false,true])for(const stage of [null,0,1])for(const reason of [null,'insufficient_evidence','ambiguous_chain','unknown'])for(const review of [null,{queue:'geocode_recovered_review'},{ahp_score:99,ahp_label:'정정 승인 후보',evidence_families:['provider_candidate','source_geo']},{ahp_score:99,reason_ko:'폐업 확인',evidence_families:['provider_candidate','source_geo']}]){
const input={id:'fixture',status:'pending',origin_name:'같은 식당',naver_name:'같은식당',geocoding_success:geo,geocoding_false_stage:stage,
db_error_details:{address_consistency_review:review},evaluation_results:{location_match_TF:{pending_reason:reason}}};
const record=withAdminEvaluationDisplayName(normalizeEvaluationRecord(input));cases.push({input,expected:getAddressConsistencyStatus(record)});}
console.log(JSON.stringify(cases));'''
        cases=json.loads(subprocess.run([bun,'-e',code],cwd=ROOT/'apps/web',capture_output=True,text=True,check=True).stdout)
        with self.conn.cursor() as cursor:
            for case in cases:
                with self.subTest(input=case['input']):
                    cursor.execute('SELECT pipeline_control.admin_eval_address_status(%s::jsonb)',(json.dumps(case['input']),))
                    self.assertEqual(cursor.fetchone()[0],case['expected'])
        self.assertEqual(len(cases),144)

    def test_keyset_pages_use_full_statistics_and_live_revision(self):
        from psycopg2.extras import Json
        rows=[{'id':str(uuid.uuid4()),'origin_name':'식당 '+str(i),'approved_name':'식당 '+str(i),'created_at':'2026-01-01T00:00:00Z',
               'status':'approved' if i==0 else 'pending','youtube_link':'https://youtu.be/ABCDEFGHIJK'} for i in range(121)]
        query={'searchQuery':'','evalFilters':{},'deepLinkFilter':None}
        with self.conn.cursor() as cursor:
            cursor.execute('TRUNCATE public.restaurants')
            cursor.execute('INSERT INTO public.restaurants SELECT * FROM jsonb_populate_recordset(NULL::public.restaurants,%s)',(Json(rows),))
            cursor.execute('SET ROLE service_role')
            cursor.execute('SELECT public.admin_evaluation_page(%s,50,NULL,NULL)',(Json(query),))
            first=cursor.fetchone()[0]
            self.assertEqual(len(first['records']),50);self.assertEqual(first['stats']['total'],121)
            self.assertEqual(first['stats']['approved'],1);self.assertEqual(first['filteredTotal'],121)
            ids=[row['id'] for row in first['records']];page=first
            while page['hasMore']:
                cursor.execute('SELECT public.admin_evaluation_page(%s,50,%s,%s)',(Json(query),page['afterId'],first['revision']))
                page=cursor.fetchone()[0];ids.extend(row['id'] for row in page['records'])
            self.assertEqual(len(ids),121);self.assertEqual(len(set(ids)),121)
            self.assertEqual(ids,sorted([row['id'] for row in rows],reverse=True))
            cursor.execute('RESET ROLE');cursor.execute("UPDATE public.restaurants SET origin_name='변경' WHERE id=%s",(ids[0],));cursor.execute('SET ROLE service_role')
            with self.assertRaisesRegex(self.driver.Error,'EVALUATION_CURSOR_STALE'):
                cursor.execute('SELECT public.admin_evaluation_page(%s,50,%s,%s)',(Json(query),first['afterId'],first['revision']))
            cursor.execute('RESET ROLE');cursor.execute('DELETE FROM public.restaurants WHERE id=%s',(ids[0],))
            cursor.execute('SELECT count(*) FROM pipeline_control.admin_evaluation_read_index');self.assertEqual(cursor.fetchone()[0],120)
            cursor.execute('TRUNCATE public.restaurants');cursor.execute('SELECT count(*) FROM pipeline_control.admin_evaluation_read_index');self.assertEqual(cursor.fetchone()[0],0)

    def test_numeric_filters_follow_javascript_radix_rounding_and_whitespace(self):
        bun=os.environ['TZUDONG_TEST_BUN']
        code="""const values=['0x2','-0Xff','+0x1','0x','01','1e3','2tail','1.00000000000000001','.3suffix','-0.2e2','1e',' 4','\\u00a02','\\ufeff3','Infinity','NaN','1e9999'];console.log(JSON.stringify(values.flatMap(value=>[false,true].map(fraction=>({value,fraction,expected:fraction?parseFloat(value):parseInt(value)})))));"""
        cases=json.loads(subprocess.run([bun,'-e',code],cwd=ROOT/'apps/web',capture_output=True,text=True,check=True).stdout)
        with self.conn.cursor() as cursor:
            cursor.execute('SET ROLE service_role')
            for case in cases:
                cursor.execute('SELECT pipeline_control.admin_eval_filter_number(%s,%s)',(case['value'],case['fraction']))
                self.assertEqual(cursor.fetchone()[0],case['expected'])
            cursor.execute('RESET ROLE')

    def test_page_rpc_rejects_every_browser_role_and_invalid_query_shape(self):
        from psycopg2.extras import Json
        good={'searchQuery':'','evalFilters':{},'deepLinkFilter':None}
        for role in ['anon','authenticated']:
            with self.conn.cursor() as cursor:
                cursor.execute('SET ROLE '+role)
                with self.assertRaises(self.driver.Error):cursor.execute('SELECT public.admin_evaluation_page(%s,50,NULL,NULL)',(Json(good),))
                with self.assertRaises(self.driver.Error):cursor.execute('SELECT * FROM public.admin_evaluation_related_rows LIMIT 1')
                cursor.execute('RESET ROLE')
        with self.conn.cursor() as cursor:
            cursor.execute('SET ROLE service_role')
            for bad in [None,[],{},dict(good,searchQuery=3),dict(good,evalFilters=[]),dict(good,evalFilters={'unknown':'1'}),dict(good,evalFilters={'status':True}),dict(good,deepLinkFilter=[]),dict(good,deepLinkFilter={'videoId':1})]:
                with self.assertRaisesRegex(self.driver.Error,'EVALUATION_QUERY_INVALID'):cursor.execute('SELECT public.admin_evaluation_page(%s,50,NULL,NULL)',(Json(bad),))
            for size in [None,0,201]:
                with self.assertRaisesRegex(self.driver.Error,'EVALUATION_QUERY_INVALID'):cursor.execute('SELECT public.admin_evaluation_page(%s,%s,NULL,NULL)',(Json(good),size))
            cursor.execute('RESET ROLE')

    def test_keyset_explain_uses_the_ordered_index(self):
        from psycopg2.extras import Json
        query={'searchQuery':'','evalFilters':{},'deepLinkFilter':None}
        with self.conn.cursor() as cursor:
            # Tiny fixtures otherwise rationally use a sequential scan. This proves
            # index eligibility, not that a real workload is faster.
            cursor.execute('SET enable_seqscan=off')
            cursor.execute('EXPLAIN(FORMAT JSON) SELECT id FROM pipeline_control.admin_evaluation_read_index WHERE pipeline_control.admin_eval_matches(descriptor,%s) ORDER BY latest DESC,created DESC,id DESC LIMIT 51',(Json(query),))
            plan=cursor.fetchone()[0]
            self.assertIn('admin_evaluation_read_keyset',json.dumps(plan))
            cursor.execute('RESET enable_seqscan')

    def test_epoch_special_values_fail_closed_and_iso_offsets_are_stable(self):
        with self.conn.cursor() as cursor:
            for value in [None,'','now','today','tomorrow','yesterday','infinity','-infinity','epoch','invalid']:
                cursor.execute('SELECT pipeline_control.admin_eval_epoch(%s)',(value,));self.assertEqual(cursor.fetchone()[0],0)
            cursor.execute("SELECT pipeline_control.admin_eval_epoch('2026-01-01T09:00:00+09:00')=pipeline_control.admin_eval_epoch('2026-01-01T00:00:00Z')")
            self.assertTrue(cursor.fetchone()[0])

    def test_review_count_and_timestamp_updates_invalidate_cached_pages(self):
        with self.conn.cursor() as cursor:
            cursor.execute("INSERT INTO public.restaurants(id,origin_name) VALUES(%s,'fixture') RETURNING id",(str(uuid.uuid4()),));row_id=cursor.fetchone()[0]
            cursor.execute('SELECT public.admin_evaluation_revision()');before=cursor.fetchone()[0]
            cursor.execute('UPDATE public.restaurants SET review_count=review_count+1,updated_at=now() WHERE id=%s',(row_id,))
            cursor.execute('SELECT public.admin_evaluation_revision()');self.assertNotEqual(cursor.fetchone()[0],before)
            cursor.execute('SELECT public.admin_evaluation_revision()');before=cursor.fetchone()[0]
            cursor.execute('UPDATE public.restaurants SET search_count=search_count+1 WHERE id=%s',(row_id,))
            cursor.execute('SELECT public.admin_evaluation_revision()');self.assertEqual(cursor.fetchone()[0],before)


if __name__=='__main__':unittest.main()
