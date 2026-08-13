#!/usr/bin/env python3
"""Fail-closed static verifier for the G026 source-only empty-replay bundle."""
import hashlib
import json
import re
import sys
from pathlib import Path, PurePosixPath, PureWindowsPath
import zipfile

ROOT = Path(__file__).resolve().parents[3]
BASE = ROOT / 'backend/supabase/baselines/historical/pre-20260214-application'
BUNDLE = BASE / 'G026_RECONSTRUCTION_BUNDLE.v4.json'
FUNCTIONS = (
    'approve_submission_item', 'approve_restaurant', 'approve_restaurant_submission',
    'approve_edit_submission_item', 'approve_new_restaurant_submission',
    'approve_edit_restaurant_submission',
    'cleanup_old_notifications', 'make_user_admin', 'refresh_materialized_views', 'reject_restaurant', 'reject_restaurant_submission', 'reject_submission', 'reject_submission_item',
    'insert_restaurant_from_jsonl', 'batch_insert_restaurants_from_jsonl',
)
TOP_KEYS = frozenset({
    'schemaVersion', 'purpose', 'reconstructionAuthorized',
    'reconstructionArchiveSha256', 'historicalSourceArchiveSha256',
    'transition', 'repairs', 'validationLedger', 'slots',
    'legacyShapeNormalization',
    'canonicalBodyHashes', 'apiMatrix', 'extensionFingerprint', 'adBanners', 'shortUrls',
    'storyboardBaseTables', 'userBookmarks', 'searchLogs', 'restaurantsDuplicate', 'adminWorkflowPipeline',
    'roleManagementReplayTransform', 'replayMembershipWindows', 'selfContainedReplay',
    'synthesizedCompatibilityBindings', 'obsoleteOverloadDrops',
})
ARCHIVE = '21a2b4b6050c05f405a158bf81287b56d4de349189abcb6419090f4dc54c3fc3'
HISTORICAL = '1b221e44a5a7de028a6a3eeec160562f7dc6172c6b7eb83c630a00c7149e5e11'
TRANSITION_BYTES = 36415
TRANSITION_SHA256 = 'ee1e2cd1219c56c162793aa1ecd46245e7683fc7d95c726bd2fe9a01f8a170bd'
APPROVE_RESTAURANT_PREDECESSOR = ROOT / 'backend/supabase/migrations/20260124_fix_approved_name_sync.sql'
SYNTHESIZED_COMPATIBILITY_NAMES = (
    'approve_restaurant_submission', 'approve_edit_restaurant_submission',
    'cleanup_old_notifications', 'make_user_admin', 'refresh_materialized_views',
    'reject_restaurant', 'reject_restaurant_submission', 'reject_submission',
    'reject_submission_item',
)
SYNTHESIZED_COMPATIBILITY_BODY_HASHES = {
    'approve_restaurant_submission': '50fc781758aae126d94ec96dfc0f847aa77ef30e3a3d8120762fad8650ed40d0',
    'approve_edit_restaurant_submission': '16c50e11f08c222ba3edb5ed4283ee0893ac41b014962804ddd5decd9e9e6ed6',
    'cleanup_old_notifications': 'e7e2fde8951a69f6da2d19e4629ddc9b42a9e1d5fa7dc927c4560827df78ff1a',
    'make_user_admin': 'fc24436da90bcee4a3072451a1a02ec7ff1f89429f222de780c191a7fd056c96',
    'refresh_materialized_views': '4655be2001c4cafd3f2d8713b110b2b7e727f00facfb816f079fa6449511bb2f',
    'reject_restaurant': '65a6d3a1ae6d5f40959471de0ac65d96a94e84cce77b5170b5e6cf40f25ad490',
    'reject_restaurant_submission': '65a6d3a1ae6d5f40959471de0ac65d96a94e84cce77b5170b5e6cf40f25ad490',
    'reject_submission': '65a6d3a1ae6d5f40959471de0ac65d96a94e84cce77b5170b5e6cf40f25ad490',
    'reject_submission_item': '65a6d3a1ae6d5f40959471de0ac65d96a94e84cce77b5170b5e6cf40f25ad490',
}
OBSOLETE_OVERLOAD_DROPS = (
    {
        'source': 'backend/supabase/migrations/20260124_create_restaurants.sql',
        'expectedIdentity': 'public.approve_restaurant(uuid)',
        'replacementIdentity': 'public.approve_restaurant(uuid,uuid)',
        'disposition': 'drop_obsolete_overload',
    },
    {
        'source': 'ordinal-0:20251107_create_user_notification.sql',
        'expectedIdentity': 'public.create_user_notification(uuid,public.notification_type,text,text,jsonb)',
        'replacementIdentity': 'public.create_user_notification(uuid,text,text,text,jsonb)',
        'disposition': 'drop_obsolete_overload',
    },
)

RECONSTRUCTION_POLICY_SHELLS = (
    '''CREATE POLICY "Restaurant requests select policy"
  ON public.restaurant_requests FOR SELECT USING (false);''',
    '''CREATE POLICY "Admins can delete submission items"
  ON public.restaurant_submission_items FOR DELETE USING (false);''',
    '''CREATE POLICY "Admins can update submission items"
  ON public.restaurant_submission_items FOR UPDATE USING (false);''',
    '''CREATE POLICY "Submission items insert policy"
  ON public.restaurant_submission_items FOR INSERT WITH CHECK (false);''',
    '''CREATE POLICY "Submission items select policy"
  ON public.restaurant_submission_items FOR SELECT USING (false);''',
    '''CREATE POLICY "Restaurant submissions select policy"
  ON public.restaurant_submissions FOR SELECT USING (false);''',
    '''CREATE POLICY "Admins can delete short URLs"
  ON public.short_urls FOR DELETE USING (false);''',
)
RECONSTRUCTION_POLICY_PRECONDITION_BYTES = 6728
RECONSTRUCTION_POLICY_PRECONDITION_SHA256 = '04cdc797e498f137a2785c3773f179fe18ed43cd9b517fa0ae3b44d541d55999'
RECONSTRUCTION_OBSOLETE_POLICY_DROPS = (
    'DROP POLICY "Admins can view all submissions" ON public.restaurant_submissions;',
    'DROP POLICY "Admins can manage all submission items" ON public.restaurant_submission_items;',
    'DROP POLICY "Announcements are viewable by everyone" ON public.announcements;',
    'DROP POLICY "Admins can manage announcements" ON public.announcements;',
)

