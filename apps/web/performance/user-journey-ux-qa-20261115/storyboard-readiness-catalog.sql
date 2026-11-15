BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '3s';
SELECT jsonb_build_object(
 'reviews_table',pg_catalog.to_regclass('public.reviews') IS NOT NULL,
 'capability_marker_table',pg_catalog.to_regclass('ocr_private.feature_runtime_capability') IS NOT NULL,
 'receipt_results_table',pg_catalog.to_regclass('ocr_private.receipt_results') IS NOT NULL,
 'review_generations_table',pg_catalog.to_regclass('ocr_private.review_generations') IS NOT NULL,
 'public_readiness_rpc',pg_catalog.to_regprocedure('public.get_feature_runtime_capability(uuid)') IS NOT NULL,
 'private_readiness_rpc',pg_catalog.to_regprocedure('ocr_private.get_feature_runtime_capability(uuid)') IS NOT NULL,
 'generation_helper',pg_catalog.to_regprocedure('ocr_private.register_review_ocr_generation()') IS NOT NULL,
 'storage_update_guard',pg_catalog.to_regprocedure('review_media_private.reject_verification_object_update()') IS NOT NULL,
 'storage_delete_guard',pg_catalog.to_regprocedure('review_media_private.guard_verification_object_delete()') IS NOT NULL
) AS named_catalog_presence;
ROLLBACK;
