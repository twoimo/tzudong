-- Parent-owned PG15 only: BEGIN; this file; exact migration; assertions; ROLLBACK.
-- No account fixture, remote connection or migration-ledger mutation is needed.
DO $$ BEGIN
 IF current_setting('server_version_num')::integer NOT BETWEEN 150000 AND 159999 THEN
  RAISE EXCEPTION 'SPONSORSHIP_TEST_REQUIRES_PG15';
 END IF;
END $$;
CREATE TEMP TABLE sponsorship_business_before ON COMMIT DROP AS
 SELECT id,pipeline_control.admin_record_hash(to_jsonb(r)) AS fingerprint
 FROM public.restaurants r;
CREATE TEMP TABLE sponsorship_index_before ON COMMIT DROP AS
 SELECT id,pipeline_control.admin_record_hash(to_jsonb(i)) AS fingerprint
 FROM pipeline_control.admin_evaluation_read_index i;
CREATE TEMP TABLE sponsorship_affected_before ON COMMIT DROP AS
 SELECT id FROM public.restaurants r
 WHERE coalesce(jsonb_typeof(youtube_meta)='object'
  AND jsonb_typeof(youtube_meta->'title')='string' AND jsonb_typeof(youtube_meta->'publishedAt')='string'
  AND jsonb_typeof(youtube_meta->'duration')='number' AND jsonb_typeof(youtube_meta->'is_shorts')='boolean',false)
 AND NOT pipeline_control.admin_eval_valid_meta(youtube_meta);
CREATE TEMP TABLE sponsorship_functions_before ON COMMIT DROP AS
 SELECT oid,proowner,proacl,prosecdef,proconfig,provolatile,proparallel,proisstrict FROM pg_proc
 WHERE oid IN ('pipeline_control.admin_eval_valid_meta(jsonb)'::regprocedure,
               'pipeline_control.admin_record_compose(jsonb,jsonb)'::regprocedure,
               'public.admin_record_action(uuid,text,uuid,text,uuid[],jsonb,text)'::regprocedure);
CREATE TEMP TABLE sponsorship_tables_before ON COMMIT DROP AS
 SELECT c.oid,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','pipeline_control') AND c.relkind IN ('r','p');
CREATE TEMP TABLE sponsorship_policies_before ON COMMIT DROP AS SELECT to_jsonb(p) AS value FROM pg_policy p;