ADMIN_WORKFLOW_SOURCE = {
    'path': 'backend/supabase/baselines/historical/20260310_admin_workflow_pipeline.sql',
    'byteLength': 5998,
    'sha256': '83acbf7f9ad5abf66de2aae7350db1a23a1f53d940336629252cdcb9d4f47a6e',
    'types': [
        'admin_workflow_trigger_source', 'admin_workflow_correlation_state',
        'admin_workflow_step_status',
    ],
    'tables': [
        'admin_workflow_runs', 'admin_workflow_steps', 'admin_workflow_signals',
    ],
    'indexes': [
        'idx_admin_workflow_runs_requested_at', 'idx_admin_workflow_runs_state',
        'idx_admin_workflow_runs_channel', 'idx_admin_workflow_steps_run',
        'idx_admin_workflow_steps_status', 'idx_admin_workflow_signals_run',
    ],
    'policies': [
        'admin_workflow_runs_select_admin', 'admin_workflow_steps_select_admin',
        'admin_workflow_signals_select_admin',
    ],
    'publicationTables': ['admin_workflow_runs', 'admin_workflow_steps'],
    'publicationExcluded': ['admin_workflow_signals'],
}
LEGACY_SHAPE_NORMALIZATION = {
    'kind': 'source_only_empty_clean_legacy_shape_normalization',
    'historicalProof': False,
    'hostedStateEvidence': False,
    'reconstructionSource': {
        'manifestPath': 'backend/supabase/baselines/historical/pre-20260214-application/RECONSTRUCTION_SOURCES.v1.json',
        'manifestByteLength': 5331,
        'manifestSha256': '1f87d2bb4d64b9c4771bacad881a8c6effdca072ba0b22732a8373123a6f836e',
        'archivePath': 'backend/supabase/baselines/historical/pre-20260214-application/RECONSTRUCTION_SOURCES.v1.zip',
        'archiveByteLength': 152235,
        'archiveSha256': '21a2b4b6050c05f405a158bf81287b56d4de349189abcb6419090f4dc54c3fc3',
        'ordinal': 0,
        'member': 'supabase/migrations/temp/20251107_complete_migration.sql',
        'sourceByteLength': 79793,
        'sourceSha256': '23de25dcbe84612ca032b680608d671ffdfa0a72eac44b823e8d001b59919f33',
    },
    'applicationPrerequisites': {
        'manifestPath': 'backend/supabase/baselines/local/APPLICATION_PREREQUISITES.v1.json',
        'manifestByteLength': 1252,
        'manifestSha256': '055d31e0d7597ec026e570eaf85adfb2c4a6c5480f80a3ed7a7ca525a6b2a9f3',
        'sourcePath': 'backend/supabase/baselines/pre-20260214-public-schema.sql',
        'sourceByteLength': 203938,
        'sourceSha256': '7660b1650c8cd974991437948d65e70cb7c8a65665a16eeb90162e0c2fe3e119',
        'outputPath': 'backend/supabase/baselines/local/application-prerequisites.sql',
        'outputByteLength': 210374,
        'outputSha256': '34e7904a4dfb271d811d433102e92c94aceff6528c751bf5b02f94c2a56f3d15',
    },
    'operations': [
        {
            'relation': 'public.profiles',
            'precondition': 'empty_exact_legacy_profile_picture_text_avatar_url_absent',
            'operation': 'rename_profile_picture_to_avatar_url',
            'postcondition': 'exact_target_avatar_url_text_profile_picture_absent',
        },
        {
            'relation': 'public.reviews',
            'precondition': 'empty_exact_legacy_base_like_count_absent',
            'operation': 'add_like_count_integer_not_null_default_zero_check_nonnegative',
            'postcondition': 'exact_target_like_count_default_and_validated_check',
        },
    ],
}
LEGACY_SHAPE_NORMALIZATION_LABEL = '-- G026 source-only Phase A legacy-shape normalization; not historical or hosted-state evidence.'
LEGACY_SHAPE_NORMALIZATION_BYTES = 8596
LEGACY_SHAPE_NORMALIZATION_SHA256 = '4681a8f777fa658dec2f76ab468658bb08a80fa0eefbe5e9a600a6ee3ad93abe'
PHASE_A_LEGACY_SHAPE_PREAMBLE_BYTES = 1030
PHASE_A_LEGACY_SHAPE_PREAMBLE_SHA256 = 'f817bc6833e8df6aafaa6d0501bf7232cf19c8141f6d43b473bfb8ae603773e6'
TRANSITION_OPERATOR = "to_regoperator('extensions.<=>(extensions.vector,extensions.vector)')"
PRIOR_SPACED_TRANSITION_OPERATOR = "to_regoperator('extensions.<=> (extensions.vector,extensions.vector)')"
REALTIME_PUBLICATION_ENVELOPE = """DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_publication AS publication
    WHERE publication.pubname = 'supabase_realtime'
  ) THEN
    RAISE EXCEPTION 'G026 realtime publication checkpoint failed: supabase_realtime is absent' USING ERRCODE='P0001';
  END IF;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_workflow_runs;
  EXCEPTION
    WHEN duplicate_object THEN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_publication_rel AS publication_relation
        JOIN pg_catalog.pg_publication AS publication ON publication.oid = publication_relation.prpubid
        WHERE publication.pubname = 'supabase_realtime'
          AND publication_relation.prrelid = 'public.admin_workflow_runs'::regclass
      ) THEN
        RAISE EXCEPTION 'G026 realtime publication membership checkpoint failed: duplicate admin_workflow_runs membership was not proven' USING ERRCODE='P0001';
      END IF;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_workflow_steps;
  EXCEPTION
    WHEN duplicate_object THEN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_publication_rel AS publication_relation
        JOIN pg_catalog.pg_publication AS publication ON publication.oid = publication_relation.prpubid
        WHERE publication.pubname = 'supabase_realtime'
          AND publication_relation.prrelid = 'public.admin_workflow_steps'::regclass
      ) THEN
        RAISE EXCEPTION 'G026 realtime publication membership checkpoint failed: duplicate admin_workflow_steps membership was not proven' USING ERRCODE='P0001';
      END IF;
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_publication_rel AS publication_relation
    JOIN pg_catalog.pg_publication AS publication ON publication.oid = publication_relation.prpubid
    WHERE publication.pubname = 'supabase_realtime'
      AND publication_relation.prrelid = 'public.admin_workflow_runs'::regclass
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_publication_rel AS publication_relation
    JOIN pg_catalog.pg_publication AS publication ON publication.oid = publication_relation.prpubid
    WHERE publication.pubname = 'supabase_realtime'
      AND publication_relation.prrelid = 'public.admin_workflow_steps'::regclass
  ) THEN
    RAISE EXCEPTION 'G026 realtime publication postcondition failed: required memberships are absent' USING ERRCODE='P0001';
  END IF;
END $$;"""
REQUIRED_RESTAURANT_COLUMNS = (
    'ALTER TABLE public.restaurants ADD COLUMN search_count integer DEFAULT 0;',
    'ALTER TABLE public.restaurants ADD COLUMN weekly_search_count integer DEFAULT 0;',
    'ALTER TABLE public.restaurants ADD COLUMN origin_name text;',
    'ALTER TABLE public.restaurants ADD COLUMN naver_name text;',
    'ALTER TABLE public.restaurants ADD COLUMN trace_id_name_source text;',
    'ALTER TABLE public.restaurants ADD COLUMN channel_name text;',
    'ALTER TABLE public.restaurants ADD COLUMN description_map_url text;',
    'ALTER TABLE public.restaurants ADD COLUMN recollect_version jsonb;',
)
EXTENSION_ASSERTION_MESSAGES = (
    'G026 extension capability checkpoint failed: vector namespace',
    'G026 extension capability checkpoint failed: fuzzystrmatch namespace',
    'G026 extension capability checkpoint failed: pgcrypto namespace',
    'G026 extension capability checkpoint failed: vector type',
    'G026 extension capability checkpoint failed: cosine operator',
    'G026 extension capability checkpoint failed: levenshtein(text,text)',
    'G026 extension capability checkpoint failed: digest(text,text)',
)
GENERIC_EXTENSION_ASSERTION = "RAISE EXCEPTION 'G026 extension capability checkpoint failed' USING"
AD_BANNERS_SOURCE = {
    'sourceArchive': 'HISTORICAL_SOURCES.v1.zip',
    'member': 'supabase/migrations/temp/20251229_create_ad_banners_table.sql',
    'byteLength': 3049,
    'sha256': 'dc4631c104dab83add16b459ab72f509bbf3647565f320dc942d76f64d4af7d4',
    'provenanceDelimiters': [
        '-- G026 provenance begin: HISTORICAL_SOURCES.v1.zip:supabase/migrations/temp/20251229_create_ad_banners_table.sql sha256=dc4631c104dab83add16b459ab72f509bbf3647565f320dc942d76f64d4af7d4',
        '-- G026 provenance end: exact historical member above',
    ],
    'seedRows': 3,
    'policies': [
        'ad_banners_select_active', 'ad_banners_select_admin',
        'ad_banners_insert_admin', 'ad_banners_update_admin',
        'ad_banners_delete_admin',
    ],
}
USER_BOOKMARKS_SOURCE = {
    'sourceArchive': 'HISTORICAL_SOURCES.v1.zip',
    'member': 'supabase/migrations/temp/20251226_user_bookmarks.sql',
    'blobSha1': '1dd4894d0367a2ab1b5791bba28dc982be801c0e',
    'byteLength': 1708,
    'sha256': 'accd6b079af87270a4768211a93a224e285b778c661b8d2b3e30b2c40806598d',
    'provenanceDelimiters': [
        '-- G026 provenance begin: HISTORICAL_SOURCES.v1.zip:supabase/migrations/temp/20251226_user_bookmarks.sql sha1=1dd4894d0367a2ab1b5791bba28dc982be801c0e sha256=accd6b079af87270a4768211a93a224e285b778c661b8d2b3e30b2c40806598d',
        '-- G026 provenance end: exact historical member above',
    ],
    'policies': ['Users can view their own bookmarks', 'Users can create their own bookmarks', 'Users can delete their own bookmarks'],
    'indexes': ['idx_user_bookmarks_user_id', 'idx_user_bookmarks_restaurant_id', 'idx_user_bookmarks_created_at'],
}
SHORT_URLS = {
    'kind': 'non_historical_synthesis',
    'beforeAfterMatrix': [
        {
            'phase': 'before',
            'status': 'absent',
            'evidence': 'Actions run 29363573853 failed: relation public.short_urls does not exist',
        },
        {
            'phase': 'after',
            'status': 'synthesized_non_historical',
            'evidence': 'Phase A creates only id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(), code text NOT NULL, target_url text NOT NULL, restaurant_id uuid, restaurant_name text, created_at timestamptz DEFAULT now().',
        },
        {
            'phase': 'G013',
            'status': 'source_owned_hardening',
            'evidence': 'backend/supabase/migrations/20260713000100_g013_short_url_security.sql lines 7-35 validate NULL and duplicate code/target_url rows; lines 38-43 add NOT NULL, unique code/target_url, and code format constraints; lines 283-294 insert code, target_url, restaurant_id, and restaurant_name.',
        },
    ],
}
SHORT_URLS_TRANSITION = """-- G026 non-historical synthesized Phase A base relation: source-derived solely from backend/supabase/migrations/20260713000100_g013_short_url_security.sql.
-- G013 lines 7-35 validate code/target_url, lines 38-43 own NOT NULL, uniqueness, and format constraints, and lines 283-294 allocate code, target_url, restaurant_id, and restaurant_name.
CREATE TABLE public.short_urls (
 id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
 code text NOT NULL,
 target_url text NOT NULL,
 restaurant_id uuid,
 restaurant_name text,
 created_at timestamptz DEFAULT now()
);
DO $$ BEGIN
 IF to_regclass('public.short_urls') IS NULL THEN RAISE EXCEPTION 'G026 short_urls synthesized base relation checkpoint failed: relation is absent' USING ERRCODE='P0001'; END IF;
END $$;"""
STORYBOARD_BASE_TABLES = {
    'kind': 'non_historical_synthesis',
    'sourceContracts': [
        'backend/storyboard-agent/src/prompts/intern.py:12-62',
        'backend/storyboard-agent/scripts/01-bge-embed-and-store-supabase.py',
        'backend/storyboard-agent/scripts/02-video-caption-store-supabase.py',
        'apps/web/supabase/migrations/20260612075100_storyboard_caption_provenance.sql',
    ],
    'beforeAfterMatrix': [
        {
            'phase': 'before',
            'status': 'absent',
            'evidence': 'Actions run 29364092725 failed: relation public.transcript_embeddings_bge does not exist',
        },
        {
            'phase': 'after',
            'status': 'synthesized_non_historical',
            'evidence': 'Phase A creates only the minimal source-contract schemas for transcript_embeddings_bge, video_frame_captions, and videos.',
        },
        {
            'phase': '20260531',
            'status': 'strict_grant_dependency',
            'evidence': 'backend/supabase/migrations/20260531084516_tighten_public_table_data_api_grants.sql grants transcript_embeddings_bge, video_frame_captions, and videos consecutively.',
        },
        {
            'phase': '20260612',
            'status': 'source_owned_provenance',
            'evidence': 'apps/web/supabase/migrations/20260612075100_storyboard_caption_provenance.sql owns video_frame_captions provider and provenance fields, which Phase A does not synthesize.',
        },
    ],
}
STORYBOARD_BASE_TABLES_TRANSITION = """-- G026 non-historical synthesized Phase A base relations: source-derived solely from backend/storyboard-agent/src/prompts/intern.py lines 12-62, backend/storyboard-agent/scripts/01-bge-embed-and-store-supabase.py, backend/storyboard-agent/scripts/02-video-caption-store-supabase.py, and apps/web/supabase/migrations/20260612075100_storyboard_caption_provenance.sql.
-- Actions run 29364092725 failed: relation public.transcript_embeddings_bge does not exist. The strict 20260531 grants immediately also require video_frame_captions and videos; 20260612 owns caption provenance fields and is intentionally not synthesized here.
CREATE TABLE public.transcript_embeddings_bge (
 id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
 video_id text NOT NULL,
 chunk_index integer NOT NULL,
 recollect_id integer NOT NULL DEFAULT 0,
 page_content text NOT NULL,
 embedding extensions.vector(1024),
 metadata jsonb DEFAULT '{}'::jsonb,
 sparse_embedding jsonb,
 created_at timestamptz DEFAULT now(),
 updated_at timestamptz DEFAULT now(),
 UNIQUE(video_id,chunk_index,recollect_id)
);
CREATE TABLE public.video_frame_captions (
 id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
 video_id text NOT NULL,
 recollect_id integer NOT NULL,
 start_sec integer NOT NULL,
 end_sec integer NOT NULL,
 rank integer,
 raw_caption text,
 chronological_analysis text,
 highlight_keywords text[],
 duration integer,
 UNIQUE(video_id,recollect_id,start_sec)
);
CREATE TABLE public.videos (
 id text PRIMARY KEY,
 title text,
 description text,
 published_at timestamptz,
 duration integer,
 view_count bigint,
 like_count integer,
 comment_count integer,
 channel_name text NOT NULL,
 is_shorts boolean,
 is_ads boolean,
 tags text[],
 thumbnail_url text,
 latest_recollect_id integer DEFAULT 0
);
DO $$ BEGIN
 IF to_regclass('public.transcript_embeddings_bge') IS NULL OR to_regclass('public.video_frame_captions') IS NULL OR to_regclass('public.videos') IS NULL THEN RAISE EXCEPTION 'G026 storyboard synthesized base relation checkpoint failed: relation is absent' USING ERRCODE='P0001'; END IF;
END $$;"""
SEARCH_LOGS = {
    'kind': 'non_historical_compatibility_shell',
    'sourceContract': 'apps/web/lib/search-count.ts',
    'beforeAfterMatrix': [
        {
            'phase': 'before',
            'status': 'absent',
            'evidence': 'Actions run 29366186258 failed: relation public.search_logs does not exist',
        },
        {
            'phase': 'after',
            'status': 'compatibility_shell_fail_closed',
            'evidence': 'Phase A creates only id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY and created_at timestamptz NOT NULL DEFAULT now(); it has no query, user, location, or other payload columns.',
        },
        {
            'phase': 'runtime',
            'status': 'analytics_disabled',
            'evidence': 'apps/web/lib/search-count.ts labels search analytics disabled until an approved aggregate-only endpoint and retention contract are available.',
        },
        {
            'phase': '20260531',
            'status': 'object_grants_rls_denied',
            'evidence': 'backend/supabase/migrations/20260531084516_tighten_public_table_data_api_grants.sql lines 69-72 grants INSERT and SELECT at the object level only; ENABLE and FORCE ROW LEVEL SECURITY with no policies keeps reads and inserts denied.',
        },
    ],
}
SEARCH_LOGS_TRANSITION = """-- G026 non-historical compatibility shell: derived solely from the current first-party apps/web/lib/search-count.ts disabled analytics contract.
-- Analytics remains disabled until an approved aggregate-only endpoint and retention contract exist. This shell has no query, user, location, or other payload columns.
-- The strict backend/supabase/migrations/20260531084516_tighten_public_table_data_api_grants.sql lines 69-72 grants are object-level only; FORCE RLS with no policies denies every runtime read and insert.
CREATE TABLE public.search_logs (
 id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.search_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.search_logs FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF to_regclass('public.search_logs') IS NULL THEN RAISE EXCEPTION 'G026 search_logs compatibility shell checkpoint failed: relation is absent' USING ERRCODE='P0001'; END IF;
END $$;"""
RESTAURANTS_DUPLICATE = {
    'kind': 'non_historical_compatibility_shell',
    'sourceContracts': [
        'backend/supabase/migrations/20260531084516_tighten_public_table_data_api_grants.sql',
        'scripts/security/audit_supabase_public_api.py',
    ],
    'beforeAfterMatrix': [
        {
            'phase': 'before',
            'status': 'absent',
            'evidence': 'GitHub run 29367966495 failed: relation public.restaurants_duplicate does not exist',
        },
        {
            'phase': 'after',
            'status': 'compatibility_shell_fail_closed',
            'evidence': 'Phase A creates only id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(), then ENABLE and FORCE ROW LEVEL SECURITY with no policies, grants, or data.',
        },
        {
            'phase': 'source_contract',
            'status': 'private_data_api_denied',
            'evidence': '20260531084516 REVOKE ALL from anon and authenticated; scripts/security/audit_supabase_public_api.py expects empty grants for restaurants_duplicate.',
        },
    ],
}
RESTAURANTS_DUPLICATE_TRANSITION = """-- G026 non-historical compatibility shell: derived solely from the current strict grant and security-audit private-table contracts.
-- This shell exists only so 20260531084516 can revoke Data API access; it contains no production-derived fields, data, policies, or grants.
CREATE TABLE public.restaurants_duplicate (
 id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid()
);
ALTER TABLE public.restaurants_duplicate ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurants_duplicate FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF to_regclass('public.restaurants_duplicate') IS NULL THEN RAISE EXCEPTION 'G026 restaurants_duplicate compatibility shell checkpoint failed: relation is absent' USING ERRCODE='P0001'; END IF;
END $$;"""



def pairs(items):
    value = {}
    for key, item in items:
        if key in value:
            raise ValueError(f'duplicate JSON key: {key}')
        value[key] = item
    return value

def lf_normalized_bytes(value):
    return value.replace(b'\r\n', b'\n').replace(b'\r', b'\n')

def require_lower_sha256(value, message):
    if not isinstance(value, str) or not re.fullmatch(r'[0-9a-f]{64}', value):
        raise ValueError(message)

def digest(value):
    return hashlib.sha256(value.encode('utf-8')).hexdigest()

def function_body(source, name, create_prefix='CREATE OR REPLACE FUNCTION'):
    marker = f'{create_prefix} public.{name}('
    start = source.find(marker)
    if start < 0 or source.find(marker, start + 1) >= 0:
        raise ValueError(f'expected exactly one canonical body for {name}')
    body_start = source.find('AS $$', start)
    body_end = source.find('$$;', body_start + 5)
    if body_start < 0 or body_end < 0:
        raise ValueError(f'cannot delimit canonical body for {name}')
    return source[body_start + 5:body_end]
def require_approve_restaurant_signature(repairs, predecessor):
    pattern = re.compile(
        r'CREATE OR REPLACE FUNCTION public\.approve_restaurant\(\s*'
        r'([a-z_]+)\s+uuid\s*,\s*([a-z_]+)\s+uuid\s*\)',
    )
    predecessor_match = pattern.search(predecessor)
    repair_match = pattern.search(repairs)
    if predecessor_match is None or repair_match is None:
        raise ValueError('approve_restaurant signature is missing')
    if predecessor_match.groups() != ('restaurant_id', 'admin_user_id'):
        raise ValueError('immutable approve_restaurant predecessor signature drifted')
    if repair_match.groups() != predecessor_match.groups():
        raise ValueError('approve_restaurant parameter-name drifted from immutable predecessor')
    if re.search(r'\bp_(?:restaurant_id|admin_user_id)\b', function_body(repairs, 'approve_restaurant')):
        raise ValueError('approve_restaurant body parameter reference drifted')

def require_jsonl_import_signatures(repairs):
    expected = {
        'insert_restaurant_from_jsonl': 'jsonl_data jsonb',
        'batch_insert_restaurants_from_jsonl': 'jsonl_array jsonb[]',
    }
    for name, signature in expected.items():
        marker = f'CREATE OR REPLACE FUNCTION public.{name}({signature})'
        if marker not in repairs:
            raise ValueError(f'{name} parameter-name drifted from historical baseline')
    if re.search(r'\bp_(?:record|records)\b', function_body(repairs, 'insert_restaurant_from_jsonl')):
        raise ValueError('insert_restaurant_from_jsonl body parameter reference drifted')
    if re.search(r'\bp_(?:record|records)\b', function_body(repairs, 'batch_insert_restaurants_from_jsonl')):
        raise ValueError('batch_insert_restaurants_from_jsonl body parameter reference drifted')




def require_obsolete_overload_drops(repairs, manifest, binding):
    if manifest != list(OBSOLETE_OVERLOAD_DROPS):
        raise ValueError('obsolete overload drop manifest drifted')
    statements = re.findall(r'(?im)^\s*(DROP\s+FUNCTION\b[^;]*;)', repairs)
    expected = (
        'DROP FUNCTION IF EXISTS public.approve_restaurant(uuid);',
        'DROP FUNCTION IF EXISTS public.create_user_notification(uuid, public.notification_type, text, text, jsonb);',
    )
    if re.search(r'(?im)^\s*DROP\s+FUNCTION\b[^;]*\bCASCADE\s*;', repairs):
        raise ValueError('obsolete overload drop must not use CASCADE')
    if tuple(statements) != expected:
        raise ValueError('obsolete overload drop declarations drifted')
    g014_boundary = repairs.index(
        'CREATE OR REPLACE FUNCTION public.approve_restaurant_submission('
    )
    canonical_approve_restaurant = repairs.index(
        'CREATE OR REPLACE FUNCTION public.approve_restaurant('
    )
    for statement, entry in zip(expected, OBSOLETE_OVERLOAD_DROPS):
        if repairs.index(statement) >= canonical_approve_restaurant or repairs.index(statement) >= g014_boundary:
            raise ValueError('obsolete overload drop ordering drifted')
        if entry['expectedIdentity'] in json.dumps(binding, separators=(',', ':')):
            raise ValueError('obsolete overload signature was allowlisted')

