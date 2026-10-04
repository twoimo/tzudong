"""Actual PG17 classifier/evidence binding with synthetic rows only."""
import copy
import json
import os
from pathlib import Path
import unittest
import uuid

ROOT=Path(__file__).resolve().parents[3]
MIGRATION=ROOT/'backend/supabase/migrations/20261004010334_restaurant_review_identity_evidence.sql'


@unittest.skipUnless(os.environ.get('TZUDONG_REVIEW_IDENTITY_LOCAL_PG')=='1','owned private PG opt-in required')
class ReviewIdentityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import psycopg2
        cls.driver=psycopg2
        cls.params={'host':os.environ['TZUDONG_TEST_PG_SOCKET'],'port':int(os.environ.get('TZUDONG_TEST_PG_PORT','18797')),'user':'postgres'}
        cls.admin=psycopg2.connect(dbname='postgres',**cls.params);cls.admin.autocommit=True
        cls.db='identity_'+uuid.uuid4().hex
        with cls.admin.cursor() as c:c.execute('CREATE DATABASE '+cls.db+" ENCODING 'UTF8' TEMPLATE template0")
        cls.addClassCleanup(cls.cleanup)
        cls.conn=psycopg2.connect(dbname=cls.db,**cls.params);cls.conn.autocommit=True;cls.conn.set_client_encoding('UTF8')
        with cls.conn.cursor() as c:
            c.execute('CREATE SCHEMA pipeline_control;CREATE SCHEMA privacy_retention;GRANT USAGE ON SCHEMA pipeline_control,privacy_retention TO service_role;')
            c.execute('CREATE TABLE privacy_retention.g014_public_rpc_allowlist(function_schema name,function_name name,identity_arguments text,grantee name,source_signature text,UNIQUE(source_signature,grantee));')
            c.execute((ROOT/'backend/supabase/migrations/20260124_create_restaurants.sql').read_text())
            c.execute('ALTER TABLE public.restaurants ADD COLUMN google_name text;CREATE TABLE public.user_roles(user_id uuid,role text);CREATE TABLE public.user_account_status(user_id uuid,account_status text);GRANT SELECT,UPDATE ON public.restaurants TO service_role;')
            c.execute("CREATE FUNCTION public.extract_youtube_video_id(text) RETURNS text LANGUAGE sql IMMUTABLE AS 'SELECT nullif(split_part($1,''v='',2),'''')';CREATE FUNCTION public.normalize_restaurant_identity_name(text) RETURNS text LANGUAGE sql IMMUTABLE AS 'SELECT lower(btrim($1))';")
            c.execute((ROOT/'backend/supabase/migrations/20261003081915_restaurant_review_automation.sql').read_text())
            c.execute(MIGRATION.read_text())

    @classmethod
    def cleanup(cls):
        if hasattr(cls,'conn'):cls.conn.close()
        with cls.admin.cursor() as c:c.execute('DROP DATABASE '+cls.db+' WITH(FORCE)')
        cls.admin.close()

    def good(self):
        return {'id':str(uuid.uuid4()),'status':'pending','origin_name':'fixture branch','naver_name':'fixture branch','approved_name':'fixture branch',
                'lat':37.5,'lng':127,'geocoding_success':True,'jibun_address':'synthetic business address','categories':['한식'],'tzuyang_review':'fixture review',
                'trace_id':uuid.uuid4().hex,'youtube_link':'https://www.youtube.com/watch?v=ABCDEFGHIJK','evaluation_results':{
                    **{key:{'eval_value':1,'eval_basis':'fixture evidence'} for key in ['visit_authenticity','rb_inference_score','review_faithfulness_score']},
                    **{key:{'eval_value':True,'eval_basis':'fixture evidence'} for key in ['rb_grounding_TF','category_validity_TF','category_TF']},
                    'location_match_TF':{'origin_name':'fixture branch','eval_value':True,'match_status':'matched','evidence_families':['source_geo','provider_candidate']}}}

    def scalar(self,sql,args=()):
        with self.conn.cursor() as c:c.execute(sql,args);return c.fetchone()[0]

    def test_missing_misattached_or_nonstrings_never_approve(self):
        from psycopg2.extras import Json
        good=self.good();self.assertEqual(self.scalar('SELECT pipeline_control.restaurant_review_classify(%s)',(Json(good),)),'approve:all_checks_passed')
        for value in [None,'another branch',3,{},'']:
            row=copy.deepcopy(good);row['evaluation_results']['location_match_TF']['origin_name']=value
            self.assertEqual(self.scalar('SELECT pipeline_control.restaurant_review_classify(%s)',(Json(row),)),'hold:location_identity_mismatch')

    def test_deleted_history_does_not_block_replacement_but_active_duplicates_do(self):
        from psycopg2.extras import Json
        row=self.good();other=copy.deepcopy(row);other.update(id=str(uuid.uuid4()),trace_id=uuid.uuid4().hex,status='deleted')
        with self.conn.cursor() as c:
            c.execute('TRUNCATE public.restaurants')
            c.execute('INSERT INTO public.restaurants SELECT * FROM jsonb_populate_record(NULL::public.restaurants,%s)',(Json(other),))
        self.assertEqual(self.scalar('SELECT pipeline_control.restaurant_review_decision(%s)',(Json(row),)),'approve:all_checks_passed')
        with self.conn.cursor() as c:c.execute("UPDATE public.restaurants SET status='approved' WHERE id=%s",(other['id'],))
        self.assertEqual(self.scalar('SELECT pipeline_control.restaurant_review_decision(%s)',(Json(row),)),'hold:duplicate_requires_review')

    def test_acl_owner_invoker_and_drift_rollback_are_preserved(self):
        for name in ['classify','decision']:
            with self.conn.cursor() as c:
                c.execute("SELECT pg_get_userbyid(proowner),prosecdef,proconfig,has_function_privilege('anon',oid,'EXECUTE'),has_function_privilege('authenticated',oid,'EXECUTE'),has_function_privilege('service_role',oid,'EXECUTE') FROM pg_proc WHERE oid=%s::regprocedure",('pipeline_control.restaurant_review_'+name+'(jsonb)',))
                self.assertEqual(c.fetchone(),('postgres',False,['search_path=""'],False,False,True))
        with self.conn.cursor() as c:
            # Applying the guarded patch a second time rejects changed source and
            # leaves both current definitions intact after rollback.
            c.execute("SELECT md5(prosrc) FROM pg_proc WHERE oid='pipeline_control.restaurant_review_classify(jsonb)'::regprocedure");before=c.fetchone()[0]
            with self.assertRaisesRegex(self.driver.Error,'SOURCE_DRIFT'):c.execute(MIGRATION.read_text())
            c.execute('ROLLBACK')
            c.execute("SELECT md5(prosrc) FROM pg_proc WHERE oid='pipeline_control.restaurant_review_classify(jsonb)'::regprocedure");self.assertEqual(c.fetchone()[0],before)


if __name__=='__main__':unittest.main()
