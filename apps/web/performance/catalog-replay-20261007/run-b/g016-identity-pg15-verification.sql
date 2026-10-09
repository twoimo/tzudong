BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
DO $existing_nonce_identity$
BEGIN
 IF session_user<>'postgres' OR current_user<>'postgres'
    OR current_setting('server_version_num')::integer/10000<>15 THEN
   RAISE EXCEPTION 'G016_IDENTITY_REPLAY_EXECUTOR_DENIED';
 END IF;
 IF to_regprocedure('public.confirm_privacy_onboarding(uuid,text,uuid,text,uuid)') IS NOT NULL
    OR NOT EXISTS(SELECT 1 FROM pg_proc p
      WHERE p.oid=to_regprocedure('public.confirm_privacy_onboarding(uuid,text,uuid,text,uuid,text)')
        AND p.proowner='privacy_workflow_owner'::regrole AND p.prosecdef
        AND p.proconfig=ARRAY['search_path=""']::text[] AND p.pronargs=6 AND p.pronargdefaults=0
        AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='b6a478e40bbb98fbd0d2e4a7993295000d33792093dcf0688b05b33f6363bf4e'
        AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
          WHERE a.grantee NOT IN (p.proowner,'service_role'::regrole) OR a.is_grantable))
    OR EXISTS(SELECT 1 FROM privacy_retention.g014_public_rpc_allowlist
      WHERE source_signature='public.confirm_privacy_onboarding(uuid,text,uuid,text,uuid)')
    OR NOT EXISTS(SELECT 1 FROM privacy_retention.g014_public_rpc_allowlist
      WHERE source_signature='public.confirm_privacy_onboarding(uuid,text,uuid,text,uuid,text)'
        AND function_schema='public' AND function_name='confirm_privacy_onboarding'
        AND grantee='service_role' AND identity_arguments='2950 25 2950 25 2950 25') THEN
   RAISE EXCEPTION 'G016_IDENTITY_REPLAY_CONTRACT_DRIFT';
 END IF;
END $existing_nonce_identity$;
SELECT '{"disposition": "verified-existing", "hosted_identity_correction_executed": false, "hosted_ledger_admission_verified": false, "predecessor_sha256": "2fae840485d86385b6a97cd588ea09c1db13fb700b2b0b7e044fb6b35698ecd3", "read_only": true, "required_hosted_ledger_count": 76, "required_hosted_pg_major": 17, "schema": "g016-identity-pg15-replay-v1", "source_sha256": "b8ca1f397f2645682c0a7fd8a0250027bb5978b34195ea69046a6d8984d9108f"}'::jsonb AS receipt;
COMMIT;