DISABLED_G014_RPC_MESSAGES = {
    'cleanup_old_notifications': 'cleanup_old_notifications is disabled; use the versioned retention workflow',
    'make_user_admin': 'make_user_admin is disabled; use apply_admin_user_db_mutation',
    'reject_restaurant': 'legacy review is disabled; use the versioned review workflow',
    'reject_restaurant_submission': 'legacy review is disabled; use the versioned review workflow',
    'reject_submission': 'legacy review is disabled; use the versioned review workflow',
    'reject_submission_item': 'legacy review is disabled; use the versioned review workflow',
}
G014_RPC_MODES = {
    **{name: 'disabled_fail_closed' for name in DISABLED_G014_RPC_MESSAGES},
    'refresh_materialized_views': 'transaction_safe_refresh',
}
APPROVAL_SUBSTITUTION_ALLOWLIST = {
    'approve_restaurant_submission': (
        ("    IF submission_record.submission_type = 'new' THEN\n        \n", "    IF submission_record.submission_type = 'new' THEN\n\n", 1),
        ('            name, phone, categories,', '            approved_name, phone, categories,', 1),
        ('            submission_record.lat, submission_record.lng, submission_record.road_address, \n', '            submission_record.lat, submission_record.lng, submission_record.road_address,\n', 1),
        ("    ELSIF submission_record.submission_type = 'edit' THEN\n    \n", "    ELSIF submission_record.submission_type = 'edit' THEN\n\n", 1),
        ('        -- 4-2. 수정 제보 승인 (UPDATE restaurants)\n        \n', '        -- 4-2. 수정 제보 승인 (UPDATE restaurants)\n\n', 1),
        ('            name = COALESCE(', '            approved_name = COALESCE(', 1),
        ('submission_record.name, r.name),', 'submission_record.name, r.approved_name),', 1),
        ('            address_elements = COALESCE(submission_record.address_elements, r.address_elements),\n            \n', '            address_elements = COALESCE(submission_record.address_elements, r.address_elements),\n\n', 1),
    ),
    'approve_edit_restaurant_submission': (
        ('    WHERE id = p_submission_id \n', '    WHERE id = p_submission_id\n', 1),
        ("                name = COALESCE(v_restaurant_item->>'name', name),", "                approved_name = COALESCE(v_restaurant_item->>'name', approved_name),", 1),
        ("                resource_type = 'user_submission_edit',", "                source_type = 'user_submission_edit',", 1),
        ("            WHERE unique_id = v_restaurant_item->>'unique_id';", "            WHERE trace_id = v_restaurant_item->>'unique_id';", 1),
    ),
}

WRITE_STATEMENT = re.compile(r'(?im)^\s*(?:INSERT|UPDATE|DELETE|MERGE|COPY|TRUNCATE|CREATE|ALTER|DROP|GRANT|REVOKE)\b')

def require_synthesized_compatibility_bindings(repairs, binding):
    if binding.get('synthesis') != 'reviewed_g026_non_historical_compatibility_bodies':
        raise ValueError('G026 synthesized compatibility marker drifted')
    entries = binding.get('functions')
    if not isinstance(entries, list) or [entry.get('name') for entry in entries] != list(SYNTHESIZED_COMPATIBILITY_NAMES):
        raise ValueError('G026 synthesized compatibility binding identity drifted')
    types = {
        'approve_restaurant_submission': 'uuid,uuid',
        'approve_edit_restaurant_submission': 'uuid,uuid,uuid[]',
        'cleanup_old_notifications': 'integer',
        'make_user_admin': 'text',
        'refresh_materialized_views': '',
        'reject_restaurant': 'uuid,uuid,text',
        'reject_restaurant_submission': 'uuid,uuid,text',
        'reject_submission': 'uuid,uuid,text',
        'reject_submission_item': 'uuid,uuid,text',
    }
    for entry in entries:
        name = entry['name']
        if entry.get('reviewStatus') != 'reviewed_g026_synthesized_compatibility_body':
            raise ValueError(f'{name} synthesized body marker drifted')
        if f"CREATE OR REPLACE FUNCTION public.{name}({entry.get('signature')})" not in repairs:
            raise ValueError(f'{name} synthesized signature drifted')
        repair_body = function_body(repairs, name)
        mode = G014_RPC_MODES.get(name)
        substitutions = entry.get('substitutions')
        if mode is not None:
            if entry.get('mode') != mode:
                raise ValueError(f'{name} compatibility mode drifted')
            if mode == 'disabled_fail_closed':
                if substitutions != []:
                    raise ValueError(f'{name} disabled compatibility transformation drifted')
                expected = "\nBEGIN\n    RAISE EXCEPTION '" + DISABLED_G014_RPC_MESSAGES[name] + "' USING ERRCODE='0A000';\nEND;\n"
                if repair_body != expected:
                    raise ValueError(f'{name} disabled compatibility body drifted')
                if WRITE_STATEMENT.search(repair_body):
                    raise ValueError(f'{name} disabled compatibility body contains a write statement')
            else:
                if substitutions != [{'from': '    REFRESH MATERIALIZED VIEW CONCURRENTLY ', 'to': '    REFRESH MATERIALIZED VIEW ', 'count': 3}]:
                    raise ValueError('refresh_materialized_views transformation declaration drifted')
                if 'CONCURRENTLY' in repair_body:
                    raise ValueError('refresh_materialized_views transaction-safe body drifted')
        else:
            if name not in APPROVAL_SUBSTITUTION_ALLOWLIST:
                raise ValueError(f'{name} synthesized compatibility allowlist is missing')
            allowlist = [
                {'from': source_text, 'to': replacement_text, 'count': count}
                for source_text, replacement_text, count in APPROVAL_SUBSTITUTION_ALLOWLIST[name]
            ]
            if substitutions != allowlist:
                raise ValueError(f'{name} immutable substitution allowlist drifted')
        expected_hash = SYNTHESIZED_COMPATIBILITY_BODY_HASHES[name]
        if entry.get('repairBodySha256') != expected_hash:
            raise ValueError(f'{name} synthesized body binding drifted')
        if hashlib.sha256(repair_body.encode()).hexdigest() != expected_hash:
            raise ValueError(f'{name} synthesized body hash drifted')
        authority = (
            f'ALTER FUNCTION public.{name}({types[name]}) OWNER TO postgres;',
            f'REVOKE ALL ON FUNCTION public.{name}({types[name]}) FROM PUBLIC, anon, authenticated;',
            f'GRANT EXECUTE ON FUNCTION public.{name}({types[name]}) TO service_role;',
        )
        if any(repairs.count(statement) != 1 for statement in authority):
            raise ValueError(f'{name} authority drifted')
        owners = re.findall(rf'ALTER FUNCTION public\.{name}\([^)]*\) OWNER TO ([^;]+);', repairs)
        revokes = re.findall(rf'REVOKE ALL ON FUNCTION public\.{name}\([^)]*\) FROM ([^;]+);', repairs)
        if owners != ['postgres'] or revokes != ['PUBLIC, anon, authenticated']:
            raise ValueError(f'{name} authority drifted')
        grants = re.findall(rf'GRANT EXECUTE ON FUNCTION public\.{name}\([^)]*\) TO ([^;]+);', repairs)
        if grants != ['service_role']:
            raise ValueError(f'{name} additive EXECUTE grant drifted')

def require_reconstruction_policy_shells(repairs):
    found = [
        match.group(0)
        for match in re.finditer(
            r'(?ms)^CREATE POLICY (?:"[^"]+"|[a-z][a-z0-9_]*)\n  ON public\.[a-z][a-z0-9_]+ .*?;$',
            repairs,
        )
    ]
    if found != list(RECONSTRUCTION_POLICY_SHELLS):
        raise ValueError('G026 fail-closed policy shell declarations drifted')
    tag = '$g026_policy_shell_precondition$'
    precondition_start = 'DO ' + tag
    if repairs.count(precondition_start) != 1 or repairs.count(tag) != 2:
        raise ValueError('G026 fail-closed policy shell precondition drifted')
    precondition_position = repairs.index(precondition_start)
    precondition_end = repairs.index(tag + ';', precondition_position + len(precondition_start))
    precondition = repairs[precondition_position:precondition_end + len(tag) + 1]
    if (
        len(precondition.encode()) != RECONSTRUCTION_POLICY_PRECONDITION_BYTES
        or hashlib.sha256(precondition.encode()).hexdigest() != RECONSTRUCTION_POLICY_PRECONDITION_SHA256
    ):
        raise ValueError('G026 fail-closed policy shell precondition drifted')
    drops = re.findall(r'^DROP POLICY [^;]+;$', repairs, re.MULTILINE)
    if drops != list(RECONSTRUCTION_OBSOLETE_POLICY_DROPS):
        raise ValueError('G026 obsolete policy cleanup drifted')
    positions = [repairs.index(statement) for statement in RECONSTRUCTION_POLICY_SHELLS]
    drop_positions = [repairs.index(statement) for statement in RECONSTRUCTION_OBSOLETE_POLICY_DROPS]
    if (
        drop_positions != sorted(drop_positions)
        or positions != sorted(positions)
        or precondition_position >= drop_positions[0]
        or drop_positions[-1] >= positions[0]
    ):
        raise ValueError('G026 fail-closed policy shell ordering drifted')
    if positions[-1] >= repairs.index('DROP FUNCTION IF EXISTS public.approve_restaurant(uuid);'):
        raise ValueError('G026 fail-closed policy shells must precede repair functions')

def require(source, *tokens):
    missing = [token for token in tokens if token not in source]
    if missing:
        raise ValueError(f'G026 SQL contract drifted: {missing[0]}')
def require_restaurant_columns(source):
    rename = 'ALTER TABLE public.restaurants RENAME COLUMN unique_id TO trace_id;'
    constraints = 'ALTER TABLE public.restaurants DROP CONSTRAINT restaurants_name_check;'
    start = source.find(rename)
    end = source.find(constraints, start + len(rename))
    expected = '\n'.join(REQUIRED_RESTAURANT_COLUMNS)
    if start < 0 or end < 0 or source[start + len(rename):end].strip() != expected:
        raise ValueError('required restaurant column transition drifted')

def table_definition(source, name):
    marker = f'CREATE TABLE public.{name} ('
    start = source.find(marker)
    if start < 0 or source.find(marker, start + len(marker)) >= 0:
        raise ValueError(f'{name} source table definition count drifted')
    end = source.find('\n);', start + len(marker))
    if end < 0:
        raise ValueError(f'{name} source table definition terminator drifted')
    return source[start:end + 3]

