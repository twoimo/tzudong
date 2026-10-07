-- Canonical category elements are required for automatic approval.
-- Preserve protected decisions, applied source and classifier ACLs.
BEGIN;
DO $category_contract$
DECLARE function_oid oid:='pipeline_control.restaurant_review_classify(jsonb)'::regprocedure;
 source text;before_meta jsonb;after_meta jsonb;
 anchor text:=$anchor$  IF jsonb_typeof(row_data->'categories') IS DISTINCT FROM 'array' OR jsonb_array_length(row_data->'categories')=0$anchor$;
 addition text:=$addition$  IF jsonb_typeof(row_data->'categories') IS DISTINCT FROM 'array' THEN RETURN 'hold:source_incomplete'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(row_data->'categories') category
    WHERE jsonb_typeof(category) IS DISTINCT FROM 'string'
      OR NOT ((category#>>'{}')=ANY(ARRAY['치킨','중식','돈까스·회','피자','패스트푸드','찜·탕','족발·보쌈','분식','카페·디저트','한식','고기','양식','아시안','야식','도시락']::text[])))
    THEN RETURN 'hold:source_incomplete'; END IF;
$addition$;
BEGIN
 SELECT prosrc,jsonb_build_array(proowner,proacl,proconfig,prosecdef,provolatile,proparallel) INTO source,before_meta
   FROM pg_proc WHERE oid=function_oid;
 IF md5(source)<>'4518c86c950d55f8c2bc48768c2fa7c1' OR (length(source)-length(replace(source,anchor,'')))<>length(anchor)
   THEN RAISE EXCEPTION 'REVIEW_CATEGORY_SOURCE_DRIFT'; END IF;
 EXECUTE replace(pg_get_functiondef(function_oid),anchor,addition||anchor);
 SELECT jsonb_build_array(proowner,proacl,proconfig,prosecdef,provolatile,proparallel) INTO after_meta FROM pg_proc WHERE oid=function_oid;
 IF after_meta IS DISTINCT FROM before_meta THEN RAISE EXCEPTION 'REVIEW_CATEGORY_METADATA_DRIFT'; END IF;
END;
$category_contract$;
COMMIT;
