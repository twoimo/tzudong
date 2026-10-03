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
        with cls.admin.cursor() as cursor:cursor.execute('CREATE DATABASE '+cls.db+' TEMPLATE template0')
        cls.addClassCleanup(cls.cleanup)
        cls.conn=psycopg2.connect(dbname=cls.db,**cls.args);cls.conn.autocommit=True
        with cls.conn.cursor() as cursor:
            cursor.execute('CREATE SCHEMA pipeline_control; GRANT USAGE ON SCHEMA pipeline_control TO service_role;')
            cursor.execute(SOURCE.read_text())

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


if __name__=='__main__':unittest.main()