def require_legacy_shape_normalization(transition, bundle_source):
    if bundle_source != LEGACY_SHAPE_NORMALIZATION:
        raise ValueError('legacy-shape normalization source binding drifted')
    reconstruction = LEGACY_SHAPE_NORMALIZATION['reconstructionSource']
    application = LEGACY_SHAPE_NORMALIZATION['applicationPrerequisites']
    reconstruction_manifest_path = ROOT / reconstruction['manifestPath']
    reconstruction_archive_path = ROOT / reconstruction['archivePath']
    application_manifest_path = ROOT / application['manifestPath']
    application_source_path = ROOT / application['sourcePath']
    application_output_path = ROOT / application['outputPath']
    bound_files = (
        (reconstruction_manifest_path, reconstruction['manifestByteLength'], reconstruction['manifestSha256']),
        (reconstruction_archive_path, reconstruction['archiveByteLength'], reconstruction['archiveSha256']),
        (application_manifest_path, application['manifestByteLength'], application['manifestSha256']),
        (application_source_path, application['sourceByteLength'], application['sourceSha256']),
        (application_output_path, application['outputByteLength'], application['outputSha256']),
    )
    for path, expected_length, expected_sha256 in bound_files:
        raw = path.read_bytes()
        if len(raw) != expected_length or hashlib.sha256(raw).hexdigest() != expected_sha256:
            raise ValueError(f'legacy-shape immutable source binding drifted: {path.name}')

    reconstruction_manifest = json.loads(
        reconstruction_manifest_path.read_text(encoding='utf-8'), object_pairs_hook=pairs
    )
    if reconstruction_manifest.get('archiveSha256') != reconstruction['archiveSha256']:
        raise ValueError('legacy-shape reconstruction archive manifest binding drifted')
    entries = [
        entry for entry in reconstruction_manifest.get('entries', [])
        if entry.get('ordinal') == reconstruction['ordinal']
    ]
    if len(entries) != 1 or entries[0] != {
        'ordinal': 0,
        'path': reconstruction['member'],
        'blobSha1': 'b286fb1589b46203a0010d44c29ce65a39188fbc',
        'byteLength': reconstruction['sourceByteLength'],
        'sha256': reconstruction['sourceSha256'],
        'role': 'historical_baseline_candidate',
    }:
        raise ValueError('legacy-shape reconstruction ordinal-0 binding drifted')
    with zipfile.ZipFile(reconstruction_archive_path) as source_archive:
        legacy_source = source_archive.read(reconstruction['member'])
    if (len(legacy_source) != reconstruction['sourceByteLength']
            or hashlib.sha256(legacy_source).hexdigest() != reconstruction['sourceSha256']):
        raise ValueError('legacy-shape reconstruction member binding drifted')

    application_manifest = json.loads(
        application_manifest_path.read_text(encoding='utf-8'), object_pairs_hook=pairs
    )
    if application_manifest.get('source') != {
        'byteLength': application['sourceByteLength'],
        'path': application['sourcePath'],
        'sha256': application['sourceSha256'],
    } or application_manifest.get('output') != {
        'byteLength': application['outputByteLength'],
        'path': application['outputPath'],
        'sha256': application['outputSha256'],
    }:
        raise ValueError('legacy-shape application-prerequisites manifest binding drifted')

    legacy_text = legacy_source.decode('utf-8')
    legacy_profiles = table_definition(legacy_text, 'profiles')
    legacy_reviews = table_definition(legacy_text, 'reviews')
    target_source = application_source_path.read_text(encoding='utf-8')
    target_output = application_output_path.read_text(encoding='utf-8')
    for target_text in (target_source, target_output):
        target_profiles = table_definition(target_text, 'profiles')
        target_reviews = table_definition(target_text, 'reviews')
        if 'avatar_url text' not in target_profiles or 'profile_picture' in target_profiles:
            raise ValueError('legacy-shape application profile target evidence drifted')
        if ('like_count integer DEFAULT 0 NOT NULL' not in target_reviews
                or 'CONSTRAINT reviews_like_count_check CHECK ((like_count >= 0))' not in target_reviews):
            raise ValueError('legacy-shape application reviews target evidence drifted')
    if 'profile_picture text NULL' not in legacy_profiles or 'avatar_url' in legacy_profiles:
        raise ValueError('legacy-shape reconstruction profile evidence drifted')
    if 'like_count' in legacy_reviews:
        raise ValueError('legacy-shape reconstruction reviews evidence drifted')

    phase_label = '-- Phase A runs exactly after ordinal 2 and before ordinal 3.'
    next_label = SHORT_URLS_TRANSITION.splitlines()[0]
    if (transition.count(phase_label) != 1
            or transition.count(LEGACY_SHAPE_NORMALIZATION_LABEL) != 1
            or transition.count(next_label) != 1):
        raise ValueError('legacy-shape normalization transition boundary drifted')
    phase_start = transition.index(phase_label)
    normalization_start = transition.index(LEGACY_SHAPE_NORMALIZATION_LABEL)
    next_start = transition.index(next_label)
    begin_position = transition.find('BEGIN;', phase_start, normalization_start)
    lock_position = transition.find('LOCK TABLE public.profiles, public.reviews, public.restaurants, public.restaurant_submissions, public.restaurant_submission_items IN ACCESS EXCLUSIVE MODE;', phase_start, normalization_start)
    empty_position = transition.find('(SELECT count(*) FROM public.profiles) <> 0 OR (SELECT count(*) FROM public.reviews) <> 0', phase_start, normalization_start)
    if not phase_start < begin_position < lock_position < empty_position < normalization_start < next_start:
        raise ValueError('legacy-shape normalization ordering drifted')
    preamble = transition[phase_start:normalization_start].encode('utf-8')
    normalization = transition[normalization_start:next_start].encode('utf-8')
    if (len(preamble) != PHASE_A_LEGACY_SHAPE_PREAMBLE_BYTES
            or hashlib.sha256(preamble).hexdigest() != PHASE_A_LEGACY_SHAPE_PREAMBLE_SHA256):
        raise ValueError('legacy-shape normalization preamble drifted')
    if (len(normalization) != LEGACY_SHAPE_NORMALIZATION_BYTES
            or hashlib.sha256(normalization).hexdigest() != LEGACY_SHAPE_NORMALIZATION_SHA256):
        raise ValueError('legacy-shape normalization SQL drifted')
    ordered = (
        'requires profiles and reviews',
        'requires ordinary tables',
        'requires empty profiles and reviews',
        'legacy and target avatar columns both exist',
        'profiles legacy avatar column shape drifted',
        'profiles exact legacy base shape drifted',
        'reviews target like_count already exists',
        'reviews exact legacy base shape drifted',
        'reviews like_count constraint already exists',
        'ALTER TABLE public.profiles RENAME COLUMN profile_picture TO avatar_url;',
        'ALTER TABLE public.reviews ADD COLUMN like_count integer NOT NULL DEFAULT 0;',
        'ALTER TABLE public.reviews ADD CONSTRAINT reviews_like_count_check CHECK (like_count >= 0);',
        'profiles normalized shape postcondition failed',
        'reviews normalized shape postcondition failed',
        'reviews like_count default postcondition failed',
        'reviews like_count constraint postcondition failed',
    )
    normalization_text = normalization.decode('utf-8')
    positions = [normalization_text.index(token) for token in ordered]
    if positions != sorted(positions):
        raise ValueError('legacy-shape normalization structural ordering drifted')
    rename_position = normalization_text.index(
        'ALTER TABLE public.profiles RENAME COLUMN profile_picture TO avatar_url;'
    )
    old_name_postcondition = normalization_text.find(
        "attname = 'profile_picture'", rename_position
    )
    if not rename_position < old_name_postcondition < normalization_text.index(
        'profiles normalized shape postcondition failed'
    ):
        raise ValueError('legacy-shape old profile column postcondition ordering drifted')

def require_ad_banners_source(transition, bundle_source):
    if bundle_source != AD_BANNERS_SOURCE:
        raise ValueError('ad_banners source binding drifted')
    with zipfile.ZipFile(BASE / AD_BANNERS_SOURCE['sourceArchive']) as source_archive:
        member = source_archive.read(AD_BANNERS_SOURCE['member'])
    if len(member) != AD_BANNERS_SOURCE['byteLength'] or hashlib.sha256(member).hexdigest() != AD_BANNERS_SOURCE['sha256']:
        raise ValueError('ad_banners historical member binding drifted')
    begin, end = AD_BANNERS_SOURCE['provenanceDelimiters']
    start = transition.find(begin)
    stop = transition.find(end, start + len(begin))
    if start < 0 or stop < 0 or transition.find(begin, start + 1) >= 0 or transition.find(end, stop + 1) >= 0:
        raise ValueError('ad_banners provenance delimiters drifted')
    embedded = transition[start + len(begin):stop]
    if not embedded.startswith('\n') or not embedded.endswith('\n') or embedded[1:].encode('utf-8') != member:
        raise ValueError('ad_banners embedded historical source drifted')
    if "to_regclass('public.ad_banners') IS NOT NULL" not in transition[:start]:
        raise ValueError('ad_banners absence check drifted')

def require_user_bookmarks_source(transition, bookmarks_source):
    if bookmarks_source != USER_BOOKMARKS_SOURCE:
        raise ValueError('user bookmarks source binding drifted')
    with zipfile.ZipFile(BASE / USER_BOOKMARKS_SOURCE['sourceArchive']) as source_archive:
        member = source_archive.read(USER_BOOKMARKS_SOURCE['member'])
    if (len(member) != USER_BOOKMARKS_SOURCE['byteLength']
            or hashlib.sha1(b'blob ' + str(len(member)).encode('ascii') + b'\0' + member).hexdigest() != USER_BOOKMARKS_SOURCE['blobSha1']
            or hashlib.sha256(member).hexdigest() != USER_BOOKMARKS_SOURCE['sha256']):
        raise ValueError('user_bookmarks historical member binding drifted')
    begin, end = USER_BOOKMARKS_SOURCE['provenanceDelimiters']
    start = transition.find(begin)
    stop = transition.find(end, start + len(begin))
    ad_start = transition.find(AD_BANNERS_SOURCE['provenanceDelimiters'][0])
    absence = "to_regclass('public.user_bookmarks') IS NOT NULL"
    embedded = transition[start + len(begin):stop]
    if (start < 0 or stop < 0 or ad_start < 0 or not start < stop < ad_start
            or transition.find(begin, start + 1) >= 0 or transition.find(end, stop + 1) < ad_start
            or not embedded.startswith('\n') or not embedded.endswith('\n') or embedded[1:].encode('utf-8') != member
            or transition.find(absence) < 0 or transition.find(absence) > start):
        raise ValueError('user_bookmarks transition drifted')


def require_short_urls_source(transition, bundle_source):
    if bundle_source != SHORT_URLS:
        raise ValueError('short_urls source matrix drifted')
    absence = "to_regclass('public.short_urls') IS NOT NULL"
    source_label = SHORT_URLS_TRANSITION.splitlines()[0]
    start = transition.find(source_label)
    storyboard_start = transition.find(STORYBOARD_BASE_TABLES_TRANSITION.splitlines()[0])
    storyboard_guard_start = transition.rfind('DO $$ BEGIN', start, storyboard_start)
    if (start < 0 or transition.find(source_label, start + 1) >= 0
            or transition.find(absence) < 0 or transition.find(absence) > start
            or storyboard_start < 0 or storyboard_guard_start < 0
            or transition[start:storyboard_guard_start].strip() != SHORT_URLS_TRANSITION):
        raise ValueError('short_urls synthesized base relation drifted')
def require_storyboard_base_tables_source(transition, bundle_source):
    if bundle_source != STORYBOARD_BASE_TABLES:
        raise ValueError('storyboard base tables source matrix drifted')
    source_label = STORYBOARD_BASE_TABLES_TRANSITION.splitlines()[0]
    absence = "to_regclass('public.transcript_embeddings_bge') IS NOT NULL OR to_regclass('public.video_frame_captions') IS NOT NULL OR to_regclass('public.videos') IS NOT NULL"
    start = transition.find(source_label)
    short_urls_start = transition.find(SHORT_URLS_TRANSITION.splitlines()[0])
    admin_workflow_start = transition.find('-- G026 source-only Phase A prerequisite: source-derived solely from backend/supabase/baselines/historical/20260310_admin_workflow_pipeline.sql')
    user_bookmarks_start = transition.find(USER_BOOKMARKS_SOURCE['provenanceDelimiters'][0])
    search_logs_start = transition.find(SEARCH_LOGS_TRANSITION.splitlines()[0])
    admin_workflow_guard_start = transition.rfind('DO $$ BEGIN', start, admin_workflow_start)
    if (start < 0 or transition.find(source_label, start + 1) >= 0
            or short_urls_start < 0 or admin_workflow_start < 0 or search_logs_start < 0
            or user_bookmarks_start < 0 or admin_workflow_guard_start < 0
            or not short_urls_start < start < admin_workflow_guard_start < admin_workflow_start < search_logs_start < user_bookmarks_start
            or transition.find(absence) < 0 or transition.find(absence) > start
            or transition[start:admin_workflow_guard_start].strip() != STORYBOARD_BASE_TABLES_TRANSITION):
        raise ValueError('storyboard synthesized base relations drifted')
def require_search_logs_source(transition, bundle_source):
    if bundle_source != SEARCH_LOGS:
        raise ValueError('search_logs compatibility shell matrix drifted')
    source_label = SEARCH_LOGS_TRANSITION.splitlines()[0]
    absence = "to_regclass('public.search_logs') IS NOT NULL"
    checkpoint = "to_regclass('public.search_logs') IS NULL"
    start = transition.find(source_label)
    storyboard_start = transition.find(STORYBOARD_BASE_TABLES_TRANSITION.splitlines()[0])
    search_guard_start = transition.rfind('DO $$ BEGIN', storyboard_start, start)
    restaurants_duplicate_start = transition.find(RESTAURANTS_DUPLICATE_TRANSITION.splitlines()[0])
    restaurants_duplicate_guard_start = transition.rfind('DO $$ BEGIN', start, restaurants_duplicate_start)
    if (start < 0 or transition.find(source_label, start + 1) >= 0
            or storyboard_start < 0 or search_guard_start < 0 or restaurants_duplicate_start < 0 or restaurants_duplicate_guard_start < 0
            or not storyboard_start < search_guard_start < start < restaurants_duplicate_guard_start < restaurants_duplicate_start
            or transition.find(absence) != search_guard_start + len('DO $$ BEGIN\n IF ')
            or transition.find(checkpoint, start) < 0
            or transition[start:restaurants_duplicate_guard_start].strip() != SEARCH_LOGS_TRANSITION):
        raise ValueError('search_logs compatibility shell drifted')
    search_count_source = (ROOT / SEARCH_LOGS['sourceContract']).read_text(encoding='utf-8')
    require(search_count_source, 'Search analytics is disabled until an approved aggregate-only endpoint and', 'retention contract are available.', "reason: 'analytics_disabled'", "message: '검색 집계가 비활성화되어 있습니다.'")
    if 'supabase' in search_count_source.lower():
        raise ValueError('search_logs source contract must not write analytics')
def require_restaurants_duplicate_source(transition, bundle_source):
    if bundle_source != RESTAURANTS_DUPLICATE:
        raise ValueError('restaurants_duplicate compatibility shell matrix drifted')
    source_label = RESTAURANTS_DUPLICATE_TRANSITION.splitlines()[0]
    absence = "to_regclass('public.restaurants_duplicate') IS NOT NULL"
    checkpoint = "to_regclass('public.restaurants_duplicate') IS NULL"
    start = transition.find(source_label)
    search_logs_start = transition.find(SEARCH_LOGS_TRANSITION.splitlines()[0])
    user_bookmarks_start = transition.find(USER_BOOKMARKS_SOURCE['provenanceDelimiters'][0])
    guard_start = transition.rfind('DO $$ BEGIN', search_logs_start, start)
    expected_guard = ("DO $$ BEGIN\n"
                      " IF to_regclass('public.restaurants_duplicate') IS NOT NULL THEN RAISE EXCEPTION 'G026 Phase A restaurants_duplicate relation already exists' USING ERRCODE='P0001'; END IF;\n"
                      "END $$;")
    if (start < 0 or transition.find(source_label, start + 1) >= 0
            or search_logs_start < 0 or user_bookmarks_start < 0 or guard_start < 0
            or not search_logs_start < guard_start < start < user_bookmarks_start
            or transition.find(absence, guard_start, start) != guard_start + len('DO $$ BEGIN\n IF ')
            or transition.find(checkpoint, start) < 0
            or transition[guard_start:user_bookmarks_start].strip()
            != expected_guard + '\n' + RESTAURANTS_DUPLICATE_TRANSITION + '\nDO $$ BEGIN\n IF to_regclass(\'public.user_bookmarks\') IS NOT NULL THEN RAISE EXCEPTION \'G026 Phase A user bookmarks relation already exists\' USING ERRCODE=\'P0001\'; END IF;\nEND $$;'):
        raise ValueError('restaurants_duplicate compatibility shell drifted')
    preexisting_guard = "to_regclass('public.short_urls') IS NOT NULL OR to_regclass('public.restaurants_duplicate') IS NOT NULL"
    if preexisting_guard not in transition[:start]:
        raise ValueError('restaurants_duplicate preexisting relation must fail closed')
    grants = (ROOT / RESTAURANTS_DUPLICATE['sourceContracts'][0]).read_text(encoding='utf-8')
    audit = (ROOT / RESTAURANTS_DUPLICATE['sourceContracts'][1]).read_text(encoding='utf-8')
    require(grants, 'REVOKE ALL ON public.restaurants_duplicate FROM anon, authenticated;')
    require(audit, '"restaurants_duplicate": {"anon": set(), "authenticated": set()},')
    if any(token in RESTAURANTS_DUPLICATE_TRANSITION for token in ('CREATE POLICY', 'GRANT ', 'INSERT INTO', 'CREATE TABLE IF NOT EXISTS')):
        raise ValueError('restaurants_duplicate shell must not self-baseline or expose Data API access')
