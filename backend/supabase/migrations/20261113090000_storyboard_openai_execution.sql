-- Explicit OpenAI API execution support. Applied Gemini migrations remain immutable.
BEGIN;
ALTER TABLE public.admin_storyboard_production_projects
  DROP CONSTRAINT admin_storyboard_production_projects_request_workflow_check;
ALTER TABLE public.admin_storyboard_production_projects
  ADD CONSTRAINT admin_storyboard_production_projects_request_workflow_check CHECK (
    jsonb_typeof(request) = 'object' AND octet_length(request::text) <= 65536
    AND (
      request->>'workflow' = 'storyboard-mlx-v1'
      OR (
        request->>'workflow' = 'storyboard-gemini-v1'
        AND (request#>>'{providers,externalAI}' = 'true') IS TRUE
        AND ((request#>>'{providers,text,id}' = 'gemini-api' AND request#>>'{providers,text,model}' = 'gemini-3.8-flash')
          OR (request#>>'{providers,text,id}' = 'openai-api' AND request#>>'{providers,text,model}' = 'gpt-5.6-luna')) IS TRUE
        AND ((request#>>'{providers,image,id}' = 'gemini-api' AND request#>>'{providers,image,model}' IN ('gemini-3.1-flash-image','gemini-3-pro-image'))
          OR (request#>>'{providers,image,id}' = 'openai-api' AND request#>>'{providers,image,model}' = 'gpt-image-2.6-flare')) IS TRUE
      )
    )
  );

CREATE OR REPLACE FUNCTION public.storyboard_production_model_available(p_models jsonb, p_model text, p_capability text)
RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p_models,'[]')) model
    WHERE model->>'id' = p_model AND model->'capabilities' ? p_capability AND (
      (model->>'owned_by' = 'gemini-api' AND ((p_capability = 'chat' AND p_model = 'gemini-3.8-flash')
        OR (p_capability = 'image' AND p_model IN ('gemini-3.1-flash-image','gemini-3-pro-image'))))
      OR (model->>'owned_by' = 'openai-api' AND ((p_capability = 'chat' AND p_model = 'gpt-5.6-luna')
        OR (p_capability = 'image' AND p_model = 'gpt-image-2.6-flare')))))
$$;

-- Preserve existing function security metadata and patch only reviewed provider guards.
DO $openai_admin$
DECLARE target oid; definition text; before_meta jsonb; after_meta jsonb; old text; replacement text; n integer;
BEGIN
  target := pg_catalog.to_regprocedure('public.storyboard_production_admin(uuid,text,uuid,integer,jsonb)');
  SELECT pg_catalog.pg_get_functiondef(p.oid), jsonb_build_array(p.proowner,p.proacl,p.prosecdef,p.proconfig,p.provolatile,p.proparallel)
    INTO definition,before_meta FROM pg_catalog.pg_proc p WHERE p.oid=target AND p.proowner='postgres'::pg_catalog.regrole
    AND NOT p.prosecdef AND p.proconfig=ARRAY['search_path=""']::text[];
  IF definition IS NULL THEN RAISE EXCEPTION 'STORYBOARD_OPENAI_ADMIN_SOURCE_DRIFT'; END IF;
  old := $old$    IF p_payload#>>'{providers,text,id}' IS DISTINCT FROM 'gemini-api'
      OR p_payload#>>'{providers,image,id}' IS DISTINCT FROM 'gemini-api'
      OR p_payload#>>'{providers,text,model}' IS DISTINCT FROM 'gemini-3.8-flash'
      OR coalesce(p_payload#>>'{providers,image,model}','') NOT IN ('gemini-3.1-flash-image','gemini-3-pro-image')
      THEN RAISE EXCEPTION 'provider_not_configured'; END IF;$old$;
  replacement := $new$    IF (((p_payload#>>'{providers,text,id}' = 'gemini-api' AND p_payload#>>'{providers,text,model}' = 'gemini-3.8-flash')
      OR (p_payload#>>'{providers,text,id}' = 'openai-api' AND p_payload#>>'{providers,text,model}' = 'gpt-5.6-luna')) IS NOT TRUE)
      OR (((p_payload#>>'{providers,image,id}' = 'gemini-api' AND p_payload#>>'{providers,image,model}' IN ('gemini-3.1-flash-image','gemini-3-pro-image'))
      OR (p_payload#>>'{providers,image,id}' = 'openai-api' AND p_payload#>>'{providers,image,model}' = 'gpt-image-2.6-flare')) IS NOT TRUE)
      THEN RAISE EXCEPTION 'provider_not_configured'; END IF;$new$;
  n := (length(definition)-length(replace(definition,old,'')))/length(old);
  IF n<>1 THEN RAISE EXCEPTION 'STORYBOARD_OPENAI_ADMIN_SOURCE_DRIFT'; END IF;
  definition := replace(definition,old,replacement);
  old := $old$    initial_status := CASE WHEN p_payload#>>'{providers,text,id}' = 'gemini-api' THEN 'waiting_worker' ELSE 'awaiting_import' END;$old$;
  replacement := $new$    initial_status := 'waiting_worker';$new$;
  n := (length(definition)-length(replace(definition,old,'')))/length(old);
  IF n<>1 THEN RAISE EXCEPTION 'STORYBOARD_OPENAI_ADMIN_SOURCE_DRIFT'; END IF;
  definition := replace(definition,old,replacement);
  old := $old$IF p_action IN ('retry','regenerate') OR (p_action = 'import-text' AND p.request#>>'{providers,image,id}' = 'gemini-api') THEN
    IF (p.document IS NULL AND p.request#>>'{providers,text,id}' <> 'gemini-api')
      OR (p.document IS NOT NULL AND p.request#>>'{providers,image,id}' <> 'gemini-api') THEN RAISE EXCEPTION 'nothing_to_retry'; END IF;$old$;
  replacement := $new$IF p_action IN ('retry','regenerate') OR (p_action = 'import-text' AND p.request#>>'{providers,image,id}' IN ('gemini-api','openai-api')) THEN
    IF (p.document IS NULL AND (p.request#>>'{providers,text,id}' IS DISTINCT FROM 'gemini-api' AND p.request#>>'{providers,text,id}' IS DISTINCT FROM 'openai-api'))
      OR (p.document IS NOT NULL AND (p.request#>>'{providers,image,id}' IS DISTINCT FROM 'gemini-api' AND p.request#>>'{providers,image,id}' IS DISTINCT FROM 'openai-api')) THEN RAISE EXCEPTION 'nothing_to_retry'; END IF;$new$;
  n := (length(definition)-length(replace(definition,old,'')))/length(old);
  IF n<>1 THEN RAISE EXCEPTION 'STORYBOARD_OPENAI_ADMIN_SOURCE_DRIFT'; END IF;
  definition := replace(definition,old,replacement);
  EXECUTE definition;
  SELECT jsonb_build_array(p.proowner,p.proacl,p.prosecdef,p.proconfig,p.provolatile,p.proparallel) INTO after_meta FROM pg_catalog.pg_proc p WHERE p.oid=target;
  IF after_meta IS DISTINCT FROM before_meta THEN RAISE EXCEPTION 'STORYBOARD_OPENAI_ADMIN_METADATA_DRIFT'; END IF;
END $openai_admin$;

DO $openai_worker$
DECLARE target oid; definition text; before_meta jsonb; after_meta jsonb; old text; replacement text; n integer;
BEGIN
  target := pg_catalog.to_regprocedure('public.storyboard_production_worker(uuid,text,uuid,uuid,jsonb)');
  SELECT pg_catalog.pg_get_functiondef(p.oid), jsonb_build_array(p.proowner,p.proacl,p.prosecdef,p.proconfig,p.provolatile,p.proparallel)
    INTO definition,before_meta FROM pg_catalog.pg_proc p WHERE p.oid=target AND p.proowner='postgres'::pg_catalog.regrole
    AND NOT p.prosecdef AND p.proconfig=ARRAY['search_path=""']::text[];
  IF definition IS NULL THEN RAISE EXCEPTION 'STORYBOARD_OPENAI_WORKER_SOURCE_DRIFT'; END IF;
  old := $old$      IF p.request#>>'{providers,text,id}' IS DISTINCT FROM 'gemini-api' OR p.request#>>'{providers,image,id}' IS DISTINCT FROM 'gemini-api' THEN CONTINUE; END IF;$old$;
  replacement := $new$      IF (((p.request#>>'{providers,text,id}' = 'gemini-api' AND p.request#>>'{providers,text,model}' = 'gemini-3.8-flash')
        OR (p.request#>>'{providers,text,id}' = 'openai-api' AND p.request#>>'{providers,text,model}' = 'gpt-5.6-luna')) IS NOT TRUE)
        OR (((p.request#>>'{providers,image,id}' = 'gemini-api' AND p.request#>>'{providers,image,model}' IN ('gemini-3.1-flash-image','gemini-3-pro-image'))
        OR (p.request#>>'{providers,image,id}' = 'openai-api' AND p.request#>>'{providers,image,model}' = 'gpt-image-2.6-flare')) IS NOT TRUE) THEN CONTINUE; END IF;$new$;
  n := (length(definition)-length(replace(definition,old,'')))/length(old);
  IF n<>1 THEN RAISE EXCEPTION 'STORYBOARD_OPENAI_WORKER_SOURCE_DRIFT'; END IF;
  definition := replace(definition,old,replacement);
  old := $old$      AND q.request#>>'{providers,text,id}' = 'gemini-api'$old$;
  replacement := $new$      AND (((q.request#>>'{providers,text,id}' = 'gemini-api' AND q.request#>>'{providers,text,model}' = 'gemini-3.8-flash')
        OR (q.request#>>'{providers,text,id}' = 'openai-api' AND q.request#>>'{providers,text,model}' = 'gpt-5.6-luna')) IS TRUE)$new$;
  n := (length(definition)-length(replace(definition,old,'')))/length(old);
  IF n<>1 THEN RAISE EXCEPTION 'STORYBOARD_OPENAI_WORKER_SOURCE_DRIFT'; END IF;
  definition := replace(definition,old,replacement);
  old := $old$      AND q.request#>>'{providers,image,id}' = 'gemini-api'$old$;
  replacement := $new$      AND (((q.request#>>'{providers,image,id}' = 'gemini-api' AND q.request#>>'{providers,image,model}' IN ('gemini-3.1-flash-image','gemini-3-pro-image'))
        OR (q.request#>>'{providers,image,id}' = 'openai-api' AND q.request#>>'{providers,image,model}' = 'gpt-image-2.6-flare')) IS TRUE)$new$;
  n := (length(definition)-length(replace(definition,old,'')))/length(old);
  IF n<>1 THEN RAISE EXCEPTION 'STORYBOARD_OPENAI_WORKER_SOURCE_DRIFT'; END IF;
  definition := replace(definition,old,replacement);
  old := $old$      IF p.document IS NULL THEN
        IF p.request#>>'{providers,text,id}' <> 'gemini-api'
          OR NOT public.storyboard_production_model_available(w.models,p.request#>>'{providers,text,model}','chat') THEN CONTINUE; END IF;
      END IF;
      IF p.request#>>'{providers,image,id}' = 'gemini-api' THEN
        IF NOT public.storyboard_production_model_available(w.models,p.request#>>'{providers,image,model}','image') THEN CONTINUE; END IF;
      ELSIF p.document IS NOT NULL THEN CONTINUE;
      END IF;$old$;
  replacement := $new$      IF p.document IS NULL AND NOT public.storyboard_production_model_available(w.models,p.request#>>'{providers,text,model}','chat') THEN CONTINUE; END IF;
      IF NOT public.storyboard_production_model_available(w.models,p.request#>>'{providers,image,model}','image') THEN CONTINUE; END IF;$new$;
  n := (length(definition)-length(replace(definition,old,'')))/length(old);
  IF n<>1 THEN RAISE EXCEPTION 'STORYBOARD_OPENAI_WORKER_SOURCE_DRIFT'; END IF;
  definition := replace(definition,old,replacement);
  old := $old$IF p_payload#>>'{provenance,providerId}' IS DISTINCT FROM 'gemini-api'
      OR p_payload#>>'{provenance,verification}' IS DISTINCT FROM 'official-api'
      OR p_payload#>>'{provenance,modelEvidence}' IS DISTINCT FROM 'response'
      OR nullif(p_payload#>>'{provenance,responseModel}','') IS NULL
      OR (p_payload#>>'{provenance,responseModel}' IS DISTINCT FROM p_payload#>>'{provenance,model}'
        AND p_payload#>>'{provenance,responseModel}' !~ ('^' || replace(p_payload#>>'{provenance,model}', '.', '[.]') || '-([0-9]{3}|[0-9]{2}-[0-9]{2})$'))
      OR p_payload#>>'{provenance,model}' IS DISTINCT FROM p.request#>>ARRAY['providers',(CASE WHEN p_action = 'draft' THEN 'text' ELSE 'image' END),'model']
      OR NOT public.storyboard_production_model_available(w.models,p_payload#>>'{provenance,model}',CASE WHEN p_action = 'draft' THEN 'chat' ELSE 'image' END)
      THEN RAISE EXCEPTION 'model_identity_mismatch'; END IF;$old$;
  replacement := $new$IF p_payload#>>'{provenance,providerId}' IS DISTINCT FROM p.request#>>ARRAY['providers',(CASE WHEN p_action = 'draft' THEN 'text' ELSE 'image' END),'id']
      OR p_payload#>>'{provenance,verification}' IS DISTINCT FROM 'official-api'
      OR p_payload#>>'{provenance,model}' IS DISTINCT FROM p.request#>>ARRAY['providers',(CASE WHEN p_action = 'draft' THEN 'text' ELSE 'image' END),'model']
      OR NOT public.storyboard_production_model_available(w.models,p_payload#>>'{provenance,model}',CASE WHEN p_action = 'draft' THEN 'chat' ELSE 'image' END)
      OR (p_payload#>>'{provenance,providerId}' = 'gemini-api' AND (p_payload#>>'{provenance,modelEvidence}' IS DISTINCT FROM 'response'
        OR nullif(p_payload#>>'{provenance,responseModel}','') IS NULL
        OR (p_payload#>>'{provenance,responseModel}' IS DISTINCT FROM p_payload#>>'{provenance,model}'
          AND p_payload#>>'{provenance,responseModel}' !~ ('^' || replace(p_payload#>>'{provenance,model}', '.', '[.]') || '-([0-9]{3}|[0-9]{2}-[0-9]{2})$'))))
      OR (p_payload#>>'{provenance,providerId}' = 'openai-api' AND ((p_action = 'draft' AND
        (p_payload#>>'{provenance,modelEvidence}' IS DISTINCT FROM 'response' OR nullif(p_payload#>>'{provenance,responseModel}','') IS NULL
          OR (p_payload#>>'{provenance,responseModel}' IS DISTINCT FROM p_payload#>>'{provenance,model}'
            AND p_payload#>>'{provenance,responseModel}' !~ ('^' || replace(p_payload#>>'{provenance,model}', '.', '[.]') || '-([0-9]{4}-[0-9]{2}-[0-9]{2})$'))))
        OR (p_action = 'image' AND (p_payload#>>'{provenance,modelEvidence}' IS DISTINCT FROM 'installed-catalog-and-request'
          OR p_payload#>>'{provenance,responseModel}' IS NOT NULL))))
      THEN RAISE EXCEPTION 'model_identity_mismatch'; END IF;$new$;
  n := (length(definition)-length(replace(definition,old,'')))/length(old);
  IF n<>1 THEN RAISE EXCEPTION 'STORYBOARD_OPENAI_WORKER_SOURCE_DRIFT'; END IF;
  definition := replace(definition,old,replacement);
  old := $old$IF p.document IS NOT NULL OR j.kind <> 'generate' OR p.request#>>'{providers,text,id}' <> 'gemini-api' THEN RAISE EXCEPTION 'revision_conflict'; END IF;$old$;
  replacement := $new$IF p.document IS NOT NULL OR j.kind <> 'generate' THEN RAISE EXCEPTION 'revision_conflict'; END IF;$new$;
  n := (length(definition)-length(replace(definition,old,'')))/length(old);
  IF n<>1 THEN RAISE EXCEPTION 'STORYBOARD_OPENAI_WORKER_SOURCE_DRIFT'; END IF;
  definition := replace(definition,old,replacement);
  old := $old$IF scene IS NULL OR p.request#>>'{providers,image,id}' <> 'gemini-api' THEN RAISE EXCEPTION 'invalid_scene'; END IF;$old$;
  replacement := $new$IF scene IS NULL OR (p.request#>>'{providers,image,id}' IS DISTINCT FROM 'gemini-api' AND p.request#>>'{providers,image,id}' IS DISTINCT FROM 'openai-api') THEN RAISE EXCEPTION 'invalid_scene'; END IF;$new$;
  n := (length(definition)-length(replace(definition,old,'')))/length(old);
  IF n<>1 THEN RAISE EXCEPTION 'STORYBOARD_OPENAI_WORKER_SOURCE_DRIFT'; END IF;
  definition := replace(definition,old,replacement);
  EXECUTE definition;
  SELECT jsonb_build_array(p.proowner,p.proacl,p.prosecdef,p.proconfig,p.provolatile,p.proparallel) INTO after_meta FROM pg_catalog.pg_proc p WHERE p.oid=target;
  IF after_meta IS DISTINCT FROM before_meta THEN RAISE EXCEPTION 'STORYBOARD_OPENAI_WORKER_METADATA_DRIFT'; END IF;
END $openai_worker$;
COMMIT;
