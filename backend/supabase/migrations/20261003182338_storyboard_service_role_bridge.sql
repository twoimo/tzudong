-- Additive convergence for the original 202609 chain and the applied 202610 receipts.
-- Existing tables, assets, leases, results and restore history remain untouched.
BEGIN;
DO $prerequisites$
DECLARE relation text;
BEGIN
  FOREACH relation IN ARRAY ARRAY['projects','workers','jobs','assets','events','revisions','restores'] LOOP
    IF pg_catalog.to_regclass('public.admin_storyboard_production_'||relation) IS NULL
      THEN RAISE EXCEPTION 'STORYBOARD_BRIDGE_PREREQUISITE_MISSING'; END IF;
  END LOOP;
END;
$prerequisites$;
CREATE SCHEMA IF NOT EXISTS storyboard_control;
REVOKE ALL ON SCHEMA storyboard_control FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA storyboard_control TO service_role;
CREATE OR REPLACE FUNCTION storyboard_control.assert_owner(p_owner_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles r JOIN public.user_account_status s USING (user_id)
    WHERE r.user_id=p_owner_id AND r.role='admin' AND s.account_status='active') THEN
    RAISE EXCEPTION 'owner_forbidden';
  END IF;
END;
$$;
ALTER FUNCTION storyboard_control.assert_owner(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION storyboard_control.assert_owner(uuid) FROM PUBLIC,anon,authenticated,privacy_workflow_owner;
GRANT EXECUTE ON FUNCTION storyboard_control.assert_owner(uuid) TO service_role;

DO $bridge$
DECLARE signature text; target oid; definition text; body text; owner name; relation text;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.storyboard_production_error_allowed(text)',
    'public.storyboard_production_final_status(jsonb,jsonb)',
    'public.storyboard_production_project_json(public.admin_storyboard_production_projects)',
    'public.storyboard_production_job_json(public.admin_storyboard_production_jobs)',
    'public.storyboard_production_snapshot(uuid,uuid)',
    'public.storyboard_production_auth_worker(text)',
    'public.storyboard_production_model_available(jsonb,text,text)',
    'public.storyboard_production_admin(uuid,text,uuid,integer,jsonb)',
    'public.storyboard_production_worker(uuid,text,uuid,uuid,jsonb)'
  ] LOOP
    target:=pg_catalog.to_regprocedure(signature);
    SELECT pg_catalog.pg_get_functiondef(p.oid),p.prosrc,pg_catalog.pg_get_userbyid(p.proowner)
      INTO definition,body,owner FROM pg_catalog.pg_proc p WHERE p.oid=target;
    IF definition IS NULL OR owner NOT IN ('postgres','privacy_workflow_owner')
      THEN RAISE EXCEPTION 'STORYBOARD_BRIDGE_FUNCTION_DRIFT'; END IF;
    IF NOT EXISTS (SELECT 1 FROM (VALUES
    ('public.storyboard_production_admin',ARRAY['44707552b5ee639315d40eb5935bd26c84be7b39bc3b616fe2d7b81789542cb3','5ff7cecf9bf7461185dcbbbc3ee1e7cbf2e89398c048d6062177d6ee011fc402','6caeecf07d823c378e53d159d939d74234fb6ff5f70609084b0e8715da706d04','8c35a0cb95f2a53b9667d1d86dd74753d64747fa269ba5bb9f02b3b7576dfbaa','b918832c65a21fa14af6aeaaaa7000eff5ed61e0380f08e609087f6afae99481']::text[]),
    ('public.storyboard_production_auth_worker',ARRAY['e8d3e32c9cc8126c6ee4810593615499181a70e4592ba9513bd933be93a91713','efe732f819266c2f269afd53d81913da8c90f5fb439563839ce24fb92f56a2b8']::text[]),
    ('public.storyboard_production_error_allowed',ARRAY['3c9a8ac552cc4d54c59e122f469c31480ca4510786cb23b5504b5bc0d4c709cd','7859477cb7c1464feb87a51d63fa7e646f513f8101b57cea6f6af7b2aca1ff9c']::text[]),
    ('public.storyboard_production_final_status',ARRAY['f79bc1f1354cfce2c933f6a2f83398a9f15f25cad6bdb9dd27e7f981fe859521']::text[]),
    ('public.storyboard_production_job_json',ARRAY['0144a5c433a2b999de7b3907bbbd5b1c480874aa55ce13005be7e36280011fac']::text[]),
    ('public.storyboard_production_model_available',ARRAY['265abc1b3ab8d5cda52217df7ce07b1a4812ac526f749b96b978da0c26a4f96f','8b5c236692d8b47ab5420ffdc570e4587a2f29119038b2fcdf74c5a1afc7963e']::text[]),
    ('public.storyboard_production_project_json',ARRAY['eb2b74b1abefd72d5280f5c4ad05c9b5dcf3df12cb42b26fd37c29f00582a1bb']::text[]),
    ('public.storyboard_production_snapshot',ARRAY['6341df75d2cab6719f017c284c4e23ee3010fbd17e13fd85c16039c6b5397fda']::text[]),
    ('public.storyboard_production_worker',ARRAY['10a0bbce773e6ecc69f944b07407d12be2793f773f4ad1d504caa75b9102237e','2339bf7bf80c2649daca53c15ec79351a0ce5cd0d9b5710331ff97903572af97','8dfda7603b59534211b2b35336ac928481da056c7c2c568c3a06672c30dc510b','c51c73f27768001bd073da5ade60fc74734a93493c74a5c21eaa152d8d455c15','d8e7700765e0797d795da52398da55191f06d9f5443f8c0cddf6e9e75ee2c5e6']::text[])
    ) expected(name,hashes) WHERE expected.name=split_part(signature,'(',1)
      AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(body,'UTF8')),'hex')=ANY(expected.hashes))
      THEN RAISE EXCEPTION 'STORYBOARD_BRIDGE_BODY_DRIFT'; END IF;
    -- Preserve the installed action logic, including Gemini-only predicates and
    -- CAS checks. Change only the reference to the private operator checker.
    IF position('public.storyboard_production_assert_owner' in body)>0 THEN
      EXECUTE replace(definition,'public.storyboard_production_assert_owner','storyboard_control.assert_owner');
    END IF;
    EXECUTE 'ALTER FUNCTION '||signature||' SECURITY INVOKER';
    EXECUTE 'ALTER FUNCTION '||signature||' SET search_path='''' ';
    EXECUTE 'ALTER FUNCTION '||signature||' OWNER TO postgres';
    EXECUTE 'REVOKE ALL ON FUNCTION '||signature||' FROM PUBLIC,anon,authenticated,privacy_workflow_owner';
    EXECUTE 'GRANT EXECUTE ON FUNCTION '||signature||' TO service_role';
  END LOOP;
  -- These old owner policies served only the definer implementation. Browser
  -- roles still have no storyboard table grants; no client access is added.
  FOREACH relation IN ARRAY ARRAY['projects','workers','jobs','assets','events','revisions','restores'] LOOP
    EXECUTE 'DROP POLICY IF EXISTS storyboard_production_owner_access ON public.admin_storyboard_production_'||relation;
    EXECUTE 'REVOKE ALL ON public.admin_storyboard_production_'||relation||' FROM privacy_workflow_owner';
  END LOOP;
  REVOKE ALL ON SEQUENCE public.admin_storyboard_production_events_id_seq FROM privacy_workflow_owner;
  IF pg_catalog.to_regprocedure('public.storyboard_production_assert_owner(uuid)') IS NOT NULL THEN
    DROP FUNCTION public.storyboard_production_assert_owner(uuid);
  END IF;
  DELETE FROM privacy_retention.g014_public_rpc_allowlist WHERE source_signature='public.storyboard_production_assert_owner(uuid)';
END;
$bridge$;
COMMIT;