def require_admin_workflow_pipeline_source(transition, bundle_source):
    if bundle_source != ADMIN_WORKFLOW_SOURCE:
        raise ValueError('admin workflow source binding drifted')
    raw = (ROOT / ADMIN_WORKFLOW_SOURCE['path']).read_bytes()
    require_lower_sha256(ADMIN_WORKFLOW_SOURCE['sha256'], 'admin workflow source hash must be lowercase SHA-256')
    if not isinstance(ADMIN_WORKFLOW_SOURCE['byteLength'], int) or ADMIN_WORKFLOW_SOURCE['byteLength'] < 0:
        raise ValueError('admin workflow source byte length drifted')
    if len(raw) != ADMIN_WORKFLOW_SOURCE['byteLength'] or hashlib.sha256(raw).hexdigest() != ADMIN_WORKFLOW_SOURCE['sha256']:
        raise ValueError('admin workflow historical source bytes drifted')
    label = '-- G026 source-only Phase A prerequisite: source-derived solely from backend/supabase/baselines/historical/20260310_admin_workflow_pipeline.sql sha256=83acbf7f9ad5abf66de2aae7350db1a23a1f53d940336629252cdcb9d4f47a6e.'
    start = transition.find(label)
    end = transition.find("-- G026 non-historical compatibility shell:", start)
    if start < 0 or transition.find(label, start + 1) >= 0 or end < 0:
        raise ValueError('admin workflow transition placement drifted')
    unit = transition[start:end]
    publication_pattern = re.compile(
        r'ALTER PUBLICATION supabase_realtime ADD TABLE public\.([a-z_]+);'
    )
    publications = publication_pattern.findall(unit)
    if publications != ADMIN_WORKFLOW_SOURCE['publicationTables']:
        raise ValueError('admin workflow realtime publication drifted')
    absence = "to_regtype('public.admin_workflow_trigger_source') IS NOT NULL OR to_regtype('public.admin_workflow_correlation_state') IS NOT NULL OR to_regtype('public.admin_workflow_step_status') IS NOT NULL"
    if transition.rfind(absence, 0, start) < 0:
        raise ValueError('admin workflow type absence gate drifted')
    for name in ADMIN_WORKFLOW_SOURCE['tables'] + ADMIN_WORKFLOW_SOURCE['indexes']:
        if f"to_regclass('public.{name}')" not in transition[:start]:
            raise ValueError(f'admin workflow absence gate drifted: {name}')
    if "to_regprocedure('public.touch_admin_workflow_updated_at()')" not in transition[:start]:
        raise ValueError('admin workflow function absence gate drifted')
    required = (
        "CREATE TYPE public.admin_workflow_trigger_source AS ENUM ('schedule', 'manual_admin');",
        "'pending_dispatch',\n  'dispatched_unmatched',\n  'matched',\n  'reconciled_timeout',\n  'reconciled_error',\n  'completed'",
        "'queued',\n  'running',\n  'success',\n  'failed',\n  'timeout',\n  'partial',\n  'skipped'",
        'dispatch_request_id text UNIQUE NOT NULL,',
        'dedupe_of_run_id uuid REFERENCES public.admin_workflow_runs(run_id),',
        'canonical_step_no integer NOT NULL CHECK (canonical_step_no BETWEEN 1 AND 12),',
        'UNIQUE(run_id, canonical_step_no)',
        'id bigint generated always as identity PRIMARY KEY,',
        'run_id uuid REFERENCES public.admin_workflow_runs(run_id) ON DELETE CASCADE,',
        "payload jsonb NOT NULL DEFAULT '{}'::jsonb,",
        'CREATE FUNCTION public.touch_admin_workflow_updated_at()',
        'CREATE TRIGGER admin_workflow_runs_updated_at_trigger',
        'CREATE TRIGGER admin_workflow_steps_updated_at_trigger',
        'ALTER TABLE public.admin_workflow_runs ENABLE ROW LEVEL SECURITY;',
        'ALTER TABLE public.admin_workflow_steps ENABLE ROW LEVEL SECURITY;',
        'ALTER TABLE public.admin_workflow_signals ENABLE ROW LEVEL SECURITY;',
        "WHERE ur.user_id = (SELECT auth.uid()) AND ur.role = 'admin'",
    )
    require(unit, *required)
    if unit.count(REALTIME_PUBLICATION_ENVELOPE) != 1:
        raise ValueError('admin workflow realtime publication envelope drifted')
    if re.search(r'WHEN\s+(?:undefined_object|others)\b', unit, re.IGNORECASE):
        raise ValueError('admin workflow realtime publication must not mask broad exceptions')
    exact_lines = (
        "CREATE TYPE public.admin_workflow_trigger_source AS ENUM ('schedule', 'manual_admin');",
        'CREATE TYPE public.admin_workflow_correlation_state AS ENUM (',
        'CREATE TYPE public.admin_workflow_step_status AS ENUM (',
        'CREATE TABLE public.admin_workflow_runs (',
        'CREATE TABLE public.admin_workflow_steps (',
        'CREATE TABLE public.admin_workflow_signals (',
        'CREATE POLICY admin_workflow_runs_select_admin',
        'CREATE POLICY admin_workflow_steps_select_admin',
        'CREATE POLICY admin_workflow_signals_select_admin',
    )
    lines = unit.splitlines()
    if any(lines.count(line) != 1 for line in exact_lines):
        raise ValueError('admin workflow exact declaration drifted')
    for name in ADMIN_WORKFLOW_SOURCE['tables']:
        require(unit, f'CREATE TABLE public.{name} (')
    for name in ADMIN_WORKFLOW_SOURCE['indexes']:
        require(unit, f'CREATE INDEX {name} ')
    for name in ADMIN_WORKFLOW_SOURCE['policies']:
        require(unit, f'CREATE POLICY {name}')
    if any(
            unit.count(f'ALTER PUBLICATION supabase_realtime ADD TABLE public.{name};') != 1
            for name in ADMIN_WORKFLOW_SOURCE['publicationTables']):
        raise ValueError('admin workflow realtime publication multiplicity drifted')
    for name in ADMIN_WORKFLOW_SOURCE['publicationExcluded']:
        if name in publications:
            raise ValueError(f'admin workflow source-excluded publication drifted: {name}')
    if re.search(r'\b(?:CREATE (?:TYPE|TABLE|INDEX)|DROP (?:TRIGGER|POLICY))\s+IF\s+'
                 r'(?:NOT\s+)?EXISTS\b', unit, re.IGNORECASE):
        raise ValueError('admin workflow synthesis must not self-baseline')
    if "to_regclass('public.admin_workflow_runs') IS NULL OR to_regclass('public.admin_workflow_steps') IS NULL OR to_regclass('public.admin_workflow_signals') IS NULL" not in unit:
        raise ValueError('admin workflow completion checkpoint drifted')
