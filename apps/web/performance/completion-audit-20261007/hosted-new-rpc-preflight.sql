BEGIN READ ONLY;
SET LOCAL statement_timeout='20s';
SET LOCAL lock_timeout='2s';
WITH wanted(signature) AS (VALUES
('public.admin_record_action(uuid,text,uuid,text,uuid[],jsonb,text)'),
('public.admin_evaluation_raw_warning_groups(uuid[],text,jsonb,integer)'),
('public.approve_submission_item(uuid,uuid,jsonb)'),
('public.approve_edit_submission_item(uuid,uuid,jsonb)'),
('public.merge_restaurant_records_for_admin_review(uuid,uuid,uuid,timestamptz,text,jsonb,text,text)'),
('privacy_retention.assert_g014_public_rpc_allowlist()'),
('privacy_retention.assert_g014_definer_contract()'),
('privacy_retention.assert_g014_catalog_contract()'),
('public.restaurant_review_automation_tick(uuid)'))
SELECT jsonb_build_object(
'observedAt',clock_timestamp(),'serverVersion',current_setting('server_version'),'readOnly',current_setting('transaction_read_only'),
'currentUser',current_user,'sessionUser',session_user,
'ledger',(SELECT jsonb_build_object('count',count(*),'versions',jsonb_agg(version ORDER BY version),
'sha256',encode(sha256(convert_to(jsonb_agg(jsonb_build_object('version',version,'name',name,'statementsArraySha256',encode(sha256(convert_to(to_json(statements)::text,'UTF8')),'hex')) ORDER BY version)::text,'UTF8')),'hex')) FROM supabase_migrations.schema_migrations),
'functions',(SELECT jsonb_agg(jsonb_build_object('signature',w.signature,'present',p.oid IS NOT NULL,'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'config',p.proconfig,'acl',p.proacl::text[],'bodySha256',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex'),'metadataSha256',encode(sha256(convert_to((to_jsonb(p)-'prosrc')::text,'UTF8')),'hex'),'anonExecute',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticatedExecute',has_function_privilege('authenticated',p.oid,'EXECUTE'),'serviceExecute',has_function_privilege('service_role',p.oid,'EXECUTE')) ORDER BY w.signature) FROM wanted w LEFT JOIN pg_proc p ON p.oid=to_regprocedure(w.signature)),
'assertionNames',(SELECT jsonb_agg(p.proname ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='privacy_retention' AND p.proname LIKE 'assert_g014_%'),
'membershipSha256',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor)::text,'[]'),'UTF8')),'hex') FROM pg_auth_members m),
'ownerMembership',jsonb_build_object('usage',pg_has_role('postgres','privacy_workflow_owner','USAGE'),'set',pg_has_role('postgres','privacy_workflow_owner','SET')),
'policy',(SELECT jsonb_build_object('enabled',enabled,'version',version,'batchSize',batch_size,'dailyLimit',daily_limit,'lastRunAt',last_run_at) FROM pipeline_control.restaurant_review_policy WHERE singleton),
'queueCounts',(SELECT jsonb_object_agg(state,count) FROM (SELECT state,count(*) count FROM pipeline_control.restaurant_review_items GROUP BY state) x),
'restaurantCount',(SELECT count(*) FROM public.restaurants),
'restaurantRowsNewlineSha256',(SELECT encode(sha256(convert_to(coalesce(string_agg(to_jsonb(r)::text,E'\n' ORDER BY id),''),'UTF8')),'hex') FROM public.restaurants r)
) AS state;
ROLLBACK;