ROLE_MANAGEMENT_STATEMENT = (
    "  EXECUTE 'ALTER ROLE privacy_workflow_owner NOSUPERUSER NOCREATEDB NOCREATEROLE "
    "NOINHERIT NOLOGIN NOREPLICATION NOBYPASSRLS';\n"
)
ROLE_MANAGEMENT_POSTCONDITION = """DO $g026_role_postcondition$
DECLARE
  v_role record;
BEGIN
  SELECT role_row.oid, role_row.rolsuper, role_row.rolinherit, role_row.rolcreaterole, role_row.rolcreatedb, role_row.rolreplication, role_row.rolbypassrls, role_row.rolcanlogin INTO v_role FROM pg_catalog.pg_roles AS role_row WHERE role_row.rolname = 'privacy_workflow_owner';
  IF NOT FOUND OR v_role.rolsuper OR v_role.rolinherit OR v_role.rolcreaterole OR v_role.rolcreatedb OR v_role.rolreplication OR v_role.rolbypassrls OR v_role.rolcanlogin OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members AS membership WHERE membership.member = v_role.oid OR membership.roleid = v_role.oid) THEN
    RAISE EXCEPTION 'privacy_workflow_owner post-revoke role contract failed';
  END IF;
END;
$g026_role_postcondition$;
"""
PUBLIC_SCHEMA_GRANT = """DO $g026_public_schema_grant$
DECLARE
  v_postgres_usage text;
  v_postgres_create text;
  v_owner_usage text;
  v_owner_create text;
BEGIN
  v_postgres_usage := pg_catalog.current_setting('g026.public_schema_postgres_usage', true);
  v_postgres_create := pg_catalog.current_setting('g026.public_schema_postgres_create', true);
  v_owner_usage := pg_catalog.current_setting('g026.public_schema_owner_usage', true);
  v_owner_create := pg_catalog.current_setting('g026.public_schema_owner_create', true);
  IF v_postgres_usage NOT IN ('true', 'false') OR v_postgres_create NOT IN ('true', 'false') OR v_owner_usage NOT IN ('true', 'false') OR v_owner_create NOT IN ('true', 'false') THEN
    RAISE EXCEPTION 'public schema privilege grant contract failed: saved privilege is absent or malformed';
  END IF;
  IF v_postgres_usage = 'false' THEN GRANT USAGE ON SCHEMA public TO postgres; END IF;
  IF v_postgres_create = 'false' THEN GRANT CREATE ON SCHEMA public TO postgres; END IF;
  IF v_owner_usage = 'false' THEN GRANT USAGE ON SCHEMA public TO privacy_workflow_owner; END IF;
  IF v_owner_create = 'false' THEN GRANT CREATE ON SCHEMA public TO privacy_workflow_owner; END IF;
END;
$g026_public_schema_grant$;"""
PUBLIC_SCHEMA_REVOKE = """DO $g026_public_schema_revoke$
DECLARE
  v_postgres_usage text;
  v_postgres_create text;
  v_owner_usage text;
  v_owner_create text;
BEGIN
  v_postgres_usage := pg_catalog.current_setting('g026.public_schema_postgres_usage', true);
  v_postgres_create := pg_catalog.current_setting('g026.public_schema_postgres_create', true);
  v_owner_usage := pg_catalog.current_setting('g026.public_schema_owner_usage', true);
  v_owner_create := pg_catalog.current_setting('g026.public_schema_owner_create', true);
  IF v_postgres_usage NOT IN ('true', 'false') OR v_postgres_create NOT IN ('true', 'false') OR v_owner_usage NOT IN ('true', 'false') OR v_owner_create NOT IN ('true', 'false') THEN
    RAISE EXCEPTION 'public schema privilege cleanup contract failed: saved privilege is absent or malformed';
  END IF;
  IF v_postgres_usage = 'false' THEN REVOKE USAGE ON SCHEMA public FROM postgres; END IF;
  IF v_postgres_create = 'false' THEN REVOKE CREATE ON SCHEMA public FROM postgres; END IF;
  IF v_owner_usage = 'false' THEN REVOKE USAGE ON SCHEMA public FROM privacy_workflow_owner; END IF;
  IF v_owner_create = 'false' THEN REVOKE CREATE ON SCHEMA public FROM privacy_workflow_owner; END IF;
END;
$g026_public_schema_revoke$;"""
PUBLIC_SCHEMA_PRECONDITION = """DO $g026_public_schema_precondition$
DECLARE
  v_schema_count integer;
  v_nspacl_snapshot text;
  v_postgres_usage boolean;
  v_postgres_create boolean;
  v_owner_usage boolean;
  v_owner_create boolean;
BEGIN
  SELECT count(*) INTO v_schema_count FROM pg_catalog.pg_namespace AS namespace_row WHERE namespace_row.nspname = 'public';
  IF v_schema_count <> 1 THEN
    RAISE EXCEPTION 'public schema ACL snapshot pre-grant contract failed';
  END IF;
  SELECT CASE WHEN namespace_row.nspacl IS NULL THEN 'nspacl:null' ELSE 'nspacl:json:' || COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(acl_row.grantor, acl_row.grantee, acl_row.privilege_type, acl_row.is_grantable) ORDER BY acl_row.grantor, acl_row.grantee, acl_row.privilege_type, acl_row.is_grantable)::text FROM pg_catalog.aclexplode(namespace_row.nspacl) AS acl_row), '[]') END INTO v_nspacl_snapshot FROM pg_catalog.pg_namespace AS namespace_row WHERE namespace_row.nspname = 'public';
  v_postgres_usage := pg_catalog.has_schema_privilege('postgres', 'public', 'USAGE');
  v_postgres_create := pg_catalog.has_schema_privilege('postgres', 'public', 'CREATE');
  v_owner_usage := pg_catalog.has_schema_privilege('privacy_workflow_owner', 'public', 'USAGE');
  v_owner_create := pg_catalog.has_schema_privilege('privacy_workflow_owner', 'public', 'CREATE');
  PERFORM pg_catalog.set_config('g026.public_schema_nspacl', v_nspacl_snapshot, true);
  PERFORM pg_catalog.set_config('g026.public_schema_postgres_usage', v_postgres_usage::text, true);
  PERFORM pg_catalog.set_config('g026.public_schema_postgres_create', v_postgres_create::text, true);
  PERFORM pg_catalog.set_config('g026.public_schema_owner_usage', v_owner_usage::text, true);
  PERFORM pg_catalog.set_config('g026.public_schema_owner_create', v_owner_create::text, true);
END;
$g026_public_schema_precondition$;"""
PUBLIC_SCHEMA_POSTCONDITION = """DO $g026_public_schema_postcondition$
DECLARE
  v_schema_count integer;
  v_nspacl_snapshot text;
  v_saved_snapshot text;
  v_postgres_usage text;
  v_postgres_create text;
  v_owner_usage text;
  v_owner_create text;
BEGIN
  v_saved_snapshot := pg_catalog.current_setting('g026.public_schema_nspacl', true);
  v_postgres_usage := pg_catalog.current_setting('g026.public_schema_postgres_usage', true);
  v_postgres_create := pg_catalog.current_setting('g026.public_schema_postgres_create', true);
  v_owner_usage := pg_catalog.current_setting('g026.public_schema_owner_usage', true);
  v_owner_create := pg_catalog.current_setting('g026.public_schema_owner_create', true);
  IF v_saved_snapshot IS NULL OR v_postgres_usage NOT IN ('true', 'false') OR v_postgres_create NOT IN ('true', 'false') OR v_owner_usage NOT IN ('true', 'false') OR v_owner_create NOT IN ('true', 'false') THEN
    RAISE EXCEPTION 'public schema ACL snapshot post-revoke contract failed: saved state is absent or malformed';
  END IF;
  SELECT count(*) INTO v_schema_count FROM pg_catalog.pg_namespace AS namespace_row WHERE namespace_row.nspname = 'public';
  IF v_schema_count <> 1 THEN
    RAISE EXCEPTION 'public schema ACL snapshot post-revoke contract failed';
  END IF;
  SELECT CASE WHEN namespace_row.nspacl IS NULL THEN 'nspacl:null' ELSE 'nspacl:json:' || COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(acl_row.grantor, acl_row.grantee, acl_row.privilege_type, acl_row.is_grantable) ORDER BY acl_row.grantor, acl_row.grantee, acl_row.privilege_type, acl_row.is_grantable)::text FROM pg_catalog.aclexplode(namespace_row.nspacl) AS acl_row), '[]') END INTO v_nspacl_snapshot FROM pg_catalog.pg_namespace AS namespace_row WHERE namespace_row.nspname = 'public';
  IF v_nspacl_snapshot IS DISTINCT FROM v_saved_snapshot OR pg_catalog.has_schema_privilege('postgres', 'public', 'USAGE') <> (v_postgres_usage = 'true') OR pg_catalog.has_schema_privilege('postgres', 'public', 'CREATE') <> (v_postgres_create = 'true') OR pg_catalog.has_schema_privilege('privacy_workflow_owner', 'public', 'USAGE') <> (v_owner_usage = 'true') OR pg_catalog.has_schema_privilege('privacy_workflow_owner', 'public', 'CREATE') <> (v_owner_create = 'true') THEN
    RAISE EXCEPTION 'public schema ACL snapshot post-revoke contract failed';
  END IF;
END;
$g026_public_schema_postcondition$;"""
PUBLIC_SCHEMA_GRANT_ANCHOR = 'CREATE FUNCTION public.consume_tzuyang_address_evidence_admin_approval(\n'
PUBLIC_SCHEMA_TARGET_OWNER_ANCHOR = 'ALTER FUNCTION public.consume_tzuyang_address_evidence_admin_approval(\n'
RELOCATED_FINAL_CONTRACT = """DO $g026_final_contract$
BEGIN
  PERFORM privacy_retention.assert_g014_workflow_owner_contract();
END;
$g026_final_contract$;
"""
PRIVATE_SCHEMA_USAGE_GRANT = 'GRANT USAGE ON SCHEMA privacy_retention TO postgres;'
PRIVATE_FUNCTION_EXECUTE_GRANT = 'GRANT EXECUTE ON FUNCTION privacy_retention.assert_g014_workflow_owner_contract() TO postgres;'
PRIVATE_FUNCTION_EXECUTE_REVOKE = 'REVOKE EXECUTE ON FUNCTION privacy_retention.assert_g014_workflow_owner_contract() FROM postgres;'
PRIVATE_SCHEMA_USAGE_REVOKE = 'REVOKE USAGE ON SCHEMA privacy_retention FROM postgres;'
PRIVATE_PRIVILEGE_POSTCONDITION = """DO $g026_private_privilege_postcondition$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_namespace AS namespace_row
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(namespace_row.nspacl, pg_catalog.acldefault('n', namespace_row.nspowner))
    ) AS acl_row
    WHERE namespace_row.nspname = 'privacy_retention'
      AND acl_row.grantee = (SELECT role_row.oid FROM pg_catalog.pg_roles AS role_row WHERE role_row.rolname = 'postgres')
      AND acl_row.privilege_type = 'USAGE'
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
    ) AS acl_row
    WHERE procedure.oid = pg_catalog.to_regprocedure('privacy_retention.assert_g014_workflow_owner_contract()')
      AND acl_row.grantee = (SELECT role_row.oid FROM pg_catalog.pg_roles AS role_row WHERE role_row.rolname = 'postgres')
      AND acl_row.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'postgres explicit private privilege post-revoke contract failed';
  END IF;
END;
$g026_private_privilege_postcondition$;"""
CATALOG_SCHEMA_USAGE_GRANT = 'GRANT USAGE ON SCHEMA privacy_retention TO postgres;'
CATALOG_FUNCTION_EXECUTE_GRANT = 'GRANT EXECUTE ON FUNCTION privacy_retention.assert_g014_catalog_contract() TO postgres;'
CATALOG_FUNCTION_EXECUTE_REVOKE = 'REVOKE EXECUTE ON FUNCTION privacy_retention.assert_g014_catalog_contract() FROM postgres;'
CATALOG_SCHEMA_USAGE_REVOKE = 'REVOKE USAGE ON SCHEMA privacy_retention FROM postgres;'
CATALOG_PRIVILEGE_POSTCONDITION = """DO $g026_catalog_privilege_postcondition$
DECLARE
  v_postgres_oid oid;
BEGIN
  SELECT role_row.oid INTO v_postgres_oid FROM pg_catalog.pg_roles AS role_row WHERE role_row.rolname = 'postgres';
  IF NOT FOUND OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_namespace AS namespace_row
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(namespace_row.nspacl, pg_catalog.acldefault('n', namespace_row.nspowner))
    ) AS acl_row
    WHERE namespace_row.nspname = 'privacy_retention'
      AND acl_row.grantee = v_postgres_oid
      AND acl_row.privilege_type = 'USAGE'
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
    ) AS acl_row
    WHERE procedure.oid = pg_catalog.to_regprocedure('privacy_retention.assert_g014_catalog_contract()')
      AND acl_row.grantee = v_postgres_oid
      AND acl_row.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'postgres explicit catalog assertion privilege post-revoke contract failed';
  END IF;
END;
$g026_catalog_privilege_postcondition$;"""
ROLE_MANAGEMENT_BINDING = {
    'authority': 'postgres',
    'executor': 'postgres',
    'rationale': 'Replay executes as postgres with two transaction-scoped, non-superuser compatibility membership windows for source-required OWNER and default-ACL operations: the first also grants postgres only the G014 private-schema USAGE and exact contract-function EXECUTE necessary before demotion; the second exists solely to revoke those direct grants. A single public USAGE/CREATE window grants only postgres and the G013 source-required target owner privacy_workflow_owner, allowing the source CREATE FUNCTION and ALTER FUNCTION OWNER operations. Every temporary membership and privilege is revoked and fail-closed asserted before the preserved NOTIFY and commit.',
    'removedStatement': ROLE_MANAGEMENT_STATEMENT,
    'beginStatement': 'BEGIN;',
    'grantStatement': 'GRANT privacy_workflow_owner TO postgres;',
    'revokeStatement': 'REVOKE privacy_workflow_owner FROM postgres;',
    'postcondition': ROLE_MANAGEMENT_POSTCONDITION,
    'commitStatement': 'COMMIT;',
    'files': [
        {'filename': '20260713000450_g013_address_admin_approval.sql', 'sourceSha256': 'f5d513aba329b3b1a6e12a76d8947f43c247257a379500d7ed5a45486f1c364a', 'transformedSha256': '1a4c119bb9f26927c2f9f3fbc8476946018ff05f246c0d7b64e60e4a53bdda30', 'removedStatementCount': 1, 'roleValidationTerminator': '$role$;', 'publicSchemaGrantStatement': PUBLIC_SCHEMA_GRANT, 'publicSchemaRevokeStatement': PUBLIC_SCHEMA_REVOKE, 'publicSchemaPrecondition': PUBLIC_SCHEMA_PRECONDITION, 'publicSchemaPostcondition': PUBLIC_SCHEMA_POSTCONDITION, 'publicSchemaGrantAnchor': PUBLIC_SCHEMA_GRANT_ANCHOR, 'publicSchemaTargetOwnerAnchor': PUBLIC_SCHEMA_TARGET_OWNER_ANCHOR, 'revokeAnchor': "NOTIFY pgrst, 'reload schema';\n", 'notifyAnchor': "NOTIFY pgrst, 'reload schema';\n", 'finalContractTerminator': None, 'removedFinalContractInvocation': None, 'removedFinalContractInvocationCount': 0, 'relocatedFinalContractInvocation': None},
        {'filename': '20260713002000_g014_public_api_private_boundary.sql', 'sourceSha256': 'b3bea6e4f4b1649d3f7eebd719386473a22534551cbff5f69cafc3a05844c6f9', 'transformedSha256': '0c935031e8098a896f0c49268fd2f48c99af4d3c63df8d94f6e32e861c885a7a', 'removedStatementCount': 1, 'roleValidationTerminator': '$role$;', 'publicSchemaGrantStatement': None, 'publicSchemaRevokeStatement': None, 'publicSchemaPrecondition': None, 'publicSchemaPostcondition': None, 'publicSchemaGrantAnchor': None, 'publicSchemaTargetOwnerAnchor': None, 'revokeAnchor': '$final_contract$;\n', 'notifyAnchor': "NOTIFY pgrst, 'reload schema';\n", 'finalContractTerminator': '$final_contract$;', 'removedFinalContractInvocation': '  PERFORM privacy_retention.assert_g014_workflow_owner_contract();\n', 'removedFinalContractInvocationCount': 1, 'relocatedFinalContractInvocation': RELOCATED_FINAL_CONTRACT, 'privateSchemaUsageGrantStatement': PRIVATE_SCHEMA_USAGE_GRANT, 'privateFunctionExecuteGrantStatement': PRIVATE_FUNCTION_EXECUTE_GRANT, 'privateFunctionExecuteRevokeStatement': PRIVATE_FUNCTION_EXECUTE_REVOKE, 'privateSchemaUsageRevokeStatement': PRIVATE_SCHEMA_USAGE_REVOKE, 'privatePrivilegePostcondition': PRIVATE_PRIVILEGE_POSTCONDITION, 'bridgeMembershipGrantStatement': 'GRANT privacy_workflow_owner TO postgres;', 'bridgeMembershipRevokeStatement': 'REVOKE privacy_workflow_owner FROM postgres;', 'cleanupMembershipGrantStatement': 'GRANT privacy_workflow_owner TO postgres;', 'cleanupMembershipRevokeStatement': 'REVOKE privacy_workflow_owner FROM postgres;'},
    ],
}


def require_role_management_replay_transform(transform):
    if transform != ROLE_MANAGEMENT_BINDING:
        raise ValueError('role-management transform binding drifted')
    for binding in transform['files']:
        raw = (ROOT / 'backend/supabase/migrations' / binding['filename']).read_bytes()
        if hashlib.sha256(raw).hexdigest() != binding['sourceSha256']:
            raise ValueError('role-management immutable source hash drifted')
        removed = transform['removedStatement'].encode('ascii')
        role_anchor = (binding['roleValidationTerminator'] + '\n').encode('ascii')
        revoke_anchor = binding['revokeAnchor'].encode('ascii')
        notify_anchor = binding['notifyAnchor'].encode('ascii')
        begin = (transform['beginStatement'] + '\n').encode('ascii')
        grant = (transform['grantStatement'] + '\n').encode('ascii')
        revoke = (transform['revokeStatement'] + '\n').encode('ascii')
        postcondition = transform['postcondition'].encode('ascii')
        commit = (transform['commitStatement'] + '\n').encode('ascii')
        is_g013 = binding['filename'] == '20260713000450_g013_address_admin_approval.sql'
        is_g014 = binding['filename'] == '20260713002000_g014_public_api_private_boundary.sql'
        if is_g013:
            if (not all(isinstance(binding[name], str) and binding[name] for name in (
                    'publicSchemaGrantStatement', 'publicSchemaRevokeStatement',
                    'publicSchemaPrecondition', 'publicSchemaPostcondition', 'publicSchemaGrantAnchor',
                    'publicSchemaTargetOwnerAnchor'))
                    or any(binding[name] is not None for name in (
                        'finalContractTerminator', 'removedFinalContractInvocation',
                        'relocatedFinalContractInvocation'))
                    or binding['removedFinalContractInvocationCount'] != 0):
                raise ValueError('G013 public-schema compatibility binding drifted')
            public_schema_grant = (binding['publicSchemaGrantStatement'] + '\n').encode('ascii')
            public_schema_revoke = (binding['publicSchemaRevokeStatement'] + '\n').encode('ascii')
            public_schema_precondition = (binding['publicSchemaPrecondition'] + '\n').encode('ascii')
            public_schema_postcondition = (binding['publicSchemaPostcondition'] + '\n').encode('ascii')
            public_schema_anchor = binding['publicSchemaGrantAnchor'].encode('ascii')
            public_schema_target_owner_anchor = binding['publicSchemaTargetOwnerAnchor'].encode('ascii')
            relocated_final_contract = b''
            private_schema_usage_grant = b''
            private_function_execute_grant = b''
            private_function_execute_revoke = b''
            private_schema_usage_revoke = b''
            private_privilege_postcondition = b''
            bridge_membership_grant = b''
            bridge_membership_revoke = b''
            cleanup_membership_grant = b''
            cleanup_membership_revoke = b''
        elif is_g014:
            if (any(binding[name] is not None for name in (
                        'publicSchemaGrantStatement', 'publicSchemaRevokeStatement',
                        'publicSchemaPrecondition', 'publicSchemaPostcondition', 'publicSchemaGrantAnchor',
                        'publicSchemaTargetOwnerAnchor'))
                    or not all(isinstance(binding[name], str) and binding[name] for name in (
                        'finalContractTerminator', 'removedFinalContractInvocation',
                        'relocatedFinalContractInvocation', 'privateSchemaUsageGrantStatement',
                        'privateFunctionExecuteGrantStatement', 'privateFunctionExecuteRevokeStatement',
                    'privateSchemaUsageRevokeStatement', 'privatePrivilegePostcondition',
                    'bridgeMembershipGrantStatement', 'bridgeMembershipRevokeStatement',
                    'cleanupMembershipGrantStatement', 'cleanupMembershipRevokeStatement'))
                    or binding['removedFinalContractInvocationCount'] != 1):
                raise ValueError('G014 final-contract compatibility binding drifted')
            public_schema_grant = b''
            public_schema_revoke = b''
            public_schema_precondition = b''
            public_schema_postcondition = b''
            public_schema_anchor = b''
            public_schema_target_owner_anchor = b''
            relocated_final_contract = binding['relocatedFinalContractInvocation'].encode('ascii')
            private_schema_usage_grant = (binding['privateSchemaUsageGrantStatement'] + '\n').encode('ascii')
            private_function_execute_grant = (binding['privateFunctionExecuteGrantStatement'] + '\n').encode('ascii')
            private_function_execute_revoke = (binding['privateFunctionExecuteRevokeStatement'] + '\n').encode('ascii')
            private_schema_usage_revoke = (binding['privateSchemaUsageRevokeStatement'] + '\n').encode('ascii')
            private_privilege_postcondition = (binding['privatePrivilegePostcondition'] + '\n').encode('ascii')
            bridge_membership_grant = (binding['bridgeMembershipGrantStatement'] + '\n').encode('ascii')
            bridge_membership_revoke = (binding['bridgeMembershipRevokeStatement'] + '\n').encode('ascii')
            cleanup_membership_grant = (binding['cleanupMembershipGrantStatement'] + '\n').encode('ascii')
            cleanup_membership_revoke = (binding['cleanupMembershipRevokeStatement'] + '\n').encode('ascii')
            if (bridge_membership_grant != grant or bridge_membership_revoke != revoke
                    or cleanup_membership_grant != grant or cleanup_membership_revoke != revoke):
                raise ValueError('G014 membership compatibility binding drifted')
        else:
            raise ValueError('role-management transform filename is not allowlisted')
        if raw.count(removed) != binding['removedStatementCount']:
            raise ValueError('role-management redundant statement count drifted')
        if raw.count(role_anchor) != 1 or raw.count(revoke_anchor) != 1 or raw.count(notify_anchor) != 1:
            raise ValueError('role-management anchor count drifted')
        if public_schema_grant and (not public_schema_revoke or not public_schema_precondition or not public_schema_postcondition
                                    or raw.count(public_schema_anchor) != 1
                                    or raw.count(public_schema_target_owner_anchor) != 1
                                    or raw.count(public_schema_grant) or raw.count(public_schema_revoke)
                                    or raw.count(public_schema_precondition) or raw.count(public_schema_postcondition)):
            raise ValueError('public-schema compatibility binding drifted')
        transformed = begin + raw.replace(removed, b'', 1)
        transformed = transformed.replace(role_anchor, role_anchor + grant, 1)
        if public_schema_grant:
            transformed = transformed.replace(public_schema_anchor, public_schema_precondition + public_schema_grant + public_schema_anchor, 1)
        if binding['finalContractTerminator'] is not None:
            final_anchor = (binding['finalContractTerminator'] + '\n').encode('ascii')
            invocation = binding['removedFinalContractInvocation'].encode('ascii')
            if (transformed.count(final_anchor) != 1
                    or transformed.count(invocation) != binding['removedFinalContractInvocationCount']
                    or not relocated_final_contract):
                raise ValueError('role-management final-contract anchor drifted')
            transformed = transformed.replace(invocation, b'', 1)
            transformed = transformed.replace(final_anchor, final_anchor + private_schema_usage_grant + private_function_execute_grant + bridge_membership_revoke + postcondition + relocated_final_contract + cleanup_membership_grant + private_function_execute_revoke + private_schema_usage_revoke + cleanup_membership_revoke + postcondition + private_privilege_postcondition, 1)
        else:
            transformed = transformed.replace(revoke_anchor, public_schema_revoke + public_schema_postcondition + revoke + postcondition + revoke_anchor, 1)
        transformed = transformed.replace(notify_anchor, notify_anchor + commit, 1)
        if (transformed.count(begin) != 1 or transformed.count(grant) != (2 if bridge_membership_grant else 1)
                or transformed.count(revoke) != (2 if bridge_membership_revoke else 1)
                or transformed.count(postcondition) != (2 if bridge_membership_revoke else 1)
                or transformed.count(commit) != 1
                or (public_schema_grant and (transformed.count(public_schema_grant) != 1
                    or transformed.count(public_schema_revoke) != 1
                    or transformed.count(public_schema_precondition) != 1
                    or transformed.count(public_schema_postcondition) != 1))
                or (relocated_final_contract and transformed.count(relocated_final_contract) != 1)
                or (private_schema_usage_grant and (transformed.count(private_schema_usage_grant) != 1
                    or transformed.count(private_function_execute_grant) != 1
                    or transformed.count(private_function_execute_revoke) != 1
                    or transformed.count(private_schema_usage_revoke) != 1
                    or transformed.count(private_privilege_postcondition) != 1))):
            raise ValueError('role-management transform statement count drifted')
        if (not transformed.startswith(begin) or transformed.find(grant) != transformed.find(role_anchor) + len(role_anchor)
                or transformed.find(commit) != transformed.find(notify_anchor) + len(notify_anchor)
                or (bridge_membership_revoke and (
                    transformed.find(private_schema_usage_grant) <= transformed.find(grant)
                    or transformed.find(private_function_execute_grant) != transformed.find(private_schema_usage_grant) + len(private_schema_usage_grant)
                    or transformed.find(bridge_membership_revoke) != transformed.find(private_function_execute_grant) + len(private_function_execute_grant)
                    or transformed.find(postcondition) != transformed.find(bridge_membership_revoke) + len(bridge_membership_revoke)
                    or transformed.find(relocated_final_contract) != transformed.find(postcondition) + len(postcondition)
                    or transformed.rfind(cleanup_membership_grant) != transformed.find(relocated_final_contract) + len(relocated_final_contract)
                    or transformed.find(private_function_execute_revoke) != transformed.rfind(cleanup_membership_grant) + len(cleanup_membership_grant)
                    or transformed.find(private_schema_usage_revoke) != transformed.find(private_function_execute_revoke) + len(private_function_execute_revoke)
                    or transformed.rfind(cleanup_membership_revoke) != transformed.find(private_schema_usage_revoke) + len(private_schema_usage_revoke)
                    or transformed.rfind(postcondition) != transformed.rfind(cleanup_membership_revoke) + len(cleanup_membership_revoke)
                    or transformed.find(private_privilege_postcondition) != transformed.rfind(postcondition) + len(postcondition)
                    or transformed.find(private_privilege_postcondition) >= transformed.find(notify_anchor)))
                or (not bridge_membership_revoke and (
                    transformed.find(revoke) >= transformed.find(notify_anchor)
                    or transformed.find(postcondition) != transformed.find(revoke) + len(revoke)))
                or (public_schema_grant and (transformed.find(public_schema_precondition) != transformed.find(public_schema_grant) - len(public_schema_precondition)
                    or transformed.find(public_schema_grant) != transformed.find(public_schema_anchor) - len(public_schema_grant)
                    or transformed.find(public_schema_target_owner_anchor) <= transformed.find(public_schema_anchor)
                    or transformed.find(public_schema_revoke) <= transformed.find(public_schema_target_owner_anchor)
                    or transformed.find(public_schema_revoke) >= transformed.find(revoke)
                    or transformed.find(public_schema_postcondition) != transformed.find(public_schema_revoke) + len(public_schema_revoke)
                    or transformed.find(public_schema_postcondition) >= transformed.find(revoke)))):
            raise ValueError('role-management transform ordering drifted')
        if (b'ADMIN OPTION' in transformed or b'GRANT privacy_workflow_owner TO supabase_admin' in transformed
                or b'SET ROLE' in transformed or b'GRANT CREATE ON SCHEMA public TO PUBLIC' in transformed):
            raise ValueError('role-management privilege drifted')
        if hashlib.sha256(transformed).hexdigest() != binding['transformedSha256']:
            raise ValueError('role-management transformed hash drifted')

def require_replay_membership_windows(window):
    expected_names = (
        '20260713002100_g014_privacy_workflows.sql',
        '20260713002200_g014_marketing_state_machine.sql',
        '20260713002300_g014_account_deletion_state_machine.sql',
        '20260713002400_g014_retention_adapters_receipts.sql',
        '20260713002500_g014_catalog_contract.sql',
        '20260713002600_g014_account_deletion_receipt_parity.sql',
        '20260812000200_local_public_read_policy_convergence.sql',
        '20260812000300_local_admin_data_boundary_convergence.sql',
        '20260812000400_local_admin_map_overlay_boundary_convergence.sql',
    )
    expected_window_keys = {
        'authority', 'member', 'role', 'precondition', 'grantStatement',
        'revokeStatement', 'postcondition', 'catalogSchemaUsageGrantStatement',
        'catalogFunctionExecuteGrantStatement', 'cleanupMembershipGrantStatement',
        'catalogFunctionExecuteRevokeStatement', 'catalogSchemaUsageRevokeStatement',
        'cleanupMembershipRevokeStatement', 'catalogPrivilegePostcondition',
        'files', 'finalZeroMembershipProof',
    }
    if (set(window) != expected_window_keys
            or window['authority'] != 'postgres' or window['member'] != 'postgres'
            or window['role'] != 'privacy_workflow_owner'
            or window['finalZeroMembershipProof'] != window['postcondition']
            or not isinstance(window['files'], list)
            or tuple(item.get('filename') for item in window['files']) != expected_names):
        raise ValueError('replay membership window binding drifted')
    precondition = (window['precondition'] + '\n').encode('ascii')
    grant = (window['grantStatement'] + '\n').encode('ascii')
    revoke = (window['revokeStatement'] + '\n').encode('ascii')
    postcondition = (window['postcondition'] + '\n').encode('ascii')
    catalog_schema_usage_grant = (window['catalogSchemaUsageGrantStatement'] + '\n').encode('ascii')
    catalog_function_execute_grant = (window['catalogFunctionExecuteGrantStatement'] + '\n').encode('ascii')
    catalog_function_execute_revoke = (window['catalogFunctionExecuteRevokeStatement'] + '\n').encode('ascii')
    catalog_schema_usage_revoke = (window['catalogSchemaUsageRevokeStatement'] + '\n').encode('ascii')
    catalog_privilege_postcondition = (window['catalogPrivilegePostcondition'] + '\n').encode('ascii')
    cleanup_membership_grant = (window['cleanupMembershipGrantStatement'] + '\n').encode('ascii')
    cleanup_membership_revoke = (window['cleanupMembershipRevokeStatement'] + '\n').encode('ascii')
    if (window['grantStatement'] != 'GRANT privacy_workflow_owner TO postgres;'
            or window['revokeStatement'] != 'REVOKE privacy_workflow_owner FROM postgres;'
            or b'pg_auth_members' not in precondition or b'pg_auth_members' not in postcondition
            or window['catalogSchemaUsageGrantStatement'] != CATALOG_SCHEMA_USAGE_GRANT
            or window['catalogFunctionExecuteGrantStatement'] != CATALOG_FUNCTION_EXECUTE_GRANT
            or window['cleanupMembershipGrantStatement'] != window['grantStatement']
            or window['catalogFunctionExecuteRevokeStatement'] != CATALOG_FUNCTION_EXECUTE_REVOKE
            or window['catalogSchemaUsageRevokeStatement'] != CATALOG_SCHEMA_USAGE_REVOKE
            or window['cleanupMembershipRevokeStatement'] != window['revokeStatement']
            or window['catalogPrivilegePostcondition'] != CATALOG_PRIVILEGE_POSTCONDITION):
        raise ValueError('replay membership authority drifted')
    for item in window['files']:
        if set(item) != {'filename', 'sourceSha256', 'sourceByteLength', 'transformedSha256',
                         'transformedByteLength', 'mode', 'anchor', 'cleanupAnchor'}:
            raise ValueError('replay membership file binding drifted')
        raw = (ROOT / 'backend/supabase/migrations' / item['filename']).read_bytes()
        if (len(raw) != item['sourceByteLength']
                or hashlib.sha256(raw).hexdigest() != item['sourceSha256']):
            raise ValueError('replay membership immutable source hash drifted')
        source = raw.decode('utf-8')
        if item['mode'] == 'reuse_source_transaction':
            if item['filename'] != expected_names[3] or item['anchor'] != 'BEGIN;\n' or item['cleanupAnchor'] != '\nCOMMIT;':
                raise ValueError('replay membership transaction reuse drifted')
            transformed = source.replace(item['anchor'], item['anchor'] + precondition.decode() + grant.decode(), 1)
            transformed = transformed.replace(item['cleanupAnchor'], '\n' + revoke.decode() + postcondition.decode() + 'COMMIT;', 1)
        elif item['mode'] == 'revoke_before_catalog_assertion':
            if item['filename'] != expected_names[4] or item['anchor'] != 'SELECT privacy_retention.assert_g014_catalog_contract();\n' or item['cleanupAnchor']:
                raise ValueError('catalog assertion membership ordering drifted')
            transformed = 'BEGIN;\n' + precondition.decode() + grant.decode() + source.replace(
                item['anchor'],
                catalog_schema_usage_grant.decode()
                + catalog_function_execute_grant.decode()
                + revoke.decode()
                + postcondition.decode()
                + item['anchor']
                + cleanup_membership_grant.decode()
                + catalog_function_execute_revoke.decode()
                + catalog_schema_usage_revoke.decode()
                + cleanup_membership_revoke.decode()
                + postcondition.decode()
                + catalog_privilege_postcondition.decode(),
                1,
            ) + 'COMMIT;\n'
        elif item['mode'] == 'wrapper_transaction':
            if item['anchor'] or item['cleanupAnchor']:
                raise ValueError('replay membership wrapper anchor drifted')
            transformed = 'BEGIN;\n' + precondition.decode() + grant.decode() + source + revoke.decode() + postcondition.decode() + 'COMMIT;\n'
        else:
            raise ValueError('replay membership mode drifted')
        encoded = transformed.encode('utf-8')
        if (len(encoded) != item['transformedByteLength']
                or hashlib.sha256(encoded).hexdigest() != item['transformedSha256']):
            raise ValueError('replay membership transformed hash drifted')
        expected_membership_count = 2 if item['mode'] == 'revoke_before_catalog_assertion' else 1
        if (encoded.count(grant) != expected_membership_count
                or encoded.count(revoke) != expected_membership_count
                or encoded.count(precondition) != 1
                or b'SET LOCAL ROLE privacy_workflow_owner;' in encoded
                or b'RESET ROLE;' in encoded
                or encoded.count(postcondition) != expected_membership_count
                or encoded.find(grant) <= encoded.find(precondition)
                or encoded.find(revoke) <= encoded.find(grant)):
            raise ValueError('replay membership transaction ordering drifted')
        if item['mode'] == 'revoke_before_catalog_assertion':
            catalog_statements = (
                catalog_schema_usage_grant,
                catalog_function_execute_grant,
                revoke,
                postcondition,
                item['anchor'].encode('ascii'),
                cleanup_membership_grant,
                catalog_function_execute_revoke,
                catalog_schema_usage_revoke,
                cleanup_membership_revoke,
                postcondition,
                catalog_privilege_postcondition,
            )
            expected_counts = (1, 1, 2, 2, 1, 2, 1, 1, 2, 2, 1)
            positions = [
                encoded.find(catalog_schema_usage_grant),
                encoded.find(catalog_function_execute_grant),
                encoded.find(revoke),
                encoded.find(postcondition),
                encoded.find(item['anchor'].encode('ascii')),
                encoded.rfind(cleanup_membership_grant),
                encoded.find(catalog_function_execute_revoke),
                encoded.find(catalog_schema_usage_revoke),
                encoded.rfind(cleanup_membership_revoke),
                encoded.rfind(postcondition),
                encoded.find(catalog_privilege_postcondition),
            ]
            if (tuple(encoded.count(statement) for statement in catalog_statements) != expected_counts
                    or positions != sorted(positions)):
                raise ValueError('catalog assertion privilege ordering drifted')


def require_self_contained_replay(binding):
    expected = {
        'canonicalPath': 'backend/supabase/migrations/20260813085342_current_profile_mutation_boundary.sql',
        'filename': '20260813085342_current_profile_mutation_boundary.sql',
        'predecessorFilename': '20260812000700_local_profile_leaderboard_page_convergence.sql',
        'sourceSha256': '15f4d240222d4b7abdbfd0b27a5c36142a2f61c4cc9d9fdf4638588fee9b29e3',
        'sourceByteLength': 56880,
        'transactionClass': 'self_committing',
    }
    if binding != expected:
        raise ValueError('self-contained replay binding drifted')
    source_path = ROOT / binding['canonicalPath']
    if source_path.parent != ROOT / 'backend/supabase/migrations' or source_path.name != binding['filename']:
        raise ValueError('self-contained replay canonical path drifted')
    raw = source_path.read_bytes()
    if len(raw) != binding['sourceByteLength'] or hashlib.sha256(raw).hexdigest() != binding['sourceSha256']:
        raise ValueError('self-contained replay immutable source hash drifted')
    source = raw.decode('utf-8')
    executable = re.sub(r'\A(?:\s|--[^\n]*(?:\n|\Z)|/\*.*?\*/)*', '', source, flags=re.DOTALL)
    if not executable.startswith('BEGIN;\n') or not executable.rstrip().endswith('COMMIT;'):
        raise ValueError('self-contained replay transaction boundary drifted')
    ordered = (
        'DO $membership_acquire$',
        'SET LOCAL ROLE privacy_workflow_owner;',
        'CREATE FUNCTION public.update_current_profile_nickname(',
        'CREATE FUNCTION public.compare_and_set_current_profile_avatar(',
        'CREATE FUNCTION public.read_signup_profile_state(',
        'INSERT INTO privacy_retention.g014_public_rpc_allowlist (',
        'DO $definer_contract$',
        'DO $catalog_contract$',
        'DO $contract_readback$',
        'CREATE TEMPORARY TABLE g014_profile_catalog_assertion_guard (',
        'CREATE FUNCTION pg_temp.g014_profile_catalog_assertion_bridge()',
        'RESET ROLE;',
        'DO $membership_restore$',
        'DO $membership_postcondition$',
        'DO $catalog_assertion_readback$',
    )
    if any(source.count(statement) != 1 for statement in ordered):
        raise ValueError('self-contained replay terminal statement count drifted')
    positions = [source.index(statement) for statement in ordered]
    if positions != sorted(positions):
        raise ValueError('self-contained replay terminal ordering drifted')
    if source.count('\nBEGIN;\n') != 1 or source.count('\nCOMMIT;\n') != 1:
        raise ValueError('self-contained replay transaction count drifted')


def resolve_repo_path(value, filename):
    expected_relative = PurePosixPath(
        'backend/supabase/baselines/historical/pre-20260214-application',
        filename,
    )
    if not isinstance(value, str) or '\\' in value:
        raise ValueError(f'{filename} path must be a POSIX repository-relative path')
    path = PurePosixPath(value)
    if (path.is_absolute() or PureWindowsPath(value).is_absolute()
            or not value or any(part in ('', '.', '..') for part in value.split('/'))):
        raise ValueError(f'{filename} path must be a normalized repository-relative path')
    if path != expected_relative:
        raise ValueError(f'{filename} path binding drifted')
    resolved = ROOT.joinpath(*path.parts).resolve()
    expected = ROOT.joinpath(*expected_relative.parts).resolve()
    if resolved != expected or ROOT not in resolved.parents:
        raise ValueError(f'{filename} path escapes repository root')
    return resolved


def require_approve_new_restaurant_submission_guards(repairs, matrix):
    body = function_body(repairs, 'approve_new_restaurant_submission')
    expected = (
        ('invalid_request', '신규 제보 승인 요청 형식이 올바르지 않습니다. (new submission approval request must be an object)', "jsonb_typeof(p_geocoded_data)<>'object'"),
        ('invalid_keys', '신규 제보 승인 요청 키가 올바르지 않습니다. (new submission approval request keys must be items)', "NOT p_geocoded_data ? 'items'"),
        ('empty_items', '승인할 신규 제보 항목이 없습니다. (no new submission items were supplied)', "jsonb_array_length(p_geocoded_data->'items')=0"),
        ('invalid_item', '신규 제보 승인 항목이 객체가 아닙니다. (new submission item must be an object)', "jsonb_typeof(v_payload_item)<>'object'"),
        ('invalid_item_id', '신규 제보 항목 ID 형식이 올바르지 않습니다. (new submission item id must be a UUID)', "v_item_id_text !~"),
        ('duplicate_item_id', '신규 제보 항목 ID가 중복되었습니다. (new submission item ids must be unique)', 'count(DISTINCT supplied.id)'),
        ('omitted_pending_item', '모든 대기 신규 제보 항목을 포함해야 합니다. (all pending new submission items are required)', 'v_supplied_ids<>v_pending_ids'),
    )
    rows = {
        (row.get('condition'), row.get('success'), row.get('message'), row.get('writes'))
        for row in matrix if isinstance(row, dict) and row.get('rpc') == 'approve_new_restaurant_submission'
    }
    positions = []
    for condition, message, token in expected:
        if (condition, False, message, 'none') not in rows:
            raise ValueError(f'approve_new_restaurant_submission matrix guard drifted: {condition}')
        if token not in body or message not in body:
            raise ValueError(f'approve_new_restaurant_submission executable guard drifted: {condition}')
        positions.append(body.index(token))
    call_position = body.index('public.approve_submission_item')
    if positions != sorted(positions) or any(position >= call_position for position in positions):
        raise ValueError('approve_new_restaurant_submission guard ordering drifted')
    for token in (
        "jsonb_typeof(p_geocoded_data->'items')<>'array'",
        '(SELECT count(*) FROM jsonb_object_keys(p_geocoded_data))<>1',
        "(SELECT count(*) FROM jsonb_object_keys(v_payload_item))<>2",
        "v_item_id_text::uuid",
        'FOR UPDATE',
        'array_agg(supplied.id ORDER BY supplied.id)',
        'ORDER BY data.item_id',
    ):
        if token not in body:
            raise ValueError(f'approve_new_restaurant_submission fail-closed contract drifted: {token}')
    if body.index('FOR UPDATE') >= call_position or body.index('ORDER BY data.item_id') >= call_position:
        raise ValueError('approve_new_restaurant_submission lock/order drifted')

def main():
    try:
        data = json.loads(BUNDLE.read_text(encoding='utf-8'), object_pairs_hook=pairs)
        if set(data) != TOP_KEYS:
            raise ValueError('unknown or missing G026 bundle keys')
        if data['schemaVersion'] != 5 or data['reconstructionAuthorized'] is not False:
            raise ValueError('G026 must remain source-only and unauthorized')
        if data['reconstructionArchiveSha256'] != ARCHIVE or data['historicalSourceArchiveSha256'] != HISTORICAL:
            raise ValueError('archive binding drifted')
        if data['purpose'] != 'source-only empty-clean-replay synthesis; not historical application proof or hosted-state evidence':
            raise ValueError('purpose claim drifted')
        for name, filename in (('transition', 'G026_RECONSTRUCTION_TRANSITION.v4.sql'), ('repairs', 'G026_RECONSTRUCTION_REPAIRS.v4.sql')):
            binding = data[name]
            expected = resolve_repo_path(binding.get('path'), filename)
            raw = expected.read_bytes()
            if name == 'transition':
                normalized = lf_normalized_bytes(raw)
                if raw != normalized:
                    raise ValueError('transition must use committed LF bytes')
                if binding['byteLength'] != len(normalized) or binding['sha256'] != hashlib.sha256(normalized).hexdigest():
                    raise ValueError('transition LF byte/hash binding drifted')
            elif binding['byteLength'] != len(raw) or binding['sha256'] != hashlib.sha256(raw).hexdigest():
                raise ValueError(f'{name} byte/hash binding drifted')
        if data['transition']['byteLength'] != TRANSITION_BYTES or data['transition']['sha256'] != TRANSITION_SHA256:
            raise ValueError('transition recovery binding drifted')
        require_lower_sha256(data['transition']['sha256'], 'transition hash must be lowercase SHA-256')
        if data['validationLedger'] != [
            {'ordinal': 0, 'mode': 'off', 'kind': 'preexisting_ordinal0_body_deferral'},
            {'ordinal': 6, 'mode': 'off', 'kind': 'g026_ordinal6_quarantine'},
        ]:
            raise ValueError('validation ledger drifted')
        if data['slots'] != {'phaseAAfterOrdinal': 2, 'phaseBBeforeMigration': '20260713002000_g014_public_api_private_boundary.sql'}:
            raise ValueError('phase slot drifted')
        require_role_management_replay_transform(data['roleManagementReplayTransform'])
        require_replay_membership_windows(data['replayMembershipWindows'])
        require_self_contained_replay(data['selfContainedReplay'])
        transition = (BASE / 'G026_RECONSTRUCTION_TRANSITION.v4.sql').read_text(encoding='utf-8')
        repairs = (BASE / 'G026_RECONSTRUCTION_REPAIRS.v4.sql').read_text(encoding='utf-8')
        require_approve_restaurant_signature(repairs, APPROVE_RESTAURANT_PREDECESSOR.read_text(encoding='utf-8'))
        require_jsonl_import_signatures(repairs)
        require_obsolete_overload_drops(
            repairs, data['obsoleteOverloadDrops'], data['synthesizedCompatibilityBindings']
        )
        require_synthesized_compatibility_bindings(
            repairs, data['synthesizedCompatibilityBindings']
        )
        require_reconstruction_policy_shells(repairs)
        require_legacy_shape_normalization(transition, data['legacyShapeNormalization'])
        require_ad_banners_source(transition, data['adBanners'])
        require_user_bookmarks_source(transition, data['userBookmarks'])
        require_short_urls_source(transition, data['shortUrls'])
        require_storyboard_base_tables_source(transition, data['storyboardBaseTables'])
        require_search_logs_source(transition, data['searchLogs'])
        require_restaurants_duplicate_source(transition, data['restaurantsDuplicate'])
        require_admin_workflow_pipeline_source(transition, data['adminWorkflowPipeline'])
        require(transition, 'BEGIN;', 'CREATE SCHEMA IF NOT EXISTS extensions AUTHORIZATION postgres;', 'CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;', 'CREATE EXTENSION IF NOT EXISTS fuzzystrmatch WITH SCHEMA extensions;', 'CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;', TRANSITION_OPERATOR, 'SAVEPOINT g026_hnsw_probe;', 'CREATE INDEX g026_hnsw_probe_vectors_embedding_hnsw_idx ON public.g026_hnsw_probe_vectors USING hnsw', 'ROLLBACK TO SAVEPOINT g026_hnsw_probe;', 'RELEASE SAVEPOINT g026_hnsw_probe;', "to_regclass('public.g026_hnsw_probe_vectors') IS NOT NULL", 'LOCK TABLE public.profiles, public.reviews, public.restaurants, public.restaurant_submissions, public.restaurant_submission_items IN ACCESS EXCLUSIVE MODE;', 'ALTER TABLE public.restaurants RENAME COLUMN name TO approved_name;', 'ALTER TABLE public.restaurants RENAME COLUMN unique_id TO trace_id;', 'ALTER TABLE public.restaurants_backup OWNER TO postgres;', 'FORCE ROW LEVEL SECURITY', 'target_restaurant_id uuid', *EXTENSION_ASSERTION_MESSAGES)
        require_restaurant_columns(transition)
        checkpoint_start = transition.index('DO $$ BEGIN')
        checkpoint = transition[checkpoint_start:transition.index('END $$;', checkpoint_start)]
        if GENERIC_EXTENSION_ASSERTION in checkpoint or checkpoint.count('IF ') != len(EXTENSION_ASSERTION_MESSAGES):
            raise ValueError('extension capability checkpoint must use individual assertions')
        positions = []
        for message in EXTENSION_ASSERTION_MESSAGES:
            assertion = f"THEN RAISE EXCEPTION '{message}'"
            position = checkpoint.find(assertion)
            if position < 0:
                raise ValueError(f'extension capability assertion drifted: {message}')
            positions.append(position)
        if positions != sorted(positions):
            raise ValueError('extension capability assertion order drifted')
        if PRIOR_SPACED_TRANSITION_OPERATOR in transition:
            raise ValueError('prior spaced to_regoperator spelling exists')
        require(repairs, "current_setting('check_function_bodies') <> 'on'", 'G026 pre-body checkpoint failed: submission backup target contract is missing', 'SECURITY DEFINER SET search_path TO public', 'FOR UPDATE', 'g026_upsert_restaurant_backup', "MESSAGE='음식점 생성/재사용에 실패했습니다.'", "RETURN QUERY SELECT false,SQLERRM,NULL::uuid; RETURN;", 'unsupported jsonl key:', 'invalid jsonl field:')
        if re.search(r'public\.restaurants\s*\([^)]*\bname\b', repairs, re.DOTALL):
            raise ValueError('legacy restaurants.name reference exists')
        hashes = data['canonicalBodyHashes']
        if set(hashes) != set(FUNCTIONS):
            raise ValueError('canonical body hash keys drifted')
        for name in FUNCTIONS:
            if hashes[name] != digest(function_body(repairs, name)):
                raise ValueError(f'canonical body hash drifted: {name}')
        matrix = data['apiMatrix']
        if not isinstance(matrix, list) or len(matrix) < 30:
            raise ValueError('API matrix is incomplete')
        require_approve_new_restaurant_submission_guards(repairs, matrix)
        required_rows = {
            ('approve_submission_item', 'new_restaurant_id_is_null', False, '음식점 생성/재사용에 실패했습니다.', 'none'),
            ('approve_new_restaurant_submission', 'duplicate_item_id', False, '신규 제보 항목 ID가 중복되었습니다. (new submission item ids must be unique)', 'none'),
            ('approve_restaurant', 'non_service_role', None, 'service_role required', 'none'),
            ('batch_insert_restaurants_from_jsonl', 'record_failure', None, None, 'per-record'),
        }
        got = {(r.get('rpc'), r.get('condition'), r.get('success'), r.get('message'), r.get('writes')) for r in matrix if isinstance(r, dict)}
        if not required_rows <= got:
            raise ValueError('API matrix required outcome drifted')
        if data['extensionFingerprint'] != {'schema': 'extensions', 'extensions': ['vector', 'fuzzystrmatch', 'pgcrypto'], 'probeAbsent': ['public.g026_hnsw_probe_vectors', 'public.g026_hnsw_probe_vectors_embedding_hnsw_idx']}:
            raise ValueError('extension fingerprint drifted')
    except Exception as exc:
        print(f'G026 verification failed: {exc}', file=sys.stderr)
        return 1
    print('G026 source-only empty-replay bundle verified')
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
