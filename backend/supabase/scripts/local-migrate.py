#!/usr/bin/env python3
"""Fail-closed local Supabase migration planner and executor.

Only ``backend/supabase/migrations`` is an admissible source.  This tool never
accepts a DSN, hosted manifest, historical reconstruction bundle, or data
archive.  ``manifest``, ``verify`` and ``dry-run`` are database-free.  ``apply``
uses one Docker-local psql executor and requires an explicit local-container
admission flag.
"""
from __future__ import annotations

import argparse
import importlib.util
import os
import hashlib
import json
import re
import shutil
import stat
import subprocess
import sys
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, build_opener, HTTPRedirectHandler

SCHEMA_VERSION = "local-supabase-migration-manifest/v1"
COMPOSE_VERSION = "v2.39.4"
LOCAL_STACK_GENERATOR_VERSION = "local-stack-v1"
LOCAL_ENV_PROVENANCE_SCHEMA = "local-stack-env-provenance-v1"
LOCAL_INPUT_PROVENANCE_SCHEMA = "local-stack-input-provenance-v2"
LOCAL_STACK_RECEIPT_SCHEMA = "local-stack-receipt-v1"
AMBIGUITY_MARKER = "migration-ambiguity.json"
RECEIPT_SCHEMA = "local-receipt-v1"
RECEIPT_SERIALIZER = "receipt-v1"
RECEIPT_TOP_LEVEL_FIELDS = frozenset({
    "source_manifest_sha256",
    "source_chain_sha256",
    "input_source_manifest_sha256",
    "input_evidence_sha256",
    "compose_evidence_sha256",
    "function_source_sha256",
    "seed_source_sha256",
    "prerequisite_sha256",
    "platform_bootstrap_sha256",
    "platform_bootstrap_evidence_sha256",
    "sequence",
    "sequence_sha256",
    "closure_binding_sha256",
    "schema",
    "serializer",
    "project_name",
    "stack_provenance",
    "config_sha256",
    "input_provenance_sha256",
    "env_provenance_sha256",
    "environment_contract_sha256",
    "image_digests",
    "image_service_digests",
    "commit_sha256",
    "ledger",
    "readback_sql_sha256",
    "readback",
    "service",
    "readback_sha256",
    "catalog_sha256",
    "seed_sha256",
    "ledger_sha256",
    "service_sha256",
})
STACK_PROVENANCE_FIELDS = frozenset({
    "schema",
    "project_name",
    "renderer",
    "generator_version",
    "config_sha256",
    "input_provenance_sha256",
    "env_provenance_sha256",
    "environment_contract_sha256",
    "image_digests",
    "image_service_digests",
    "input_source_manifest_sha256",
    "input_evidence_sha256",
    "compose_evidence_sha256",
    "function_source_sha256",
    "commit_sha256",
    "readback_sql_sha256",
})
NIGHTLY_EMAIL = "nightly-ci@local.invalid"
REMOTE_DOCKER_ENV = ("DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH", "DOCKER_CONFIG")
DOCKER_SOCKET_ADMISSION_ENV = "TZUDONG_DOCKER_SOCKET_ADMISSION_FILE"
GITHUB_ACTIONS_REPOSITORY = "twoimo/tzudong"
_GITHUB_ACTIONS_ADMISSION_PATH = re.compile(
    r"^/run/tzudong-nightly-local-admission-([1-9][0-9]*)-([1-9][0-9]*)$"
)
PLAN_VERSION = "local-supabase-migration-plan/v1"
LEDGER_TABLE = "_tzudong_local.migration_ledger"
EXPECTED_SOURCE = Path("backend/supabase/migrations")
PREREQUISITE_SOURCE = Path("backend/supabase/baselines/pre-20260214-public-schema.sql")
PREREQUISITE_OUTPUT = Path("backend/supabase/baselines/local/application-prerequisites.sql")
PREREQUISITE_MANIFEST = Path("backend/supabase/baselines/local/APPLICATION_PREREQUISITES.v1.json")
PREREQUISITE_TRANSFORM_VERSION = "local-application-prerequisite-v1"
BASELINE_REMOVALS = (
    r"\restrict CFkUqswlnIOxGIipA4VAbdNrwJZOQL0n0ud8ggBuRxMk3QqgorIxPnrRTjeg9VD",
    "SET transaction_timeout = 0;",
    "CREATE SCHEMA public;",
    r"\unrestrict CFkUqswlnIOxGIipA4VAbdNrwJZOQL0n0ud8ggBuRxMk3QqgorIxPnrRTjeg9VD",
)
MIGRATION_ORDER_OVERRIDES = {
    "20260417_prevent_active_restaurant_identity_duplicates.sql": 0,
    "20260417_harden_submission_identity_duplicate_checks.sql": 1,
}
SEED_SOURCE = Path("backend/supabase/scripts/local-seed.sql")
READBACK_SOURCE = Path("backend/supabase/scripts/local_catalog_readback.sql")
EXPECTED_LEDGER_UNITS = 73
EXPECTED_SERVICES = (
    "analytics", "auth", "db", "functions", "imgproxy", "kong", "mail",
    "meta", "realtime", "rest", "storage", "studio", "supavisor", "vector",
)
NIGHTLY_PASSWORD_ENV = "NIGHTLY_ADMIN_PASSWORD"
NIGHTLY_LOGICAL_ID = "nightly-ci"
LOCAL_PRIVACY_POLICY_FIXTURE_ID = "local-nightly-policy"
LOCAL_PRIVACY_POLICY_VERSION = "2026-08-04.1"
LOCAL_PRIVACY_POLICY_CONTENT_SHA256 = "6e42ced065a6ea0762b85d9b5e11500fcfc535543ab50d12ffbe6490086a110b"
LOCAL_PRIVACY_POLICY_PROVENANCE = "LOCAL_TEST_ONLY:NOT_PRODUCTION:nightly-ci:privacy-policy-fixture-v1"
LOCAL_YOUTUBE_CHANNEL_PROVENANCE = "LOCAL_TEST_ONLY:NOT_PRODUCTION:nightly-ci:youtube-channel-snapshot-v1"
PLATFORM_BOOTSTRAP_ID = "local-platform-bootstrap-v1"
PLATFORM_BOOTSTRAP_SOURCE = "backend/supabase/scripts/local-migrate.py:LOCAL_PLATFORM_BOOTSTRAP_SQL"
AUTH_API_SCHEMA = "local-gotrue-auth-api-v1"
AUTH_API_CREATE_PATH = "/auth/v1/admin/users"
AUTH_API_LOGIN_PATH = "/auth/v1/token?grant_type=password"
PLATFORM_BOOTSTRAP_SQL = b"""-- local-platform-bootstrap-v1
BEGIN;
DROP POLICY IF EXISTS local_nightly_avatar_read ON storage.objects;
CREATE POLICY local_nightly_avatar_read ON storage.objects
  AS PERMISSIVE
  FOR SELECT TO anon, authenticated USING (bucket_id = 'avatars');
DROP POLICY IF EXISTS local_nightly_avatar_insert ON storage.objects;
CREATE POLICY local_nightly_avatar_insert ON storage.objects
  AS PERMISSIVE
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'avatars');
DO $local_platform_realtime$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'profiles'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
  END IF;
END
$local_platform_realtime$;
COMMIT;
"""
PLATFORM_BOOTSTRAP_SHA256 = "4a663410d96f0a92dac2d84cc8696fd5f0975f1772262bb9bf253d1f8d2ef350"
SEQUENCE_MARKERS = ("prerequisite", "migration", "closure", "platform-bootstrap", "seed")
BASELINE_ANNOUNCEMENT_IDS = frozenset({
    "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "a7b8c9d0-e1f2-3456-0123-789012345678",
    "b2c3d4e5-f6a7-8901-bcde-f23456789012",
    "b8c9d0e1-f2a3-4567-1234-890123456789",
    "c3d4e5f6-a7b8-9012-cdef-345678901234",
    "c9d0e1f2-a3b4-5678-2345-901234567890",
    "d0e1f2a3-b4c5-6789-3456-012345678901",
    "d4e5f6a7-b8c9-0123-def0-456789012345",
    "e5f6a7b8-c9d0-1234-ef01-567890123456",
    "f6a7b8c9-d0e1-2345-f012-678901234567",
})
FIXTURE_TIMESTAMP = "2026-01-01T00:00:00Z"
LOCAL_ENV_KEYS = frozenset({
    "PROJECT_NAME", "LOCAL_STATE_ROOT", "LOCAL_INPUT_ROOT",
    "POSTGRES_PASSWORD", "NIGHTLY_ADMIN_EMAIL", "NIGHTLY_ADMIN_PASSWORD",
    "JWT_SECRET", "ANON_KEY", "SERVICE_ROLE_KEY", "STORAGE_SERVICE_KEY", "DASHBOARD_USERNAME",
    "DASHBOARD_PASSWORD", "SECRET_KEY_BASE", "VAULT_ENC_KEY", "PG_META_CRYPTO_KEY",
    "POSTGRES_HOST", "POSTGRES_DB", "POSTGRES_PORT", "POSTGRES_HOST_PORT",
    "POOLER_PROXY_PORT_TRANSACTION", "POOLER_DEFAULT_POOL_SIZE", "POOLER_MAX_CLIENT_CONN",
    "POOLER_TENANT_ID", "POOLER_DB_POOL_SIZE", "KONG_HTTP_PORT", "KONG_HTTPS_PORT",
    "STUDIO_PORT", "META_PORT", "ANALYTICS_PORT", "PGRST_DB_SCHEMAS", "SITE_URL",
    "ADDITIONAL_REDIRECT_URLS", "JWT_EXPIRY", "DISABLE_SIGNUP", "API_EXTERNAL_URL",
    "MAILER_URLPATHS_CONFIRMATION", "MAILER_URLPATHS_INVITE", "MAILER_URLPATHS_RECOVERY",
    "MAILER_URLPATHS_EMAIL_CHANGE", "ENABLE_EMAIL_SIGNUP", "ENABLE_EMAIL_AUTOCONFIRM",
    "SMTP_ADMIN_EMAIL", "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS",
    "SMTP_SENDER_NAME", "ENABLE_ANONYMOUS_USERS", "ENABLE_PHONE_SIGNUP",
    "ENABLE_PHONE_AUTOCONFIRM", "STUDIO_DEFAULT_ORGANIZATION", "STUDIO_DEFAULT_PROJECT",
    "SUPABASE_PUBLIC_URL", "IMGPROXY_ENABLE_WEBP_DETECTION", "OPENAI_API_KEY",
    "FUNCTIONS_VERIFY_JWT", "LOGFLARE_PUBLIC_ACCESS_TOKEN", "LOGFLARE_PRIVATE_ACCESS_TOKEN",
    "DOCKER_SOCKET_LOCATION", "LOCAL_STACK_GENERATOR_VERSION", "MAIL_SMTP_PORT",
    "MAIL_WEB_PORT", "MAIL_POP3_PORT", "SUPABASE_DB_URL",
})
RECEIPT_ENV_CONTRACT_KEYS = (
    "PROJECT_NAME",
    "LOCAL_STATE_ROOT",
    "LOCAL_INPUT_ROOT",
    "NIGHTLY_ADMIN_EMAIL",
    "DASHBOARD_USERNAME",
    "POSTGRES_HOST",
    "POSTGRES_DB",
    "POSTGRES_PORT",
    "POSTGRES_HOST_PORT",
    "POOLER_PROXY_PORT_TRANSACTION",
    "POOLER_DEFAULT_POOL_SIZE",
    "POOLER_MAX_CLIENT_CONN",
    "POOLER_TENANT_ID",
    "POOLER_DB_POOL_SIZE",
    "KONG_HTTP_PORT",
    "KONG_HTTPS_PORT",
    "STUDIO_PORT",
    "META_PORT",
    "ANALYTICS_PORT",
    "MAIL_SMTP_PORT",
    "MAIL_WEB_PORT",
    "MAIL_POP3_PORT",
    "PGRST_DB_SCHEMAS",
    "SITE_URL",
    "ADDITIONAL_REDIRECT_URLS",
    "API_EXTERNAL_URL",
    "JWT_EXPIRY",
    "DISABLE_SIGNUP",
    "MAILER_URLPATHS_CONFIRMATION",
    "MAILER_URLPATHS_INVITE",
    "MAILER_URLPATHS_RECOVERY",
    "MAILER_URLPATHS_EMAIL_CHANGE",
    "ENABLE_EMAIL_SIGNUP",
    "ENABLE_EMAIL_AUTOCONFIRM",
    "SMTP_ADMIN_EMAIL",
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_USER",
    "SMTP_SENDER_NAME",
    "ENABLE_ANONYMOUS_USERS",
    "ENABLE_PHONE_SIGNUP",
    "ENABLE_PHONE_AUTOCONFIRM",
    "STUDIO_DEFAULT_ORGANIZATION",
    "STUDIO_DEFAULT_PROJECT",
    "SUPABASE_PUBLIC_URL",
    "IMGPROXY_ENABLE_WEBP_DETECTION",
    "FUNCTIONS_VERIFY_JWT",
    "DOCKER_SOCKET_LOCATION",
    "LOCAL_STACK_GENERATOR_VERSION",
)
ENVIRONMENT_CONTRACT_SCHEMA = "local-stack-environment-contract-v1"
READBACK_SECTIONS = (
    "extensions",
    "roles",
    "schemas",
    "relations",
    "columns",
    "constraints",
    "indexes",
    "functions",
    "policies",
    "triggers",
    "storage_buckets",
    "storage_policies",
    "realtime_membership",
    "public_read_function_grants",
    "public_read_table_grants",
    "public_read_policies",
    "caller_bound_admin_policies",
    "admin_data_rpcs",
    "admin_data_table_grants",
    "admin_map_overlay_rpc",
    "admin_map_overlay_table_grants",
    "admin_map_overlay_policies",
    "auth_users",
    "auth_identities",
    "profiles",
    "user_roles",
    "user_account_status",
    "privacy_policy_fixture",
    "privacy_age_profile",
    "youtube_channel_snapshot",
    "restaurants",
    "announcements",
    "seed_buckets",
    "seed_realtime",
)
CATALOG_SECTIONS = READBACK_SECTIONS[:22]
SEED_SECTIONS = READBACK_SECTIONS[22:]
CATALOG_FIELDS = {
    "extensions": ("name", "schema", "version", "owner"),
    "roles": ("name", "superuser", "create_db", "create_role", "can_login", "member_of"),
    "schemas": ("name", "owner"),
    "relations": ("schema", "name", "relkind", "owner"),
    "columns": ("schema", "relation", "ordinal", "name", "formatted_type", "not_null", "default_expression"),
    "constraints": ("schema", "relation", "name", "constraint_type", "normalized_definition"),
    "indexes": ("schema", "relation", "name", "normalized_definition"),
    "functions": (
        "schema",
        "identity_arguments",
        "return_type",
        "security_definer",
        "volatility",
        "declared_search_path",
        "normalized_definition_sha256",
    ),
    "policies": ("schema", "relation", "name", "command", "roles", "normalized_using", "normalized_check"),
    "triggers": ("schema", "relation", "name", "timing", "events", "normalized_definition"),
    "storage_buckets": ("id", "name", "public", "file_size_limit", "allowed_mime_types"),
    "storage_policies": ("schema", "relation", "name", "command", "roles", "normalized_using", "normalized_check"),
    "realtime_membership": ("publication", "schema", "relation"),
    "public_read_function_grants": ("function", "role", "execute"),
    "public_read_table_grants": (
        "relation",
        "role",
        "select",
        "insert",
        "update",
        "delete",
    ),
    "public_read_policies": (
        "relation",
        "name",
        "command",
        "roles",
        "normalized_using",
        "normalized_check",
    ),
    "caller_bound_admin_policies": (
        "relation",
        "name",
        "command",
        "roles",
        "helper_dependency_count",
        "uid_dependency_count",
        "legacy_dependency_count",
    ),
    "admin_data_rpcs": (
        "function",
        "result",
        "owner",
        "security_definer",
        "volatility",
        "declared_search_path",
        "service_execute",
        "anon_execute",
        "authenticated_execute",
        "allowlisted_service",
    ),
    "admin_data_table_grants": (
        "relation",
        "select",
        "insert",
        "update",
        "delete",
    ),
    "admin_map_overlay_rpc": (
        "function",
        "result",
        "owner",
        "security_definer",
        "volatility",
        "declared_search_path",
        "service_execute",
        "anon_execute",
        "authenticated_execute",
        "uses_claims_role",
        "uses_legacy_claim_role",
        "uses_auth_role",
        "uses_restaurant_for_share",
        "owner_auth_schema_usage",
        "allowlisted_service",
    ),
    "admin_map_overlay_table_grants": (
        "relation",
        "role",
        "select",
        "insert",
        "update",
        "delete",
        "truncate",
        "references",
        "trigger",
    ),
    "admin_map_overlay_policies": (
        "relation",
        "name",
        "command",
        "roles",
        "normalized_using",
        "normalized_check",
    ),
}
SEED_FIELDS = {
    "auth_users": ("logical_id", "email", "aud", "role", "email_confirmed"),
    "auth_identities": ("logical_id", "provider", "identity_email"),
    "profiles": ("logical_id", "username", "nickname", "role", "email", "updated_at"),
    "user_roles": ("logical_id", "role"),
    "user_account_status": ("logical_id", "account_status", "disabled_at_is_null"),
    "privacy_policy_fixture": (
        "fixture_id",
        "version",
        "locale",
        "status",
        "content_sha256",
        "effective_at",
        "published_at",
        "operator_approval_ref",
        "supersedes_is_null",
    ),
    "privacy_age_profile": (
        "logical_id",
        "age_band",
        "method",
        "status",
        "policy_version",
        "attested_at",
        "updated_at",
    ),
    "youtube_channel_snapshot": (
        "fixture_id",
        "channel_id",
        "channel_title",
        "channel_handle",
        "subscriber_count",
        "view_count",
        "video_count",
        "hidden_subscriber_count",
        "previous_bucket_is_null",
        "subscriber_delta",
        "view_delta",
        "video_delta",
        "bucket_started_at",
        "fetched_at",
        "source",
    ),
    "restaurants": ("id", "trace_id", "approved_name", "status", "categories", "created_at", "updated_at"),
    "announcements": ("id", "title", "content", "is_active", "show_on_banner", "priority", "created_at", "updated_at"),
    "seed_buckets": ("id", "name", "public"),
    "seed_realtime": ("publication", "schema", "relation"),
}
READBACK_FIELDS = {**CATALOG_FIELDS, **SEED_FIELDS}
AUTH_VOLATILE_FIELDS = (
    "id",
    "instance_id",
    "created_at",
    "updated_at",
    "last_sign_in_at",
    "confirmation_token",
    "confirmation_sent_at",
    "recovery_token",
    "recovery_sent_at",
    "email_change_token",
    "email_change",
    "email_change_sent_at",
    "encrypted_password",
)
AUTH_SCHEMA_COLUMN_ALLOWLIST = {
    "audit_log_entries": (
        "instance_id", "id", "payload", "created_at", "ip_address",
    ),
    "flow_state": (
        "id", "user_id", "auth_code", "code_challenge_method", "code_challenge",
        "provider_type", "provider_access_token", "provider_refresh_token",
        "created_at", "updated_at", "authentication_method", "auth_code_issued_at",
    ),
    "identities": (
        "provider_id", "user_id", "identity_data", "provider", "last_sign_in_at",
        "created_at", "updated_at", "email", "id",
    ),
    "instances": ("id", "uuid", "raw_base_config", "created_at", "updated_at"),
    "mfa_amr_claims": ("session_id", "created_at", "updated_at", "authentication_method", "id"),
    "mfa_challenges": (
        "id", "factor_id", "created_at", "verified_at", "ip_address", "otp_code",
        "web_authn_session_data",
    ),
    "mfa_factors": (
        "id", "user_id", "friendly_name", "factor_type", "status", "created_at",
        "updated_at", "secret", "phone", "last_challenged_at", "web_authn_credential",
        "web_authn_aaguid", "last_webauthn_challenge_data",
    ),
    "oauth_authorizations": (
        "id", "authorization_id", "client_id", "user_id", "redirect_uri", "scope",
        "state", "resource", "code_challenge", "code_challenge_method",
        "response_type", "status", "authorization_code", "created_at", "expires_at",
        "approved_at", "nonce",
    ),
    "oauth_client_states": ("id", "provider_type", "code_verifier", "created_at"),
    "oauth_clients": (
        "id", "client_secret_hash", "registration_type", "redirect_uris",
        "grant_types", "client_name", "client_uri", "logo_uri", "created_at",
        "updated_at", "deleted_at", "client_type",
    ),
    "oauth_consents": ("id", "user_id", "client_id", "scopes", "granted_at", "revoked_at"),
    "one_time_tokens": ("id", "user_id", "token_type", "token_hash", "relates_to", "created_at", "updated_at"),
    "refresh_tokens": (
        "instance_id", "id", "token", "user_id", "revoked", "created_at", "updated_at",
        "parent", "session_id",
    ),
    "saml_providers": (
        "id", "sso_provider_id", "entity_id", "metadata_xml", "metadata_url",
        "attribute_mapping", "created_at", "updated_at", "name_id_format",
    ),
    "saml_relay_states": (
        "id", "sso_provider_id", "request_id", "for_email", "redirect_to",
        "created_at", "updated_at", "flow_state_id",
    ),
    "schema_migrations": ("version",),
    "sessions": (
        "id", "user_id", "created_at", "updated_at", "factor_id", "aal", "not_after",
        "refreshed_at", "user_agent", "ip", "tag", "oauth_client_id",
        "refresh_token_hmac_key", "refresh_token_counter", "scopes",
    ),
    "sso_domains": ("id", "sso_provider_id", "domain", "created_at", "updated_at"),
    "sso_providers": ("id", "resource_id", "created_at", "updated_at", "disabled"),
    "users": (
        "instance_id", "id", "aud", "role", "email", "encrypted_password",
        "email_confirmed_at", "invited_at", "confirmation_token",
        "confirmation_sent_at", "recovery_token", "recovery_sent_at",
        "email_change_token_new", "email_change", "email_change_sent_at",
        "last_sign_in_at", "raw_app_meta_data", "raw_user_meta_data",
        "is_super_admin", "created_at", "updated_at", "phone", "phone_confirmed_at",
        "phone_change", "phone_change_token", "phone_change_sent_at", "confirmed_at",
        "email_change_token_current", "email_change_confirm_status", "banned_until",
        "reauthentication_token", "reauthentication_sent_at", "is_sso_user",
        "deleted_at", "is_anonymous",
    ),
}
AUTH_COLUMN_ALLOWLIST = AUTH_SCHEMA_COLUMN_ALLOWLIST
AUTH_RELATION_ALLOWLIST = frozenset(AUTH_SCHEMA_COLUMN_ALLOWLIST)
AUTH_SCHEMA_OWNER = "supabase_admin"
INPUT_MANIFEST_SOURCE = Path("backend/supabase/local-inputs/manifest.v1.json")
FUNCTION_SOURCES = (
    "functions/main/index.ts",
    "functions/naver-geocode/index.ts",
)
COMPOSE_SOURCES = (
    Path("backend/supabase/docker-compose.yml"),
    Path("backend/supabase/docker-compose.local.yml"),
    Path("backend/supabase/docker-compose.mail.yml"),
)
_UUID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$")
_HEX64 = re.compile(r"^[0-9a-f]{64}$")
_HEX40 = re.compile(r"^[0-9a-f]{40}$")
_LOCAL_PROJECT = re.compile(r"^tzudong-local-[0-9a-f]{12}$")
_LEDGER_RECEIPT_SQL = b"""SELECT migration_id, ordinal, source_sha256,
       source_byte_length, transaction_class, status, readback_sha256
FROM _tzudong_local.migration_ledger
ORDER BY ordinal, migration_id;
"""
_SEQUENCE_RECEIPT_SQL = b"""SELECT marker, ordinal, evidence_sha256, source_manifest_sha256,
       coalesce(closure_binding_sha256, '')
FROM _tzudong_local.execution_sequence
ORDER BY ordinal;"""
_SERVICE_RECEIPT_SQL = b"""SELECT current_setting('server_version_num'),
current_setting('server_encoding'), current_setting('TimeZone');
"""
_UNIT_READBACK_SQL = """\
SELECT migration_id, ordinal, source_sha256, source_byte_length,
       transaction_class, status, coalesce(readback_sha256, '')
  FROM _tzudong_local.migration_ledger
 WHERE migration_id = {migration_id};
"""
PREREQUISITE_COMPATIBILITY_SQL = """\
-- Compatibility predecessors required by canonical backend migrations.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'admin_workflow_trigger_source') THEN
    CREATE TYPE public.admin_workflow_trigger_source AS ENUM ('schedule', 'manual_admin');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'admin_workflow_correlation_state') THEN
    CREATE TYPE public.admin_workflow_correlation_state AS ENUM (
      'pending_dispatch', 'dispatched_unmatched', 'matched',
      'reconciled_timeout', 'reconciled_error', 'completed'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'admin_workflow_step_status') THEN
    CREATE TYPE public.admin_workflow_step_status AS ENUM (
      'queued', 'running', 'success', 'failed', 'timeout', 'partial', 'skipped'
    );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.admin_workflow_runs (
  run_id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  dispatch_request_id text UNIQUE NOT NULL,
  correlation_key text,
  trigger_source public.admin_workflow_trigger_source NOT NULL,
  requested_by_user_id uuid,
  channel_url_raw text,
  channel_url_normalized text,
  channel_slug text,
  channel_id text,
  workflow_file text NOT NULL DEFAULT 'daily-crawler.yml',
  workflow_ref text NOT NULL DEFAULT 'data',
  github_workflow_id bigint,
  github_run_id bigint,
  github_run_number integer,
  github_run_attempt integer,
  github_status text,
  github_conclusion text,
  correlation_state public.admin_workflow_correlation_state NOT NULL DEFAULT 'pending_dispatch',
  requested_at timestamptz NOT NULL DEFAULT now(),
  dispatched_at timestamptz,
  matched_at timestamptz,
  completed_at timestamptz,
  dedupe_of_run_id uuid REFERENCES public.admin_workflow_runs(run_id),
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.admin_workflow_steps (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.admin_workflow_runs(run_id) ON DELETE CASCADE,
  canonical_step_no integer NOT NULL CHECK (canonical_step_no BETWEEN 1 AND 12),
  canonical_step_key text NOT NULL,
  script_step_label text,
  status public.admin_workflow_step_status NOT NULL DEFAULT 'queued',
  started_at timestamptz,
  ended_at timestamptz,
  duration_ms bigint,
  message text,
  row_delta jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempt integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(run_id, canonical_step_no)
);
CREATE TABLE IF NOT EXISTS public.admin_workflow_signals (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id uuid REFERENCES public.admin_workflow_runs(run_id) ON DELETE CASCADE,
  signal_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_workflow_runs_requested_at
  ON public.admin_workflow_runs(requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_workflow_runs_state
  ON public.admin_workflow_runs(correlation_state, github_status);
CREATE INDEX IF NOT EXISTS idx_admin_workflow_steps_run
  ON public.admin_workflow_steps(run_id, canonical_step_no);
CREATE INDEX IF NOT EXISTS idx_admin_workflow_signals_run
  ON public.admin_workflow_signals(run_id, created_at DESC);
ALTER TABLE public.admin_workflow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_workflow_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_workflow_signals ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS public.restaurant_popular_rank_snapshots (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  scope_key text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  rank integer NOT NULL CHECK (rank > 0),
  weekly_search_count integer NOT NULL DEFAULT 0 CHECK (weekly_search_count >= 0),
  captured_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT restaurant_popular_rank_snapshots_period_check CHECK (period_end > period_start),
  CONSTRAINT restaurant_popular_rank_snapshots_restaurant_unique UNIQUE (scope_key, period_start, restaurant_id),
  CONSTRAINT restaurant_popular_rank_snapshots_rank_unique UNIQUE (scope_key, period_start, rank)
);
CREATE INDEX IF NOT EXISTS restaurant_popular_rank_snapshots_lookup_idx
  ON public.restaurant_popular_rank_snapshots (scope_key, period_start DESC, rank ASC);
CREATE INDEX IF NOT EXISTS restaurant_popular_rank_snapshots_restaurant_idx
  ON public.restaurant_popular_rank_snapshots (restaurant_id, period_start DESC);
ALTER TABLE public.restaurant_popular_rank_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public can read popular rank snapshots" ON public.restaurant_popular_rank_snapshots;
CREATE POLICY "Public can read popular rank snapshots"
  ON public.restaurant_popular_rank_snapshots FOR SELECT USING (true);
DO $owner$
DECLARE
  function_row record;
BEGIN
  FOR function_row IN
    SELECT procedure.oid::regprocedure AS signature
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
     WHERE namespace.nspname = 'public' AND procedure.prokind = 'f'
  LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO postgres', function_row.signature);
  END LOOP;
END
$owner$;
DROP FUNCTION IF EXISTS public.create_user_notification(uuid, public.notification_type, text, text, jsonb);
"""
G014_OWNER_NORMALIZATION_SQL = """\
-- Canonical local execution prelude for G014's cross-schema owner contract.
DO $owner_normalization$
DECLARE
  function_row record;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'privacy_workflow_owner'
  ) THEN
    CREATE ROLE privacy_workflow_owner
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOLOGIN
      NOREPLICATION NOBYPASSRLS;
  END IF;
  FOR function_row IN
    SELECT procedure.oid::regprocedure AS signature
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
     WHERE namespace.nspname = 'public' AND procedure.prokind = 'f'
  LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO postgres', function_row.signature);
  END LOOP;
  IF pg_catalog.to_regprocedure(
    'public.consume_tzuyang_address_evidence_admin_approval(uuid,text,text,uuid,text,text,text,timestamptz,timestamptz)'
  ) IS NOT NULL THEN
    ALTER FUNCTION public.consume_tzuyang_address_evidence_admin_approval(
      uuid,text,text,uuid,text,text,text,timestamptz,timestamptz
    ) OWNER TO privacy_workflow_owner;
  END IF;
END
$owner_normalization$;
"""

_CLOUD_INPUT = re.compile(
    r"(?i)(?:postgres(?:ql)?://|supabase\.co|\.supabase\.in|PGHOST\s*=|DATABASE_URL\s*=|aws\.amazonaws\.com|cloud\.google\.com)"
)
_PSQL_META = re.compile(r"(?m)^\s*\\(?:!|copy|connect|include|ir|i|gexec|gset|shell)\b")
_EXTENSION = re.compile(
    r"(?is)\bCREATE\s+EXTENSION\s+(IF\s+NOT\s+EXISTS\s+)?(?P<name>\"?[^\s;\"]+\"?)(?P<tail>[^;]*);"
)
_DDL_DML = re.compile(
    r"(?im)(?:^|;)\s*(?:INSERT|UPDATE|DELETE|MERGE|COPY|TRUNCATE|SELECT|VALUES|CALL|PERFORM)\b"
)
_TRANSACTION = re.compile(
    r"(?im)\b(BEGIN|START\s+TRANSACTION|COMMIT(?:\s+AND\s+CHAIN)?|ROLLBACK(?:\s+AND\s+CHAIN)?|SAVEPOINT|RELEASE\s+SAVEPOINT|SET\s+TRANSACTION)\b"
)
_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_LOCAL_EXTENSIONS = {"vector", "fuzzystrmatch", "pg_trgm", "pgcrypto", "uuid-ossp"}


class LocalMigrationError(RuntimeError):
    """A sanitized, deterministic failure code."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def canonical_json(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":")).encode("ascii")


def repository_root() -> Path:
    # .../backend/supabase/scripts/local-migrate.py -> repository root.
    return Path(__file__).resolve().parents[3]


def source_root() -> Path:
    root = (repository_root() / EXPECTED_SOURCE).resolve(strict=True)
    if not root.is_dir() or root != repository_root() / EXPECTED_SOURCE:
        raise LocalMigrationError("source_root_not_canonical")
    return root


def _relative_source(path: Path, root: Path) -> str:
    try:
        relative = path.resolve(strict=True).relative_to(root)
    except (OSError, ValueError) as error:
        raise LocalMigrationError("source_outside_migrations") from error
    if not relative.parts or any(part in (".", "..") for part in relative.parts):
        raise LocalMigrationError("source_path_invalid")
    return (EXPECTED_SOURCE / relative).as_posix()


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()
def _environment_contract(values: Mapping[str, str]) -> dict[str, str]:
    contract: dict[str, str] = {}
    for key in RECEIPT_ENV_CONTRACT_KEYS:
        value = values.get(key)
        if not isinstance(value, str):
            raise LocalMigrationError("receipt_environment_contract")
        contract[key] = value
    return contract


def _environment_contract_sha256(values: Mapping[str, str]) -> str:
    return _sha256_bytes(
        canonical_json(
            {
                "schema": ENVIRONMENT_CONTRACT_SCHEMA,
                "values": _environment_contract(values),
            }
        )
    )

def _github_actions_root_socket_admission() -> bool:
    admission_value = os.environ.get(DOCKER_SOCKET_ADMISSION_ENV, "")
    repository = os.environ.get("GITHUB_REPOSITORY", "")
    run_id = os.environ.get("GITHUB_RUN_ID", "")
    run_attempt = os.environ.get("GITHUB_RUN_ATTEMPT", "")
    if (
        os.environ.get("GITHUB_ACTIONS") != "true"
        or os.environ.get("CI") != "true"
        or repository != GITHUB_ACTIONS_REPOSITORY
        or re.fullmatch(r"[1-9][0-9]*", run_id) is None
        or re.fullmatch(r"[1-9][0-9]*", run_attempt) is None
    ):
        return False
    match = _GITHUB_ACTIONS_ADMISSION_PATH.fullmatch(admission_value)
    if (
        match is None
        or match.groups() != (run_id, run_attempt)
        or admission_value
        != f"/run/tzudong-nightly-local-admission-{run_id}-{run_attempt}"
    ):
        return False
    admission_path = Path(admission_value)
    try:
        info = admission_path.lstat()
    except OSError:
        return False
    try:
        read_result = subprocess.run(
            ["/usr/bin/sudo", "-n", "--", "/bin/cat", admission_value],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=5,
            check=False,
            env={"PATH": "/usr/bin:/bin", "LANG": "C"},
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    payload = read_result.stdout
    expected = (
        f"repo={repository}\n"
        f"run_id={run_id}\n"
        f"run_attempt={run_attempt}\n"
    ).encode("ascii")
    return (
        not stat.S_ISLNK(info.st_mode)
        and stat.S_ISREG(info.st_mode)
        and info.st_uid == 0
        and stat.S_IMODE(info.st_mode) == 0o400
        and read_result.returncode == 0
        and len(payload) <= 256
        and payload == expected
    )


def _github_actions_root_owned_socket(path: Path, owner: int) -> bool:
    return (
        path == Path("/var/run/docker.sock")
        and owner == 0
        and _github_actions_root_socket_admission()
    )


def _assert_local_docker_context(docker: str) -> None:
    environment = {
        key: value
        for key, value in os.environ.items()
        if key in {"PATH", "HOME", "USER", "TMPDIR", "LANG", "LC_ALL", "TERM"}
    }
    environment.setdefault("PATH", "/usr/bin:/bin")
    environment.setdefault("HOME", str(Path.home()))
    try:
        selected = subprocess.run(
            [docker, "context", "show"],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
            env=environment,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise LocalMigrationError("docker_context") from error
    context = selected.stdout.strip()
    if selected.returncode != 0 or not context or any(char in context for char in "\r\n\t "):
        raise LocalMigrationError("docker_context")
    try:
        inspected = subprocess.run(
            [docker, "context", "inspect", context],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
            env=environment,
        )
        payload = json.loads(inspected.stdout)
        endpoint = payload[0]["Endpoints"]["docker"]["Host"] if payload else None
    except (OSError, subprocess.TimeoutExpired, ValueError, TypeError, KeyError, IndexError) as error:
        raise LocalMigrationError("docker_context") from error
    if inspected.returncode != 0 or not endpoint:
        raise LocalMigrationError("docker_context")
    parsed = urlparse(str(endpoint))
    if parsed.scheme != "unix" or parsed.netloc or parsed.params or parsed.query or parsed.fragment:
        raise LocalMigrationError("docker_context")
    socket_path = Path(parsed.path)
    allowed = {
        Path("/var/run/docker.sock"),
        Path.home() / ".docker" / "run" / "docker.sock",
        Path.home() / ".colima" / "default" / "docker.sock",
    }
    if socket_path not in allowed:
        raise LocalMigrationError("docker_context")
    try:
        info = socket_path.lstat()
    except OSError as error:
        raise LocalMigrationError("docker_context") from error
    owned_by_current_user = info.st_uid == os.getuid()
    owned_by_disposable_ci_root = _github_actions_root_owned_socket(socket_path, info.st_uid)
    if (
        stat.S_ISLNK(info.st_mode)
        or not stat.S_ISSOCK(info.st_mode)
        or not (owned_by_current_user or owned_by_disposable_ci_root)
    ):
        raise LocalMigrationError("docker_context")

def _reject_path_custody(path: Path) -> None:
    try:
        relative = path.resolve(strict=False).relative_to(repository_root())
    except ValueError:
        return
    parts = relative.parts
    if (
        parts[:4] == ("apps", "web", "supabase", "migrations")
        or (parts[:3] == ("backend", "supabase", "baselines") and len(parts) > 3 and parts[3] == "historical")
        or "replay-authorized-false" in path.name.lower()
    ):
        raise LocalMigrationError("historical_or_hosted_source_rejected")

def _sha256_file(path: Path) -> tuple[str, int]:
    try:
        data = path.read_bytes()
    except OSError as error:
        raise LocalMigrationError("source_read_failed") from error
    return _sha256_bytes(data), len(data)


def _require_owned_regular_file(path: Path, error_code: str) -> Path:
    """Admit a declared local file without following an untrusted symlink."""
    try:
        info = path.lstat()
    except OSError as error:
        raise LocalMigrationError(error_code) from error
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid():
        raise LocalMigrationError(error_code)
    try:
        resolved = path.resolve(strict=True)
        resolved_info = resolved.lstat()
    except (OSError, RuntimeError) as error:
        raise LocalMigrationError(error_code) from error
    if (
        stat.S_ISLNK(resolved_info.st_mode)
        or not stat.S_ISREG(resolved_info.st_mode)
        or resolved_info.st_uid != os.getuid()
    ):
        raise LocalMigrationError(error_code)
    return resolved


def _reject_source_text(data: bytes) -> None:
    # Decode only for policy inspection; migration bytes remain untouched.
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as error:
        raise LocalMigrationError("source_not_utf8") from error
    if _CLOUD_INPUT.search(text):
        raise LocalMigrationError("cloud_input_rejected")
    # psql meta-commands can execute host commands or read files and therefore
    # are not admissible in the one in-container executor.
    if _PSQL_META.search(text):
        raise LocalMigrationError("psql_meta_command_rejected")


def migration_files(root: Path | None = None) -> list[Path]:
    root = source_root() if root is None else root.resolve(strict=True)
    if root != source_root():
        raise LocalMigrationError("source_root_not_canonical")
    result: list[Path] = []
    try:
        entries = sorted(
            root.iterdir(),
            key=lambda item: (
                int(item.name.split("_", 1)[0]),
                MIGRATION_ORDER_OVERRIDES.get(item.name, 1000),
                item.name.encode("utf-8"),
            ),
        )
    except OSError as error:
        raise LocalMigrationError("source_list_failed") from error
    for path in entries:
        if path.suffix.lower() != ".sql":
            continue
        try:
            info = path.lstat()
        except OSError as error:
            raise LocalMigrationError("source_file_not_regular") from error
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid():
            raise LocalMigrationError("source_file_not_regular")
        if not re.match(r"^\d{8,14}(?:_|\.)", path.name):
            raise LocalMigrationError("migration_filename_invalid")
        _reject_source_text(path.read_bytes())
        result.append(path)
    if not result:
        raise LocalMigrationError("no_migrations")
    return result


def transaction_control(sql: str | bytes) -> dict[str, Any]:
    text = sql.decode("utf-8") if isinstance(sql, bytes) else sql
    masked = _mask_sql(text)
    tokens = [re.sub(r"\s+", " ", match.group(1).upper()) for match in _TRANSACTION.finditer(masked)]
    has_begin = any(token in {"BEGIN", "START TRANSACTION"} for token in tokens)
    has_commit = any(token.startswith("COMMIT") for token in tokens)
    has_rollback = any(token.startswith("ROLLBACK") for token in tokens)
    has_savepoint = any(token.startswith("SAVEPOINT") or token.startswith("RELEASE") for token in tokens)
    if has_commit or has_rollback:
        classification = "self_committing"
    elif has_begin or has_savepoint:
        classification = "transactional_explicit"
    else:
        classification = "transactional"
    return {
        "class": classification,
        "tokens": tokens,
        "hasBegin": has_begin,
        "hasCommit": has_commit,
        "hasRollback": has_rollback,
        "hasSavepoint": has_savepoint,
    }


def _mask_sql(text: str) -> str:
    """Mask comments and quoted strings while preserving token boundaries."""
    out: list[str] = []
    i = 0
    n = len(text)
    while i < n:
        if text.startswith("--", i):
            end = text.find("\n", i + 2)
            if end < 0:
                out.append(" " * (n - i))
                break
            out.append(" " * (end - i))
            out.append("\n")
            i = end + 1
            continue
        if text.startswith("/*", i):
            end = text.find("*/", i + 2)
            end = n - 2 if end < 0 else end
            chunk = text[i : end + 2]
            out.append("".join("\n" if char == "\n" else " " for char in chunk))
            i = end + 2
            continue
        if text[i] in ("'", '"'):
            quote = text[i]
            j = i + 1
            while j < n:
                if text[j] == quote:
                    if j + 1 < n and text[j + 1] == quote:
                        j += 2
                        continue
                    j += 1
                    break
                j += 1
            chunk = text[i:j]
            out.append("".join("\n" if char == "\n" else " " for char in chunk))
            i = j
            continue
        if text[i] == "$":
            match = re.match(r"\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$", text[i:])
            if match:
                tag = match.group(0)
                end = text.find(tag, i + len(tag))
                end = n - len(tag) if end < 0 else end
                chunk = text[i : end + len(tag)]
                out.append("".join("\n" if char == "\n" else " " for char in chunk))
                i = end + len(tag)
                continue
        out.append(text[i])
        i += 1
    return "".join(out)


def _mask_policy_sql(text: str) -> str:
    """Remove comments/literals but retain dollar bodies for DML inspection."""
    out: list[str] = []
    i = 0
    n = len(text)
    while i < n:
        if text.startswith("--", i):
            end = text.find("\n", i + 2)
            end = n if end < 0 else end
            out.append("".join("\n" if char == "\n" else " " for char in text[i:end]))
            i = end
            continue
        if text.startswith("/*", i):
            end = text.find("*/", i + 2)
            end = n - 2 if end < 0 else end
            chunk = text[i : end + 2]
            out.append("".join("\n" if char == "\n" else " " for char in chunk))
            i = end + 2
            continue
        if text[i] in ("'", '"'):
            quote = text[i]
            end = i + 1
            while end < n:
                if text[end] == quote:
                    if end + 1 < n and text[end + 1] == quote:
                        end += 2
                        continue
                    end += 1
                    break
                end += 1
            chunk = text[i:end]
            out.append("".join("\n" if char == "\n" else " " for char in chunk))
            i = end
            continue
        out.append(text[i])
        i += 1
    return "".join(out)


def build_manifest(root: Path | None = None) -> dict[str, Any]:
    root = source_root() if root is None else root.resolve(strict=True)
    files: list[dict[str, Any]] = []
    chain_parts: list[bytes] = []
    for index, path in enumerate(migration_files(root), start=1):
        data = path.read_bytes()
        digest = _sha256_bytes(data)
        relative = _relative_source(path, root)
        control = transaction_control(data)
        files.append(
            {
                "ordinal": index,
                "path": relative,
                "byteLength": len(data),
                "sha256": digest,
                "transaction": control,
            }
        )
        chain_parts.extend((relative.encode("utf-8"), b"\0", digest.encode("ascii"), b"\n"))
    chain_sha = _sha256_bytes(b"".join(chain_parts))
    return {
        "schemaVersion": SCHEMA_VERSION,
        "source": {
            "root": EXPECTED_SOURCE.as_posix(),
            "migrationCount": len(files),
            "chainSha256": chain_sha,
            "files": files,
        },
        "exclusions": [
            "apps/web/supabase/migrations",
            "backend/supabase/baselines/historical",
            "hosted release manifests",
            "historical replay-authorized-false bundles",
        ],
    }


def manifest_digest(manifest: dict[str, Any]) -> str:
    return _sha256_bytes(canonical_json(manifest))


def verify_manifest(path: Path | None = None) -> dict[str, Any]:
    actual = build_manifest()
    if path is not None:
        supplied_path = _require_owned_regular_file(path, "manifest_read_failed")
        _reject_path_custody(supplied_path)
        try:
            supplied = json.loads(supplied_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
            raise LocalMigrationError("manifest_read_failed") from error
        if not isinstance(supplied, dict) or supplied != actual:
            raise LocalMigrationError("manifest_source_mismatch")
    return actual


def transform_ddl_prerequisite(data: bytes) -> bytes:
    """Validate a DDL-only prerequisite and pin extension objects to extensions."""
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as error:
        raise LocalMigrationError("prerequisite_not_utf8") from error
    if _CLOUD_INPUT.search(text):
        raise LocalMigrationError("cloud_input_rejected")
    if _PSQL_META.search(text):
        raise LocalMigrationError("psql_meta_command_rejected")
    masked = _mask_sql(text)
    # A pg_dump emits one harmless search_path probe. It is not data mutation.
    masked = re.sub(r"(?im)^\s*SELECT\s+pg_catalog\.set_config\([^;]*\);\s*$", "", masked)
    # SELECT clauses inside CREATE VIEW/MATERIALIZED VIEW are still DDL.
    ddl_check = re.sub(r"(?is)\bCREATE\s+(?:MATERIALIZED\s+)?VIEW\b.*?;", "", masked)
    if _DDL_DML.search(ddl_check):
        raise LocalMigrationError("dml_in_ddl_prerequisite")
    if re.search(r"(?im)\b(?:CREATE\s+DATABASE|ALTER\s+SYSTEM|COPY\s+.*\bPROGRAM)\b", masked):
        raise LocalMigrationError("unsafe_ddl_prerequisite")
    changed = False
    saw_extension = False
    unsupported: list[str] = []

    def replace_extension(match: re.Match[str]) -> str:
        nonlocal changed, saw_extension
        name = match.group("name").strip('"').lower()
        if name not in _LOCAL_EXTENSIONS:
            unsupported.append(name)
            return match.group(0)
        saw_extension = True
        tail = match.group("tail")
        # Existing WITH SCHEMA clauses are replaced so the namespace is
        # deterministic across the local Supabase images.
        tail = re.sub(r"(?is)\bWITH\s+SCHEMA\s+[A-Za-z_][A-Za-z0-9_]*", "", tail)
        changed = True
        quoted_name = f'"{name}"' if not _IDENTIFIER.fullmatch(name) else name
        prefix = "CREATE EXTENSION " + (match.group(1) or "") + quoted_name
        return prefix + " WITH SCHEMA extensions" + tail + ";"

    transformed = _EXTENSION.sub(replace_extension, text)
    if unsupported:
        raise LocalMigrationError("unsupported_extension")
    if saw_extension and not re.search(r"(?im)^\s*CREATE\s+SCHEMA\s+IF\s+NOT\s+EXISTS\s+extensions\s*;", transformed):
        transformed = "CREATE SCHEMA IF NOT EXISTS extensions;\n" + transformed
        changed = True
    return transformed.encode("utf-8") if changed else data
def _baseline_without_directives(data: bytes) -> bytes:
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as error:
        raise LocalMigrationError("prerequisite_not_utf8") from error
    if _CLOUD_INPUT.search(text):
        raise LocalMigrationError("cloud_input_rejected")
    lines = text.splitlines(keepends=True)
    for removal in BASELINE_REMOVALS:
        matches = [index for index, line in enumerate(lines) if line.rstrip("\r\n") == removal]
        if len(matches) != 1:
            raise LocalMigrationError("baseline_transform_source_mismatch")
        lines[matches[0]] = ""
    search_path_probe = "SELECT pg_catalog.set_config('search_path', '', false);"
    probe_matches = [index for index, line in enumerate(lines) if line.rstrip("\r\n") == search_path_probe]
    if len(probe_matches) != 1:
        raise LocalMigrationError("baseline_transform_source_mismatch")
    lines[probe_matches[0]] = "SET search_path = public, extensions, pg_catalog;\n"
    return "".join(lines).encode("utf-8")


def _namespace_local_extensions(text: str) -> tuple[str, dict[str, int]]:
    replacements = {
        "vector_type": len(re.findall(r"\bpublic\.vector\b", text)),
        "vector_operator": len(re.findall(r"\bpublic\.vector_[A-Za-z0-9_]+\b", text)),
        "gen_random_uuid": len(re.findall(r"(?<![\w.])gen_random_uuid\s*\(", text)),
        "similarity": len(re.findall(r"(?<![\w.])similarity\s*\(", text)),
        "levenshtein": len(re.findall(r"(?<![\w.])levenshtein\s*\(", text)),
    }
    legacy_name_replacements = {
        "document_embeddings_unique_version": "document_embeddings_baseline_unique_version",
        "document_embeddings_bge_id_seq": "transcript_embeddings_bge_id_seq",
        "document_embeddings_bge_pkey": "transcript_embeddings_bge_pkey",
        "document_embeddings_bge_unique_version": "transcript_embeddings_bge_unique_version",
    }
    for old_name, new_name in legacy_name_replacements.items():
        replacements[old_name] = text.count(old_name)
        text = text.replace(old_name, new_name)
    text = re.sub(r"\bpublic\.(vector(?:_[A-Za-z0-9_]+)?)\b", r"extensions.\1", text)
    text = re.sub(r"(?<![\w.])gen_random_uuid(\s*\()", r"extensions.gen_random_uuid\1", text)
    text = re.sub(r"(?<![\w.])similarity(\s*\()", r"extensions.similarity\1", text)
    text = re.sub(r"(?<![\w.])levenshtein(\s*\()", r"extensions.levenshtein\1", text)
    return text, replacements


def build_prerequisite(data: bytes) -> tuple[bytes, dict[str, Any]]:
    """Build the source-bound DDL-only local prerequisite and its manifest."""
    source_sha256 = _sha256_bytes(data)
    cleaned = _baseline_without_directives(data)
    transformed = transform_ddl_prerequisite(cleaned).decode("utf-8")
    transformed, namespace_replacements = _namespace_local_extensions(transformed)
    header = (
        "-- tzudong local application prerequisite\n"
        f"-- transform_version: {PREREQUISITE_TRANSFORM_VERSION}\n"
        f"-- source_sha256: {source_sha256}\n"
        "-- extension_schema: extensions\n"
        "-- search_path: public,extensions,pg_catalog\n"
        "CREATE SCHEMA IF NOT EXISTS extensions;\n"
        "CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;\n"
        "CREATE EXTENSION IF NOT EXISTS fuzzystrmatch WITH SCHEMA extensions;\n"
        "CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;\n"
        "CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;\n"
        "CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\" WITH SCHEMA extensions;\n"
        "SET search_path = public, extensions, pg_catalog;\n"
    )
    output = (header + transformed + "\n" + PREREQUISITE_COMPATIBILITY_SQL).encode("utf-8")
    manifest = {
        "schemaVersion": "local-application-prerequisite/v1",
        "transformVersion": PREREQUISITE_TRANSFORM_VERSION,
        "source": {
            "path": PREREQUISITE_SOURCE.as_posix(),
            "sha256": source_sha256,
            "byteLength": len(data),
        },
        "output": {
            "path": PREREQUISITE_OUTPUT.as_posix(),
            "sha256": _sha256_bytes(output),
            "byteLength": len(output),
        },
        "removedLines": list(BASELINE_REMOVALS),
        "namespaceReplacements": namespace_replacements,
        "extensions": ["vector", "fuzzystrmatch", "pg_trgm", "pgcrypto", "uuid-ossp"],
        "searchPath": ["public", "extensions", "pg_catalog"],
        "ddlOnly": True,
        "compatibilityObjects": [
            "public.admin_workflow_runs",
            "public.admin_workflow_steps",
            "public.admin_workflow_signals",
            "public.restaurant_popular_rank_snapshots",
        ],
    }
    return output, manifest
def _require_generated_prerequisite(path: Path) -> Path:
    try:
        info = path.lstat()
    except OSError as error:
        raise LocalMigrationError("prerequisite_missing") from error
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid():
        raise LocalMigrationError("prerequisite_not_generated")
    resolved = _require_owned_regular_file(path, "prerequisite_not_generated")
    expected = _require_owned_regular_file(
        repository_root() / PREREQUISITE_OUTPUT,
        "prerequisite_missing",
    )
    if resolved != expected:
        raise LocalMigrationError("prerequisite_not_generated")
    return resolved
def _load_prerequisite_manifest() -> dict[str, Any]:
    candidate = repository_root() / PREREQUISITE_MANIFEST
    path = _require_owned_regular_file(candidate, "prerequisite_manifest_invalid")
    _reject_path_custody(path)
    try:
        supplied = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise LocalMigrationError("prerequisite_manifest_invalid") from error
    if not isinstance(supplied, dict):
        raise LocalMigrationError("prerequisite_manifest_invalid")
    return supplied


def _verify_generated_prerequisite(path: Path) -> tuple[Path, dict[str, Any]]:
    resolved = _require_generated_prerequisite(path)
    manifest = _load_prerequisite_manifest()
    source_path = _require_owned_regular_file(
        repository_root() / PREREQUISITE_SOURCE,
        "prerequisite_source_invalid",
    )
    try:
        source = source_path.read_bytes()
        output = resolved.read_bytes()
    except OSError as error:
        raise LocalMigrationError("prerequisite_read_failed") from error
    # Recompute the complete transform immediately before apply.  This binds the
    # checked output to the current source, not merely to a stale output hash.
    _, expected = build_prerequisite(source)
    if manifest != expected:
        raise LocalMigrationError("prerequisite_manifest_mismatch")
    output_meta = manifest.get("output")
    source_meta = manifest.get("source")
    if (
        not isinstance(output_meta, dict)
        or not isinstance(source_meta, dict)
        or output_meta.get("path") != PREREQUISITE_OUTPUT.as_posix()
        or source_meta.get("path") != PREREQUISITE_SOURCE.as_posix()
        or source_meta.get("sha256") != _sha256_bytes(source)
        or source_meta.get("byteLength") != len(source)
        or output_meta.get("sha256") != _sha256_bytes(output)
        or output_meta.get("byteLength") != len(output)
        or manifest.get("transformVersion") != PREREQUISITE_TRANSFORM_VERSION
        or manifest.get("ddlOnly") is not True
        or manifest.get("schemaVersion") != "local-application-prerequisite/v1"
    ):
        raise LocalMigrationError("prerequisite_manifest_mismatch")
    return resolved, manifest


def _write_new(path: Path, data: bytes) -> None:
    _reject_path_custody(path)
    try:
        path.resolve(strict=False).relative_to(source_root())
    except ValueError:
        pass
    else:
        raise LocalMigrationError("output_in_source_tree")
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(path, flags, 0o600)
        try:
            os.fchmod(descriptor, 0o600)
            view = memoryview(data)
            while view:
                written = os.write(descriptor, view)
                if written <= 0:
                    raise OSError("short output write")
                view = view[written:]
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        directory_flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
        directory_descriptor = os.open(path.parent, directory_flags)
        try:
            os.fsync(directory_descriptor)
        finally:
            os.close(directory_descriptor)
    except FileExistsError as error:
        raise LocalMigrationError("output_exists") from error
    except OSError as error:
        raise LocalMigrationError("output_write_failed") from error


def _safe_identifier(value: str, label: str) -> str:
    if not _IDENTIFIER.fullmatch(value):
        raise LocalMigrationError(f"{label}_invalid")
    return value


@dataclass(frozen=True)
class PsqlExecutor:
    docker: str
    container: str
    database: str
    timeout: float = 300.0
    project: str | None = None
    state_dir: Path | None = None
    env_file: Path | None = None

    def _expected_project(self) -> str:
        root = repository_root()
        expected = "tzudong-local-" + hashlib.sha256(str(root).encode("utf-8")).hexdigest()[:12]
        if self.project is not None and self.project != expected:
            raise LocalMigrationError("compose_project_mismatch")
        return expected

    def _binding(self) -> tuple[str, Path, dict[str, str]]:
        project = self._expected_project()
        state = self.state_dir or (repository_root() / "backend/supabase/volumes/.local-stack" / project)
        state_parent = repository_root() / "backend/supabase/volumes/.local-stack"
        if state_parent.is_symlink() or not state_parent.is_dir() or state_parent.stat().st_uid != os.getuid():
            raise LocalMigrationError("local_state_mismatch")
        try:
            if state.is_symlink():
                raise LocalMigrationError("local_state_mismatch")
            state = state.resolve(strict=True)
        except LocalMigrationError:
            raise
        except OSError as error:
            raise LocalMigrationError("local_state_missing") from error
        expected_state = (repository_root() / "backend/supabase/volumes/.local-stack" / project).resolve()
        if state != expected_state or state.is_symlink() or not state.is_dir() or state.stat().st_uid != os.getuid() or stat.S_IMODE(state.stat().st_mode) != 0o700:
            raise LocalMigrationError("local_state_mismatch")
        env_path = self.env_file or (state / "stack.env")
        try:
            if env_path.is_symlink():
                raise LocalMigrationError("local_env_mismatch")
            env_path = env_path.resolve(strict=True)
        except LocalMigrationError:
            raise
        except OSError as error:
            raise LocalMigrationError("local_env_missing") from error
        if env_path != (state / "stack.env").resolve() or env_path.is_symlink() or env_path.stat().st_uid != os.getuid():
            raise LocalMigrationError("local_env_mismatch")
        if stat.S_IMODE(env_path.stat().st_mode) != 0o600:
            raise LocalMigrationError("local_env_mode")
        try:
            lines = env_path.read_text(encoding="utf-8").splitlines()
        except (OSError, UnicodeDecodeError) as error:
            raise LocalMigrationError("local_env_invalid") from error
        values: dict[str, str] = {}
        for line in lines:
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            if not _IDENTIFIER.fullmatch(key) or key in values:
                raise LocalMigrationError("local_env_invalid")
            values[key] = value
        required = ("PROJECT_NAME", "LOCAL_STATE_ROOT", "LOCAL_INPUT_ROOT", "POSTGRES_HOST", "POSTGRES_DB")
        if any(key not in values for key in required):
            raise LocalMigrationError("local_env_provenance")
        if (
            values["PROJECT_NAME"] != project
            or Path(values["LOCAL_STATE_ROOT"]).resolve() != state
            or Path(values["LOCAL_INPUT_ROOT"]).resolve() != (state / "inputs").resolve()
            or values["POSTGRES_HOST"] != "db"
            or values["POSTGRES_DB"] != self.database
        ):
            raise LocalMigrationError("local_env_provenance")
        if set(values) != LOCAL_ENV_KEYS:
            raise LocalMigrationError("local_env_provenance")
        fixed_values = {
            "PROJECT_NAME": project,
            "POSTGRES_HOST": "db",
            "POSTGRES_DB": self.database,
            "POSTGRES_PORT": "5432",
            "NIGHTLY_ADMIN_EMAIL": NIGHTLY_EMAIL,
            "OPENAI_API_KEY": "",
            "DOCKER_SOCKET_LOCATION": "/var/empty/local-stack.sock",
            "LOCAL_STACK_GENERATOR_VERSION": LOCAL_STACK_GENERATOR_VERSION,
        }
        if any(values.get(key) != expected for key, expected in fixed_values.items()):
            raise LocalMigrationError("local_env_provenance")
        database_url = urlparse(values.get("SUPABASE_DB_URL", ""))
        if (
            database_url.scheme not in {"postgres", "postgresql"}
            or database_url.hostname != "127.0.0.1"
            or database_url.username != "postgres"
            or database_url.password != values.get("POSTGRES_PASSWORD")
            or int(database_url.port or 5432) != int(values.get("POSTGRES_HOST_PORT", "0"))
        ):
            raise LocalMigrationError("local_env_provenance")
        for key in ("PROJECT_NAME", "LOCAL_STATE_ROOT", "LOCAL_INPUT_ROOT", "POSTGRES_DB"):
            if os.environ.get(key) and os.environ[key] != values[key]:
                raise LocalMigrationError("local_env_override")
        for key in ("SITE_URL", "API_EXTERNAL_URL", "SUPABASE_PUBLIC_URL"):
            parsed = urlparse(values.get(key, ""))
            if parsed.scheme != "http" or parsed.hostname != "127.0.0.1":
                raise LocalMigrationError("local_env_provenance")
        for key in REMOTE_DOCKER_ENV:
            if os.environ.get(key):
                raise LocalMigrationError("docker_endpoint_override")
        if os.environ.get("POSTGRES_HOST") and os.environ["POSTGRES_HOST"] != "db":
            raise LocalMigrationError("remote_endpoint_override")
        if os.environ.get("DATABASE_URL") or os.environ.get("SUPABASE_URL"):
            raise LocalMigrationError("remote_endpoint_override")
        for name, schema, digest_key in (
            ("stack.env.provenance.json", LOCAL_ENV_PROVENANCE_SCHEMA, "env_file_sha256"),
            ("stack.inputs.provenance.json", LOCAL_INPUT_PROVENANCE_SCHEMA, None),
        ):
            artifact = state / name
            try:
                if artifact.is_symlink() or not artifact.is_file() or artifact.stat().st_uid != os.getuid() or stat.S_IMODE(artifact.stat().st_mode) != 0o600:
                    raise LocalMigrationError("local_state_provenance")
                record = json.loads(artifact.read_text(encoding="utf-8"))
            except LocalMigrationError:
                raise
            except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
                raise LocalMigrationError("local_state_provenance") from error
            if not isinstance(record, dict) or record.get("schema") != schema or record.get("project_name") != project:
                raise LocalMigrationError("local_state_provenance")
            if digest_key and record.get(digest_key) != _sha256_file(env_path)[0]:
                raise LocalMigrationError("local_state_provenance")
        try:
            env_record = json.loads((state / "stack.env.provenance.json").read_text(encoding="utf-8"))
            input_record = json.loads((state / "stack.inputs.provenance.json").read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
            raise LocalMigrationError("local_state_provenance") from error
        if (
            env_record.get("generator_version") != LOCAL_STACK_GENERATOR_VERSION
            or env_record.get("env_file") != "stack.env"
            or env_record.get("env_file_mode") != "0600"
            or env_record.get("secret_values_included") is not False
            or input_record.get("generator_version") != LOCAL_STACK_GENERATOR_VERSION
            or input_record.get("input_root") != "inputs"
            or input_record.get("socket_mount") != "removed"
            or not isinstance(input_record.get("records"), list)
        ):
            raise LocalMigrationError("local_state_provenance")
        receipt_path = state / "last-receipt.json"
        try:
            if receipt_path.is_symlink() or not receipt_path.is_file() or receipt_path.stat().st_uid != os.getuid() or stat.S_IMODE(receipt_path.stat().st_mode) != 0o600:
                raise LocalMigrationError("local_state_provenance")
            stack_receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
        except LocalMigrationError:
            raise
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
            raise LocalMigrationError("local_state_provenance") from error
        if (
            not isinstance(stack_receipt, dict)
            or stack_receipt.get("schema") != LOCAL_STACK_RECEIPT_SCHEMA
            or stack_receipt.get("project_name") != project
            or stack_receipt.get("renderer") not in {COMPOSE_VERSION, COMPOSE_VERSION.removeprefix("v")}
            or stack_receipt.get("generator_version") != LOCAL_STACK_GENERATOR_VERSION
            or any(not isinstance(stack_receipt.get(key), str) or not _HEX64.fullmatch(stack_receipt[key]) for key in ("config_sha256", "input_provenance_sha256", "env_provenance_sha256"))
            or stack_receipt["input_provenance_sha256"] != _sha256_file(state / "stack.inputs.provenance.json")[0]
            or stack_receipt["env_provenance_sha256"] != _sha256_file(state / "stack.env.provenance.json")[0]
        ):
            raise LocalMigrationError("local_state_provenance")
        return project, state, values

    def _docker_env(self) -> dict[str, str]:
        self._binding()
        _assert_local_docker_context(self.docker)
        keep = {"PATH", "HOME", "USER", "TMPDIR", "LANG", "LC_ALL", "TERM"}
        environment = {key: value for key, value in os.environ.items() if key in keep}
        environment.setdefault("PATH", "/usr/bin:/bin")
        environment.setdefault("HOME", str(Path.home()))
        return environment

    def _base(self, variables: Mapping[str, str] | None = None) -> list[str]:
        if "://" in self.docker or (not shutil.which(self.docker) and not Path(self.docker).is_file()):
            raise LocalMigrationError("docker_unavailable")
        _safe_identifier(self.database, "database")
        self._inspect()
        project, state, _ = self._binding()
        command = [
            self.docker,
            "compose",
            "--project-name",
            project,
            "--env-file",
            str(state / "stack.env"),
        ]
        for compose_file in (
            repository_root() / "backend/supabase/docker-compose.yml",
            repository_root() / "backend/supabase/docker-compose.local.yml",
            repository_root() / "backend/supabase/docker-compose.mail.yml",
        ):
            command.extend(["-f", str(compose_file)])
        command.extend([
            "exec",
            "-T",
            "db",
            "psql",
            "-X",
            "--no-password",
            "--quiet",
            "--no-align",
            "--tuples-only",
            "--username",
            "supabase_admin",
            "--set",
            "ON_ERROR_STOP=1",
        ])
        command.extend(["--dbname", self.database])
        return command

    def _inspect(self) -> dict[str, Any]:
        self._binding()
        base = [self.docker, "inspect", "--format", "{{json .}}", self.container]
        if not shutil.which(self.docker) and not Path(self.docker).is_file():
            raise LocalMigrationError("docker_unavailable")
        try:
            result = subprocess.run(
                base, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                timeout=10, env=self._docker_env(),
            )
        except (OSError, subprocess.TimeoutExpired) as error:
            raise LocalMigrationError("docker_inspect_failed") from error
        if result.returncode != 0:
            raise LocalMigrationError("container_not_found")
        try:
            payload = json.loads(result.stdout.decode("utf-8"))
            item = payload[0] if isinstance(payload, list) else payload
            if not isinstance(item, dict):
                raise ValueError
            labels = item.get("Config", {}).get("Labels") or {}
            project, _, _ = self._binding()
            config_files = labels.get("com.docker.compose.project.config_files")
            expected_files = {
                str(repository_root() / "backend/supabase/docker-compose.yml"),
                str(repository_root() / "backend/supabase/docker-compose.local.yml"),
                str(repository_root() / "backend/supabase/docker-compose.mail.yml"),
            }
            if not config_files or set(config_files.split(",")) != expected_files:
                raise LocalMigrationError("container_compose_config_mismatch")
            if (
                labels.get("com.docker.compose.project") != project
                or labels.get("com.docker.compose.service") != "db"
                or labels.get("com.docker.compose.container-number") != "1"
                or item.get("Name", "").rstrip("/").split("/")[-1] != f"{project}-db-1"
                or item.get("HostConfig", {}).get("NetworkMode") in {"host", "container"}
            ):
                raise LocalMigrationError("container_not_canonical_local_db")
            return item
        except LocalMigrationError:
            raise
        except (ValueError, KeyError, IndexError, UnicodeDecodeError, AttributeError) as error:
            raise LocalMigrationError("container_metadata_invalid") from error
    def _service_image_digests(self) -> dict[str, list[str]]:
        """Return image digests for every canonical local Compose service."""
        project, _, _ = self._binding()
        _assert_local_docker_context(self.docker)
        environment = self._docker_env()
        try:
            listed = subprocess.run(
                [
                    self.docker,
                    "ps",
                    "--all",
                    "--filter",
                    f"label=com.docker.compose.project={project}",
                    "--format",
                    "{{.ID}}\t{{.Names}}",
                ],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=30,
                env=environment,
            )
        except (OSError, subprocess.TimeoutExpired) as error:
            raise LocalMigrationError("service_provenance_incomplete") from error
        if listed.returncode != 0:
            raise LocalMigrationError("service_provenance_incomplete")
        containers: dict[str, tuple[str, str]] = {}
        for line in listed.stdout.decode("utf-8", "replace").splitlines():
            if not line:
                continue
            parts = line.split("\t")
            if len(parts) != 2 or not parts[0] or not parts[1]:
                raise LocalMigrationError("service_provenance_incomplete")
            container_id, name = parts
            if name in {entry[1] for entry in containers.values()}:
                raise LocalMigrationError("service_provenance_ambiguous")
            containers[container_id] = (container_id, name)
        expected_names = {f"{project}-{service}-1" for service in EXPECTED_SERVICES}
        if {entry[1] for entry in containers.values()} != expected_names:
            raise LocalMigrationError("service_provenance_incomplete")
        expected_files = {
            str(repository_root() / "backend/supabase/docker-compose.yml"),
            str(repository_root() / "backend/supabase/docker-compose.local.yml"),
            str(repository_root() / "backend/supabase/docker-compose.mail.yml"),
        }
        service_digests: dict[str, list[str]] = {}
        for container_id, name in containers.values():
            try:
                inspected = subprocess.run(
                    [self.docker, "inspect", "--format", "{{json .}}", container_id],
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    timeout=30,
                    env=environment,
                )
            except (OSError, subprocess.TimeoutExpired) as error:
                raise LocalMigrationError("service_provenance_incomplete") from error
            if inspected.returncode != 0:
                raise LocalMigrationError("service_provenance_incomplete")
            try:
                item = json.loads(inspected.stdout.decode("utf-8"))
                labels = item["Config"]["Labels"] or {}
                service = labels["com.docker.compose.service"]
                config_files = labels["com.docker.compose.project.config_files"]
                working_dir = labels["com.docker.compose.project.working_dir"]
                network_mode = item.get("HostConfig", {}).get("NetworkMode")
            except (KeyError, TypeError, ValueError, UnicodeDecodeError) as error:
                raise LocalMigrationError("service_provenance_incomplete") from error
            if (
                service not in EXPECTED_SERVICES
                or name != f"{project}-{service}-1"
                or labels.get("com.docker.compose.project") != project
                or labels.get("com.docker.compose.container-number") != "1"
                or not config_files
                or set(config_files.split(",")) != expected_files
                or not working_dir
                or Path(working_dir).resolve() != (repository_root() / "backend/supabase").resolve()
                or network_mode in {"host", "container"}
            ):
                raise LocalMigrationError("service_provenance_incomplete")
            image_values: list[str] = []
            for key in ("RepoDigests", "Image"):
                value = item.get(key)
                if isinstance(value, list):
                    image_values.extend(str(entry) for entry in value)
                elif isinstance(value, str):
                    image_values.append(value)
            digests = sorted({f"sha256:{match}" for value in image_values for match in re.findall(r"sha256:([0-9a-f]{64})", value)})
            if not digests:
                raise LocalMigrationError("service_provenance_incomplete")
            if service in service_digests:
                raise LocalMigrationError("service_provenance_ambiguous")
            service_digests[service] = digests
        if set(service_digests) != set(EXPECTED_SERVICES):
            raise LocalMigrationError("service_provenance_incomplete")
        return {service: service_digests[service] for service in EXPECTED_SERVICES}

    def _admit_container(self) -> None:
        self._inspect()

    def run(self, sql: bytes, variables: Mapping[str, str] | None = None) -> None:
        self._admit_container()
        try:
            result = subprocess.run(
                self._base(), input=_psql_stdin(sql, variables), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                timeout=self.timeout, env=self._docker_env(),
            )
        except subprocess.TimeoutExpired as error:
            raise LocalMigrationError("psql_ambiguous") from error
        except OSError as error:
            raise LocalMigrationError("psql_unavailable") from error
        if result.returncode == 127:
            raise LocalMigrationError("psql_unavailable")
        if result.returncode < 0:
            raise LocalMigrationError("psql_ambiguous")
        if result.returncode != 0:
            stderr = result.stderr.decode("utf-8", "replace").lower()
            if any(term in stderr for term in ("disconnect", "connection", "broken pipe", "server closed", "eof")):
                raise LocalMigrationError("psql_ambiguous")
            raise LocalMigrationError("psql_failed")

    def capture(self, sql: bytes) -> bytes:
        """Run a read-only query and return stdout without exposing stderr."""
        self._admit_container()
        try:
            result = subprocess.run(
                self._base(), input=sql, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                timeout=self.timeout, env=self._docker_env(),
            )
        except subprocess.TimeoutExpired as error:
            raise LocalMigrationError("psql_ambiguous") from error
        except OSError as error:
            raise LocalMigrationError("psql_unavailable") from error
        if result.returncode == 127:
            raise LocalMigrationError("psql_unavailable")
        if result.returncode < 0:
            raise LocalMigrationError("psql_ambiguous")
        if result.returncode != 0:
            raise LocalMigrationError("psql_ambiguous")
        return result.stdout


def _psql_stdin(sql: bytes, variables: Mapping[str, str] | None) -> bytes:
    if not variables:
        return sql
    prefix: list[bytes] = []
    for name, value in variables.items():
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name):
            raise LocalMigrationError("psql_variable_invalid")
        if (
            not isinstance(value, str)
            or not value
            or not re.fullmatch(r"[A-Za-z0-9_./:=+@,-]+", value)
        ):
            raise LocalMigrationError("psql_variable_invalid")
        prefix.append(f"\\set {name} {value}\n".encode("ascii"))
    return b"".join(prefix) + sql

def _ledger_ddl() -> str:
    return """CREATE SCHEMA IF NOT EXISTS _tzudong_local;
CREATE TABLE IF NOT EXISTS _tzudong_local.migration_ledger (
  migration_id text PRIMARY KEY,
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_byte_length integer NOT NULL CHECK (source_byte_length > 0),
  ordinal integer NOT NULL CHECK (ordinal > 0),
  transaction_class text NOT NULL CHECK (transaction_class IN ('transactional','transactional_explicit','self_committing')),
  status text NOT NULL CHECK (status IN ('planned','running','failed','ambiguous','applied')),
  error_code text,
  readback_sha256 text CHECK (readback_sha256 IS NULL OR readback_sha256 ~ '^[0-9a-f]{64}$'),
  readback_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE _tzudong_local.migration_ledger ADD COLUMN IF NOT EXISTS source_byte_length integer;
ALTER TABLE _tzudong_local.migration_ledger ADD COLUMN IF NOT EXISTS readback_sha256 text;
ALTER TABLE _tzudong_local.migration_ledger ADD COLUMN IF NOT EXISTS readback_at timestamptz;
CREATE TABLE IF NOT EXISTS _tzudong_local.execution_sequence (
  marker text PRIMARY KEY CHECK (marker IN ('prerequisite','migration','closure','platform-bootstrap','seed')),
  ordinal integer NOT NULL UNIQUE CHECK (ordinal BETWEEN 1 AND 5),
  evidence_sha256 text NOT NULL CHECK (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  source_manifest_sha256 text NOT NULL CHECK (source_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  closure_binding_sha256 text CHECK (closure_binding_sha256 IS NULL OR closure_binding_sha256 ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS _tzudong_local.platform_bootstrap_ledger (
  bootstrap_id text PRIMARY KEY CHECK (bootstrap_id = 'local-platform-bootstrap-v1'),
  source_path text NOT NULL,
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_byte_length integer NOT NULL CHECK (source_byte_length > 0),
  status text NOT NULL CHECK (status IN ('planned','running','failed','ambiguous','applied')),
  evidence_sha256 text CHECK (evidence_sha256 IS NULL OR evidence_sha256 ~ '^[0-9a-f]{64}$'),
  error_code text,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS _tzudong_local.auth_api_ledger (
  logical_id text PRIMARY KEY CHECK (logical_id = 'nightly-ci'),
  email text NOT NULL CHECK (email = 'nightly-ci@local.invalid'),
  user_id uuid NOT NULL,
  create_status text NOT NULL CHECK (create_status = '2xx'),
  create_error_class text NOT NULL CHECK (create_error_class = 'none'),
  login_status text NOT NULL CHECK (login_status = '2xx'),
  login_error_class text NOT NULL CHECK (login_error_class = 'none'),
  status text NOT NULL CHECK (status IN ('running','applied')),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE _tzudong_local.execution_sequence ADD COLUMN IF NOT EXISTS closure_binding_sha256 text;"""


def _q(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"
_PLATFORM_BOOTSTRAP_READBACK_SQL = b"""SELECT bootstrap_id, source_path, source_sha256,
       source_byte_length, status, coalesce(evidence_sha256, '')
FROM _tzudong_local.platform_bootstrap_ledger
WHERE bootstrap_id = 'local-platform-bootstrap-v1';"""
_AUTH_API_LEDGER_READBACK_SQL = b"""SELECT logical_id, email, user_id::text,
       create_status, create_error_class, login_status, login_error_class, status
FROM _tzudong_local.auth_api_ledger
WHERE logical_id = 'nightly-ci';"""

def _platform_bootstrap_sha256() -> str:
    digest = _sha256_bytes(PLATFORM_BOOTSTRAP_SQL)
    if not PLATFORM_BOOTSTRAP_SHA256 or digest != PLATFORM_BOOTSTRAP_SHA256:
        raise LocalMigrationError("platform_bootstrap_source_mismatch")
    return digest

def _platform_bootstrap_evidence_sha256() -> str:
    source_sha256 = _platform_bootstrap_sha256()
    return _sha256_bytes(
        _serialize_rows(
            [[
                "platform-bootstrap",
                PLATFORM_BOOTSTRAP_ID,
                PLATFORM_BOOTSTRAP_SOURCE,
                source_sha256,
                len(PLATFORM_BOOTSTRAP_SQL),
                "applied",
            ]]
        )
    )

def _platform_bootstrap_readback(executor: PsqlExecutor) -> str:
    rows = _capture_lines(executor, _PLATFORM_BOOTSTRAP_READBACK_SQL, 6)
    if len(rows) != 1:
        raise LocalMigrationError("platform_bootstrap_readback")
    row = rows[0]
    source_sha256 = _platform_bootstrap_sha256()
    if row != [
        PLATFORM_BOOTSTRAP_ID,
        PLATFORM_BOOTSTRAP_SOURCE,
        source_sha256,
        str(len(PLATFORM_BOOTSTRAP_SQL)),
        "running",
        "",
    ]:
        raise LocalMigrationError("platform_bootstrap_readback")
    return _platform_bootstrap_evidence_sha256()
def _platform_bootstrap_applied_evidence(executor: PsqlExecutor) -> str:
    rows = _capture_lines(executor, _PLATFORM_BOOTSTRAP_READBACK_SQL, 6)
    if len(rows) != 1:
        raise LocalMigrationError("platform_bootstrap_readback")
    expected_evidence = _platform_bootstrap_evidence_sha256()
    if rows[0] != [
        PLATFORM_BOOTSTRAP_ID,
        PLATFORM_BOOTSTRAP_SOURCE,
        _platform_bootstrap_sha256(),
        str(len(PLATFORM_BOOTSTRAP_SQL)),
        "applied",
        expected_evidence,
    ]:
        raise LocalMigrationError("platform_bootstrap_readback")
    return expected_evidence

def _apply_platform_bootstrap(executor: PsqlExecutor, manifest: Mapping[str, Any]) -> str:
    source_sha256 = _platform_bootstrap_sha256()
    manifest_sha256 = manifest_digest(dict(manifest))
    setup = (
        "BEGIN;\n"
        "INSERT INTO _tzudong_local.platform_bootstrap_ledger("
        "bootstrap_id,source_path,source_sha256,source_byte_length,status,error_code,updated_at"
        ") VALUES ("
        + ",".join((
            _q(PLATFORM_BOOTSTRAP_ID),
            _q(PLATFORM_BOOTSTRAP_SOURCE),
            _q(source_sha256),
            str(len(PLATFORM_BOOTSTRAP_SQL)),
            _q("planned"),
            "NULL",
            "clock_timestamp()",
        ))
        + ") ON CONFLICT (bootstrap_id) DO UPDATE SET "
        "source_path=EXCLUDED.source_path,source_sha256=EXCLUDED.source_sha256,"
        "source_byte_length=EXCLUDED.source_byte_length,status='planned',"
        "error_code=NULL,evidence_sha256=NULL,updated_at=clock_timestamp();\n"
        "UPDATE _tzudong_local.platform_bootstrap_ledger SET status='running',"
        "error_code=NULL,updated_at=clock_timestamp() WHERE bootstrap_id="
        + _q(PLATFORM_BOOTSTRAP_ID) + ";\nCOMMIT;\n"
    ).encode("utf-8")
    try:
        executor.run(setup)
        executor.run(PLATFORM_BOOTSTRAP_SQL)
        evidence_sha256 = _platform_bootstrap_readback(executor)
        executor.run(
            (
                "BEGIN; UPDATE _tzudong_local.platform_bootstrap_ledger SET "
                "status='applied',evidence_sha256=" + _q(evidence_sha256)
                + ",error_code=NULL,updated_at=clock_timestamp() WHERE bootstrap_id="
                + _q(PLATFORM_BOOTSTRAP_ID) + " AND status='running'; COMMIT;\n"
            ).encode("utf-8")
        )
        final_rows = _capture_lines(executor, _PLATFORM_BOOTSTRAP_READBACK_SQL, 6)
        if len(final_rows) != 1 or final_rows[0][4:] != ["applied", evidence_sha256]:
            raise LocalMigrationError("platform_bootstrap_readback")
        executor.run(
            _sequence_marker_sql(
                {
                    "platform-bootstrap": (
                        4,
                        evidence_sha256,
                        manifest_sha256,
                    )
                }
            )
        )
        return evidence_sha256
    except KeyboardInterrupt:
        _record_keyboard_interrupt(executor, PLATFORM_BOOTSTRAP_ID)
        raise
    except LocalMigrationError as error:
        _record_ambiguity(executor, PLATFORM_BOOTSTRAP_ID, error.code)
        raise

def _sequence_marker_sql(markers: Mapping[str, tuple[int, str, str]]) -> bytes:
    if not markers or not set(markers) <= set(SEQUENCE_MARKERS):
        raise LocalMigrationError("sequence_marker_invalid")
    lines = ["BEGIN;", _ledger_ddl()]
    for marker in markers:
        ordinal, evidence, manifest_sha256 = markers[marker]
        if ordinal != SEQUENCE_MARKERS.index(marker) + 1 or not _HEX64.fullmatch(evidence) or not _HEX64.fullmatch(manifest_sha256):
            raise LocalMigrationError("sequence_marker_invalid")
        lines.append(
            "INSERT INTO _tzudong_local.execution_sequence(marker,ordinal,evidence_sha256,source_manifest_sha256) VALUES ("
            + ",".join((_q(marker), str(ordinal), _q(evidence), _q(manifest_sha256)))
            + ") ON CONFLICT (marker) DO UPDATE SET ordinal=EXCLUDED.ordinal,evidence_sha256=EXCLUDED.evidence_sha256,source_manifest_sha256=EXCLUDED.source_manifest_sha256,updated_at=clock_timestamp();"
        )
    lines.append("COMMIT;")
    return ("\n".join(lines) + "\n").encode("utf-8")


def _load_function_scanner_module() -> Any:
    path = repository_root() / "backend/supabase/scripts/local-function-runtime-scan.py"
    try:
        info = path.lstat()
    except OSError as error:
        raise LocalMigrationError("closure_scanner_missing") from error
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid():
        raise LocalMigrationError("closure_scanner_invalid")
    spec = importlib.util.spec_from_file_location("tzudong_local_function_runtime_scan", path)
    if spec is None or spec.loader is None:
        raise LocalMigrationError("closure_scanner_invalid")
    module = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(module)
    except Exception as error:
        raise LocalMigrationError("closure_scanner_invalid") from error
    return module


def _closure_patch_metadata_from_state(state: Path, scanner: Any) -> dict[str, Any]:
    patches = sorted(state.glob("local-function-path-patch-*.sql"), key=lambda path: path.name)
    if len(patches) != 1:
        raise LocalMigrationError("closure_patch_binding")
    patch = patches[0]
    try:
        info = patch.lstat()
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600:
            raise LocalMigrationError("closure_patch_binding")
        lines = patch.read_text(encoding="utf-8").splitlines()
    except LocalMigrationError:
        raise
    except (OSError, UnicodeDecodeError) as error:
        raise LocalMigrationError("closure_patch_binding") from error
    prefix = "-- metadata: "
    metadata_line = next((line for line in lines[:3] if line.startswith(prefix)), None)
    if metadata_line is None:
        raise LocalMigrationError("closure_patch_binding")
    try:
        metadata = json.loads(metadata_line[len(prefix):])
    except json.JSONDecodeError as error:
        raise LocalMigrationError("closure_patch_binding") from error
    if not isinstance(metadata, dict):
        raise LocalMigrationError("closure_patch_binding")
    try:
        scanner._validate_patch_binding(metadata)
    except Exception as error:
        raise LocalMigrationError("closure_patch_binding") from error
    return metadata


def _closure_patch_metadata(executor: PsqlExecutor, scanner: Any) -> dict[str, Any]:
    _, state, _ = executor._binding()
    return _closure_patch_metadata_from_state(state, scanner)


def _current_closure_binding(executor: PsqlExecutor) -> tuple[str, str]:
    scanner = _load_function_scanner_module()
    functions = scanner._source_inventory()
    candidates = scanner._candidate_functions(functions)
    try:
        raw = executor.capture(scanner._runtime_sql(candidates=candidates)).decode("utf-8")
        line = next(line for line in reversed(raw.splitlines()) if line)
        runtime = json.loads(line)
    except (OSError, UnicodeDecodeError, StopIteration, json.JSONDecodeError, TypeError) as error:
        raise LocalMigrationError("closure_runtime_receipt") from error
    if not isinstance(runtime, dict):
        raise LocalMigrationError("closure_runtime_receipt")
    try:
        scanner._validate_runtime(runtime)
    except Exception as error:
        raise LocalMigrationError("closure_runtime_receipt") from error
    definition_hash = runtime.get("definitionHash")
    if not isinstance(definition_hash, str) or not _HEX64.fullmatch(definition_hash):
        raise LocalMigrationError("closure_runtime_receipt")
    metadata = _closure_patch_metadata(executor, scanner)
    fields = {
        key: metadata.get(key)
        for key in (
            "sourceManifestSha256",
            "toolSha256",
            "trustedExtensionManifestSha256",
            "candidateSetSha256",
            "patchSha256",
        )
    }
    if any(not isinstance(value, str) or not _HEX64.fullmatch(value) for value in fields.values()):
        raise LocalMigrationError("closure_patch_binding")
    binding_sha256 = _sha256_bytes(canonical_json({**fields, "definitionHash": definition_hash}))
    return definition_hash, binding_sha256
def _closure_binding_for_current_source(definition_hash: str) -> str:
    if not _HEX64.fullmatch(definition_hash):
        raise LocalMigrationError("closure_patch_binding")
    scanner = _load_function_scanner_module()
    try:
        _, metadata = scanner.generate_patch()
        return scanner._closure_binding_sha256(metadata, definition_hash)
    except Exception as error:
        raise LocalMigrationError("closure_patch_binding") from error


def _sequence_records(
    executor: PsqlExecutor,
    manifest: Mapping[str, Any],
    seed_sha256: str,
    prerequisite_sha256: str,
) -> tuple[list[list[Any]], str, str]:
    manifest_sha256 = manifest_digest(dict(manifest))
    closure_definition_hash, closure_binding_sha256 = _current_closure_binding(executor)
    rows = _capture_lines(executor, _SEQUENCE_RECEIPT_SQL, 5)
    expected_evidence = {
        "prerequisite": prerequisite_sha256,
        "migration": str(manifest["source"]["chainSha256"]),
        "closure": closure_definition_hash,
        "platform-bootstrap": _platform_bootstrap_applied_evidence(executor),
        "seed": seed_sha256,
    }
    if len(rows) != len(SEQUENCE_MARKERS):
        raise LocalMigrationError("receipt_sequence_state")
    records: list[list[Any]] = []
    for expected_ordinal, (marker, ordinal_text, evidence, source_manifest_sha256, binding_sha256) in enumerate(rows, 1):
        expected_marker = SEQUENCE_MARKERS[expected_ordinal - 1]
        expected_binding = closure_binding_sha256 if expected_marker == "closure" else ""
        if (
            marker != expected_marker
            or ordinal_text != str(expected_ordinal)
            or source_manifest_sha256 != manifest_sha256
            or binding_sha256 != expected_binding
            or not _HEX64.fullmatch(evidence)
            or expected_marker != "closure" and evidence != expected_evidence[expected_marker]
            or expected_marker == "closure" and evidence != expected_evidence[expected_marker]
        ):
            raise LocalMigrationError("receipt_sequence_state")
        records.append(["sequence", marker, expected_ordinal, evidence, source_manifest_sha256])
    serialized = _serialize_rows(records)
    return records, _sha256_bytes(serialized), closure_binding_sha256


def _assert_sequence_prefix(
    executor: PsqlExecutor,
    manifest: Mapping[str, Any],
    prerequisite_sha256: str,
    count: int,
) -> None:
    manifest_sha256 = manifest_digest(dict(manifest))
    rows = _capture_lines(executor, _SEQUENCE_RECEIPT_SQL, 5)
    expected = {
        "prerequisite": prerequisite_sha256,
        "migration": str(manifest["source"]["chainSha256"]),
    }
    closure_definition_hash = ""
    closure_binding_sha256 = ""
    if count >= 3:
        closure_definition_hash, closure_binding_sha256 = _current_closure_binding(executor)
        expected["closure"] = closure_definition_hash
    if count >= 4:
        expected["platform-bootstrap"] = _platform_bootstrap_applied_evidence(executor)
    if len(rows) < count:
        raise LocalMigrationError("sequence_prerequisite")
    for index, row in enumerate(rows[:count]):
        marker, ordinal_text, evidence, source_manifest_sha256, binding_sha256 = row
        expected_marker = SEQUENCE_MARKERS[index]
        expected_binding = closure_binding_sha256 if expected_marker == "closure" else ""
        if (
            marker != expected_marker
            or ordinal_text != str(index + 1)
            or source_manifest_sha256 != manifest_sha256
            or binding_sha256 != expected_binding
            or not _HEX64.fullmatch(evidence)
            or expected_marker != "closure" and evidence != expected[expected_marker]
            or expected_marker == "closure" and evidence != expected[expected_marker]
        ):
            raise LocalMigrationError("sequence_prerequisite")



def execution_sql(manifest: dict[str, Any]) -> bytes:
    """Build one psql input stream; migration bytes are appended verbatim."""
    lines: list[str] = ["SET lock_timeout = '5s';", "SET statement_timeout = '0';", _ledger_ddl()]
    files = manifest["source"]["files"]
    for item in files:
        migration_id = item["path"]
        transaction_class = item["transaction"]["class"]
        lines.extend(
            [
                "BEGIN;",
                "INSERT INTO _tzudong_local.migration_ledger(migration_id,source_sha256,source_byte_length,ordinal,transaction_class,status,started_at,updated_at) VALUES ("
                + ",".join((_q(migration_id), _q(item["sha256"]), str(item["byteLength"]), str(item["ordinal"]), _q(transaction_class), _q("planned"), "NULL", "clock_timestamp()"))
                + ") ON CONFLICT (migration_id) DO UPDATE SET source_sha256=EXCLUDED.source_sha256,source_byte_length=EXCLUDED.source_byte_length,ordinal=EXCLUDED.ordinal,transaction_class=EXCLUDED.transaction_class,status='planned',error_code=NULL,readback_sha256=NULL,readback_at=NULL,started_at=NULL,finished_at=NULL,updated_at=clock_timestamp();",
                "COMMIT;",
                "BEGIN;",
                "UPDATE _tzudong_local.migration_ledger SET status='running',started_at=clock_timestamp(),finished_at=NULL,error_code=NULL,updated_at=clock_timestamp() WHERE migration_id=" + _q(migration_id) + ";",
                "COMMIT;",
                "-- local-migrate source: " + migration_id,
            ]
        )
        body = _verified_migration_bytes(item)
        lines.append(body.decode("utf-8"))
    return "\n".join(lines).encode("utf-8") + b"\n"


def _verified_migration_bytes(item: Mapping[str, Any]) -> bytes:
    """Read and verify one migration immediately before it is executed."""
    migration_id = item.get("path")
    expected_sha256 = item.get("sha256")
    expected_length = item.get("byteLength")
    if (
        not isinstance(migration_id, str)
        or not isinstance(expected_sha256, str)
        or not _HEX64.fullmatch(expected_sha256)
        or not isinstance(expected_length, int)
        or isinstance(expected_length, bool)
        or expected_length <= 0
    ):
        raise LocalMigrationError("migration_manifest_invalid")
    source_file = repository_root() / Path(migration_id)
    try:
        info = source_file.lstat()
        resolved = source_file.resolve(strict=True)
        if (
            stat.S_ISLNK(info.st_mode)
            or not stat.S_ISREG(info.st_mode)
            or info.st_uid != os.getuid()
            or resolved.relative_to(source_root()) != Path(migration_id).relative_to(EXPECTED_SOURCE)
        ):
            raise LocalMigrationError("migration_source_custody")
        data = source_file.read_bytes()
    except LocalMigrationError:
        raise
    except (OSError, RuntimeError, ValueError) as error:
        raise LocalMigrationError("migration_source_custody") from error
    _reject_source_text(data)
    if len(data) != expected_length or _sha256_bytes(data) != expected_sha256:
        raise LocalMigrationError("migration_source_mismatch")
    return data


def _execution_body(item: Mapping[str, Any]) -> bytes:
    body = _verified_migration_bytes(item)
    if item.get("path") == "backend/supabase/migrations/20260713002000_g014_public_api_private_boundary.sql":
        body = G014_OWNER_NORMALIZATION_SQL.encode("utf-8") + body
    return body


def _execution_batch(item: Mapping[str, Any], index: int) -> tuple[str, bytes]:
    migration_id = item["path"]
    prefix = _ledger_ddl() + "\n" if index == 0 else ""
    setup = (
        "BEGIN;\n"
        + "INSERT INTO _tzudong_local.migration_ledger(migration_id,source_sha256,source_byte_length,ordinal,transaction_class,status,started_at,updated_at) VALUES ("
        + ",".join((_q(migration_id), _q(item["sha256"]), str(item["byteLength"]), str(item["ordinal"]), _q(item["transaction"]["class"]), _q("planned"), "NULL", "clock_timestamp()"))
        + ") ON CONFLICT (migration_id) DO UPDATE SET source_sha256=EXCLUDED.source_sha256,source_byte_length=EXCLUDED.source_byte_length,ordinal=EXCLUDED.ordinal,transaction_class=EXCLUDED.transaction_class,status='planned',error_code=NULL,readback_sha256=NULL,readback_at=NULL,started_at=NULL,finished_at=NULL,updated_at=clock_timestamp();\n"
        + "COMMIT;\n"
        + "BEGIN;\n"
        + "UPDATE _tzudong_local.migration_ledger SET status='running',started_at=clock_timestamp(),finished_at=NULL,error_code=NULL,updated_at=clock_timestamp() WHERE migration_id="
        + _q(migration_id)
        + ";\nCOMMIT;\n"
    )
    body = _execution_body(item)
    if item["transaction"]["class"] == "transactional":
        body = b"BEGIN;\n" + body + b"\nCOMMIT;\n"
    return migration_id, (prefix + setup + "-- local-migrate source: " + migration_id + "\n").encode("utf-8") + body


def _assert_execution_batch_fresh(item: Mapping[str, Any], sql: bytes) -> None:
    """Re-read source bytes after planning and before handing SQL to psql."""
    ordinal = item.get("ordinal")
    if not isinstance(ordinal, int) or isinstance(ordinal, bool) or ordinal <= 0:
        raise LocalMigrationError("migration_manifest_invalid")
    expected_id, expected_sql = _execution_batch(item, ordinal - 1)
    if expected_id != item.get("path") or expected_sql != sql:
        raise LocalMigrationError("migration_source_mismatch")


def execution_batches(manifest: dict[str, Any]) -> Iterable[tuple[str, bytes]]:
    """Yield one transaction-safe psql input per migration."""
    for index, item in enumerate(manifest["source"]["files"]):
        yield _execution_batch(item, index)


def mark_terminal(executor: PsqlExecutor, migration_id: str, status: str, error_code: str) -> None:
    if status not in {"failed", "ambiguous"}:
        raise LocalMigrationError("ledger_status_invalid")
    sql = (
        "BEGIN; UPDATE _tzudong_local.migration_ledger SET status="
        + _q(status)
        + ",error_code="
        + _q(error_code)
        + ",finished_at=clock_timestamp(),updated_at=clock_timestamp() WHERE migration_id="
        + _q(migration_id)
        + "; COMMIT;\n"
    ).encode("utf-8")
    executor.run(sql)
def _ambiguity_path(executor: PsqlExecutor) -> Path:
    _, state, _ = executor._binding()
    return state / AMBIGUITY_MARKER


def _assert_no_ambiguity(executor: PsqlExecutor) -> None:
    marker = _ambiguity_path(executor)
    try:
        if marker.exists() or marker.is_symlink():
            raise LocalMigrationError("reset_required")
    except OSError as error:
        raise LocalMigrationError("reset_required") from error


def _record_ambiguity(executor: PsqlExecutor, migration_id: str, error_code: str) -> None:
    marker = _ambiguity_path(executor)
    payload = canonical_json({
        "schema": "local-migration-ambiguity-v1",
        "project_name": executor._expected_project(),
        "migration_id": migration_id,
        "error_code": error_code,
    }) + b"\n"
    try:
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
        try:
            descriptor = os.open(marker, flags, 0o600)
        except FileExistsError:
            return
        try:
            os.fchmod(descriptor, 0o600)
            view = memoryview(payload)
            while view:
                written = os.write(descriptor, view)
                if written <= 0:
                    raise OSError("short ambiguity marker write")
                view = view[written:]
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        directory_flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
        directory_fd = os.open(marker.parent, directory_flags)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    except OSError as error:
        raise LocalMigrationError("ambiguity_marker_failed") from error
def _record_keyboard_interrupt(executor: PsqlExecutor, phase: str) -> None:
    try:
        _record_ambiguity(executor, phase, "keyboard_interrupt")
    except LocalMigrationError as error:
        raise LocalMigrationError("reset_required") from error
def _apply_sequence_marker(executor: PsqlExecutor, manifest: Mapping[str, Any]) -> None:
    try:
        executor.run(
            _sequence_marker_sql(
                {
                    "migration": (
                        2,
                        manifest["source"]["chainSha256"],
                        manifest_digest(manifest),
                    ),
                }
            )
        )
    except KeyboardInterrupt:
        _record_keyboard_interrupt(executor, "migration-sequence")
        raise
    except LocalMigrationError as error:
        _record_ambiguity(executor, "migration-sequence", error.code)
        raise


def _unit_readback(executor: PsqlExecutor, item: Mapping[str, Any]) -> str:
    sql = _UNIT_READBACK_SQL.format(migration_id=_q(str(item["path"]))).encode("utf-8")
    rows = _capture_lines(executor, sql, 7)
    if len(rows) != 1:
        raise LocalMigrationError("migration_readback_failed")
    row = rows[0]
    if (
        row[0] != item["path"]
        or row[1] != str(item["ordinal"])
        or row[2] != item["sha256"]
        or row[3] != str(item["byteLength"])
        or row[4] != item["transaction"]["class"]
        or row[5] != "running"
        or row[6] != ""
    ):
        raise LocalMigrationError("migration_readback_failed")
    return _sha256_bytes(
        _serialize_rows(
            [[
                "unit",
                row[0],
                int(row[1]),
                row[2],
                int(row[3]),
                row[4],
                row[5],
                row[6],
            ]]
        )
    )


def _mark_applied(executor: PsqlExecutor, migration_id: str, evidence_sha256: str) -> None:
    if not _HEX64.fullmatch(evidence_sha256):
        raise LocalMigrationError("migration_readback_failed")
    sql = (
        "BEGIN; UPDATE _tzudong_local.migration_ledger SET status='applied',"
        "readback_sha256=" + _q(evidence_sha256) + ",readback_at=clock_timestamp(),"
        "finished_at=clock_timestamp(),error_code=NULL,updated_at=clock_timestamp() "
        "WHERE migration_id=" + _q(migration_id) + " AND status='running'; COMMIT;\n"
    ).encode("utf-8")
    executor.run(sql)


def _verify_applied_readback(executor: PsqlExecutor, item: Mapping[str, Any], evidence_sha256: str) -> None:
    sql = _UNIT_READBACK_SQL.format(migration_id=_q(str(item["path"]))).encode("utf-8")
    rows = _capture_lines(executor, sql, 7)
    if len(rows) != 1 or rows[0][5] != "applied" or rows[0][6] != evidence_sha256:
        raise LocalMigrationError("migration_readback_failed")


def plan(manifest: dict[str, Any]) -> dict[str, Any]:
    return {
        "schemaVersion": PLAN_VERSION,
        "manifestSha256": manifest_digest(manifest),
        "sourceChainSha256": manifest["source"]["chainSha256"],
        "migrations": [
            {
                "ordinal": item["ordinal"],
                "migrationId": item["path"],
                "sourceSha256": item["sha256"],
                "transactionClass": item["transaction"]["class"],
                "status": "planned",
            }
            for item in manifest["source"]["files"]
        ],
    }


def _normalize_receipt_value(value: Any) -> Any:
    if isinstance(value, str):
        return unicodedata.normalize("NFC", value)
    if isinstance(value, list):
        return [_normalize_receipt_value(item) for item in value]
    if isinstance(value, tuple):
        return [_normalize_receipt_value(item) for item in value]
    if isinstance(value, dict):
        if not all(isinstance(key, str) for key in value):
            raise LocalMigrationError("receipt_object_key")
        return {
            unicodedata.normalize("NFC", key): _normalize_receipt_value(item)
            for key, item in value.items()
        }
    if isinstance(value, float) and (value != value or value in (float("inf"), float("-inf"))):
        raise LocalMigrationError("receipt_non_finite")
    return value


def _receipt_row_key(section: str, row: list[Any]) -> tuple[Any, ...]:
    # Mirror the explicit SQL identity columns.  Numeric ordinals stay numeric
    # so 10 sorts after 9 rather than before it lexicographically.
    identity_indices = {
        "extensions": (1, 2, 3),
        "roles": (1,),
        "schemas": (1,),
        "relations": (1, 2, 3),
        "columns": (1, 2, 3),
        "constraints": (1, 2, 3),
        "indexes": (1, 2, 3),
        "functions": (1, 2, 3),
        "policies": (1, 2, 3),
        "triggers": (1, 2, 3),
        "storage_buckets": (1, 2),
        "storage_policies": (1, 2, 3),
        "realtime_membership": (1, 2, 3),
        "public_read_function_grants": (1, 2),
        "public_read_table_grants": (1, 2),
        "public_read_policies": (1, 2),
        "caller_bound_admin_policies": (1, 2),
        "admin_data_rpcs": (1,),
        "admin_data_table_grants": (1,),
        "admin_map_overlay_rpc": (1,),
        "admin_map_overlay_table_grants": (1, 2),
        "admin_map_overlay_policies": (1, 2),
        "auth_users": (1, 2),
        "auth_identities": (2, 3),
        "profiles": (2, 5),
        "user_roles": (1, 2),
        "user_account_status": (1, 2),
        "privacy_policy_fixture": (1,),
        "privacy_age_profile": (1,),
        "youtube_channel_snapshot": (1,),
        "restaurants": (1,),
        "announcements": (1,),
        "seed_buckets": (1, 2),
        "seed_realtime": (1, 2, 3),
    }
    try:
        return tuple(row[index] for index in identity_indices[section])
    except (KeyError, IndexError) as error:
        raise LocalMigrationError("receipt_row_identity") from error


def _receipt_error(code: str) -> None:
    raise LocalMigrationError(code)


def _normalize_auth_logical_ids(records: list[list[Any]]) -> None:
    users = [row for row in records if row[0] == "auth_users"]
    if len(users) != 1:
        _receipt_error("receipt_auth_user_count")
    user = users[0]
    if len(user) != len(SEED_FIELDS["auth_users"]) + 1:
        _receipt_error("receipt_row_shape")
    if user[2] != NIGHTLY_EMAIL:
        _receipt_error("receipt_auth_email")
    generated_id = user[1]
    if generated_id != NIGHTLY_LOGICAL_ID:
        if not isinstance(generated_id, str) or not _UUID.fullmatch(generated_id):
            _receipt_error("receipt_auth_id")
        user[1] = NIGHTLY_LOGICAL_ID
    if user[3:] != ["authenticated", "authenticated", True]:
        _receipt_error("receipt_auth_values")
    for section in (
        "auth_identities",
        "profiles",
        "user_roles",
        "user_account_status",
        "privacy_age_profile",
    ):
        rows = [row for row in records if row[0] == section]
        if len(rows) != 1:
            _receipt_error("receipt_" + section + "_count")
        row = rows[0]
        if row[1] == generated_id or row[1] == NIGHTLY_LOGICAL_ID:
            row[1] = NIGHTLY_LOGICAL_ID
        else:
            _receipt_error("receipt_auth_link")
    identity = next(row for row in records if row[0] == "auth_identities")
    if identity[2:] != ["email", NIGHTLY_EMAIL]:
        _receipt_error("receipt_auth_identity_values")
    profile = next(row for row in records if row[0] == "profiles")
    if profile[2:] != ["nightly-ci", "Nightly CI", "user", NIGHTLY_EMAIL, FIXTURE_TIMESTAMP]:
        _receipt_error("receipt_profile_values")


def _validate_auth_catalog(records: list[list[Any]]) -> None:
    auth_schemas = [row for row in records if row[0] == "schemas" and row[1] == "auth"]
    raw_auth_columns = [row for row in records if row[0] == "columns" and row[1] == "auth"]
    if not auth_schemas and not raw_auth_columns:
        return
    if auth_schemas != [["schemas", "auth", AUTH_SCHEMA_OWNER]]:
        _receipt_error("receipt_auth_schema")
    auth_tables = {
        row[2] for row in records
        if row[0] == "relations" and row[1] == "auth" and len(row) >= 4 and row[3] == "r"
    }
    if auth_tables != set(AUTH_SCHEMA_COLUMN_ALLOWLIST):
        _receipt_error("receipt_auth_relations")
    auth_columns = [
        row for row in records
        if row[0] == "columns" and row[1] == "auth" and row[2] in auth_tables
    ]
    columns: dict[str, list[str]] = {}
    for row in auth_columns:
        if len(row) < 5 or not isinstance(row[2], str) or not isinstance(row[4], str):
            _receipt_error("receipt_auth_columns")
        columns.setdefault(row[2], []).append(row[4])
    if set(columns) != set(AUTH_SCHEMA_COLUMN_ALLOWLIST):
        _receipt_error("receipt_auth_columns")
    for relation, expected in AUTH_SCHEMA_COLUMN_ALLOWLIST.items():
        actual = columns.get(relation, [])
        if actual != list(expected) or len(set(actual)) != len(actual):
            _receipt_error("receipt_auth_columns")


def _validate_public_read_contract(records: list[list[Any]]) -> None:
    function_grants = [
        row for row in records if row[0] == "public_read_function_grants"
    ]
    if function_grants != [
        ["public_read_function_grants", "is_current_user_active_admin()", "anon", False],
        ["public_read_function_grants", "is_current_user_active_admin()", "authenticated", True],
        ["public_read_function_grants", "is_current_user_active_admin()", "privacy_workflow_owner", True],
        ["public_read_function_grants", "is_current_user_active_admin()", "service_role", False],
        ["public_read_function_grants", "is_user_admin(uuid)", "anon", False],
        ["public_read_function_grants", "is_user_admin(uuid)", "authenticated", False],
        ["public_read_function_grants", "is_user_admin(uuid)", "privacy_workflow_owner", True],
        ["public_read_function_grants", "is_user_admin(uuid)", "service_role", False],
    ]:
        _receipt_error("receipt_public_read_function_grants")

    expected_table_grants: list[list[Any]] = []
    for relation in ("ad_banners", "announcements"):
        expected_table_grants.extend([
            ["public_read_table_grants", relation, "anon", True, False, False, False],
            ["public_read_table_grants", relation, "authenticated", True, True, True, True],
            ["public_read_table_grants", relation, "service_role", True, True, True, True],
        ])
    if [row for row in records if row[0] == "public_read_table_grants"] != expected_table_grants:
        _receipt_error("receipt_public_read_table_grants")

    admin_expression = (
        "( SELECT is_current_user_active_admin() AS is_current_user_active_admin)"
    )
    expected_policies: list[list[Any]] = []
    for relation in ("ad_banners", "announcements"):
        policy_prefix = f"tzudong_{relation}"
        expected_policies.extend([
            [
                "public_read_policies",
                relation,
                f"{policy_prefix}_delete_admin",
                "DELETE",
                ["authenticated"],
                admin_expression,
                None,
            ],
            [
                "public_read_policies",
                relation,
                f"{policy_prefix}_insert_admin",
                "INSERT",
                ["authenticated"],
                None,
                admin_expression,
            ],
            [
                "public_read_policies",
                relation,
                f"{policy_prefix}_select_active",
                "SELECT",
                ["anon", "authenticated"],
                "(is_active = true)",
                None,
            ],
            [
                "public_read_policies",
                relation,
                f"{policy_prefix}_select_admin",
                "SELECT",
                ["authenticated"],
                admin_expression,
                None,
            ],
            [
                "public_read_policies",
                relation,
                f"{policy_prefix}_update_admin",
                "UPDATE",
                ["authenticated"],
                admin_expression,
                admin_expression,
            ],
        ])
    if [row for row in records if row[0] == "public_read_policies"] != expected_policies:
        _receipt_error("receipt_public_read_policies")

    policy_contracts = (
        ("restaurant_refresh_candidates", "restaurant_refresh_candidates_admin_insert", "INSERT", 1, 0),
        ("restaurant_refresh_candidates", "restaurant_refresh_candidates_admin_select", "SELECT", 1, 0),
        ("restaurant_refresh_candidates", "restaurant_refresh_candidates_admin_update", "UPDATE", 2, 0),
        ("restaurant_refresh_runs", "restaurant_refresh_runs_admin_insert", "INSERT", 1, 0),
        ("restaurant_refresh_runs", "restaurant_refresh_runs_admin_select", "SELECT", 1, 0),
        ("restaurant_refresh_runs", "restaurant_refresh_runs_admin_update", "UPDATE", 2, 0),
        ("restaurant_request_review_audit", "Admins can view request review audit", "SELECT", 1, 0),
        ("restaurant_requests", "Admins can update requests", "UPDATE", 2, 0),
        ("restaurant_requests", "Admins can view all requests", "SELECT", 1, 0),
        ("restaurant_requests", "Restaurant requests select policy", "SELECT", 1, 1),
        ("restaurant_submission_items", "Admins can delete submission items", "DELETE", 1, 0),
        ("restaurant_submission_items", "Admins can update submission items", "UPDATE", 1, 0),
        ("restaurant_submission_items", "Submission items insert policy", "INSERT", 1, 1),
        ("restaurant_submission_items", "Submission items select policy", "SELECT", 1, 1),
        ("restaurant_submissions", "Admins can update all submissions", "UPDATE", 1, 0),
        ("restaurant_submissions", "Restaurant submissions select policy", "SELECT", 1, 1),
        ("restaurants", "restaurants_authenticated_admin_update", "UPDATE", 2, 0),
        ("short_urls", "Admins can delete short URLs", "DELETE", 1, 0),
    )
    expected_caller_bound_policies = [
        [
            "caller_bound_admin_policies",
            relation,
            policy,
            command,
            ["authenticated"],
            helper_count,
            uid_count,
            0,
        ]
        for relation, policy, command, helper_count, uid_count in policy_contracts
    ]
    if [
        row for row in records if row[0] == "caller_bound_admin_policies"
    ] != expected_caller_bound_policies:
        _receipt_error("receipt_caller_bound_admin_policies")

    expected_admin_rpcs = [
        [
            "admin_data_rpcs",
            "public.append_admin_user_audit_event(uuid,uuid,text,text,text,uuid,jsonb,jsonb,timestamp with time zone,text,uuid,text,text)",
            "uuid",
            "privacy_workflow_owner",
            True,
            "volatile",
            ['search_path=""'],
            True,
            False,
            False,
            True,
        ],
        [
            "admin_data_rpcs",
            "public.read_admin_user_audit_events(integer)",
            "TABLE(id uuid, actor_user_id uuid, target_user_id uuid, action text, reason text, status text, correlation_id uuid, applied_at timestamp with time zone, error_code text, created_at timestamp with time zone, audit_counts jsonb, audit_flags jsonb)",
            "privacy_workflow_owner",
            True,
            "stable",
            ['search_path=""'],
            True,
            False,
            False,
            True,
        ],
        [
            "admin_data_rpcs",
            "public.read_admin_user_ids_for_management()",
            "TABLE(user_id uuid)",
            "privacy_workflow_owner",
            True,
            "stable",
            ['search_path=""'],
            True,
            False,
            False,
            True,
        ],
        [
            "admin_data_rpcs",
            "public.read_admin_user_management_metadata(uuid[])",
            "TABLE(user_id uuid, username text, nickname text, avatar_url text, profile_role text, profile_created_at timestamp with time zone, profile_updated_at timestamp with time zone, is_admin boolean, account_status text)",
            "privacy_workflow_owner",
            True,
            "stable",
            ['search_path=""'],
            True,
            False,
            False,
            True,
        ],
    ]
    if [row for row in records if row[0] == "admin_data_rpcs"] != expected_admin_rpcs:
        _receipt_error("receipt_admin_data_rpcs")

    if [row for row in records if row[0] == "admin_data_table_grants"] != [
        ["admin_data_table_grants", relation, False, False, False, False]
        for relation in (
            "admin_audit_events",
            "profiles",
            "user_account_status",
            "user_roles",
        )
    ]:
        _receipt_error("receipt_admin_data_table_grants")


def _validate_admin_map_overlay_contract(records: list[list[Any]]) -> None:
    expected_rpc = [[
        "admin_map_overlay_rpc",
        "public.apply_admin_restaurant_map_overlay_action(uuid,text,uuid,text,text,text,timestamp with time zone,timestamp with time zone,jsonb,text,text,text,uuid,text,jsonb)",
        "jsonb",
        "privacy_workflow_owner",
        True,
        "volatile",
        ['search_path=""'],
        True,
        False,
        False,
        True,
        True,
        False,
        False,
        False,
        True,
    ]]
    if [row for row in records if row[0] == "admin_map_overlay_rpc"] != expected_rpc:
        _receipt_error("receipt_admin_map_overlay_rpc")

    expected_grants = [
        [
            "admin_map_overlay_table_grants",
            "admin_restaurant_map_overlay_audit_events",
            role,
            role == "privacy_workflow_owner",
            role == "privacy_workflow_owner",
            False,
            False,
            False,
            False,
            False,
        ]
        for role in ("anon", "authenticated", "privacy_workflow_owner", "service_role")
    ]
    expected_grants.extend([
        [
            "admin_map_overlay_table_grants",
            "admin_restaurant_map_overlays",
            role,
            role in ("privacy_workflow_owner", "service_role"),
            role == "privacy_workflow_owner",
            role == "privacy_workflow_owner",
            False,
            False,
            False,
            False,
        ]
        for role in ("anon", "authenticated", "privacy_workflow_owner", "service_role")
    ])
    expected_grants.append([
        "admin_map_overlay_table_grants",
        "restaurants",
        "privacy_workflow_owner",
        True,
        False,
        False,
        False,
        False,
        False,
        False,
    ])
    if [
        row for row in records if row[0] == "admin_map_overlay_table_grants"
    ] != expected_grants:
        _receipt_error("receipt_admin_map_overlay_table_grants")

    expected_policies = [
        [
            "admin_map_overlay_policies",
            "admin_restaurant_map_overlay_audit_events",
            "tzudong_admin_map_overlay_audit_owner_insert",
            "INSERT",
            ["privacy_workflow_owner"],
            None,
            "true",
        ],
        [
            "admin_map_overlay_policies",
            "admin_restaurant_map_overlay_audit_events",
            "tzudong_admin_map_overlay_audit_owner_select",
            "SELECT",
            ["privacy_workflow_owner"],
            "true",
            None,
        ],
        [
            "admin_map_overlay_policies",
            "admin_restaurant_map_overlays",
            "tzudong_admin_map_overlays_owner_insert",
            "INSERT",
            ["privacy_workflow_owner"],
            None,
            "true",
        ],
        [
            "admin_map_overlay_policies",
            "admin_restaurant_map_overlays",
            "tzudong_admin_map_overlays_owner_select",
            "SELECT",
            ["privacy_workflow_owner"],
            "true",
            None,
        ],
        [
            "admin_map_overlay_policies",
            "admin_restaurant_map_overlays",
            "tzudong_admin_map_overlays_owner_update",
            "UPDATE",
            ["privacy_workflow_owner"],
            "true",
            "true",
        ],
    ]
    if [row for row in records if row[0] == "admin_map_overlay_policies"] != expected_policies:
        _receipt_error("receipt_admin_map_overlay_policies")


def _validate_seed_invariants(records: list[list[Any]]) -> None:
    _normalize_auth_logical_ids(records)
    if [row for row in records if row[0] == "privacy_policy_fixture"] != [[
        "privacy_policy_fixture",
        LOCAL_PRIVACY_POLICY_FIXTURE_ID,
        LOCAL_PRIVACY_POLICY_VERSION,
        "ko-KR",
        "published",
        LOCAL_PRIVACY_POLICY_CONTENT_SHA256,
        FIXTURE_TIMESTAMP,
        FIXTURE_TIMESTAMP,
        LOCAL_PRIVACY_POLICY_PROVENANCE,
        True,
    ]]:
        _receipt_error("receipt_privacy_policy_fixture")
    if [row for row in records if row[0] == "privacy_age_profile"] != [[
        "privacy_age_profile",
        NIGHTLY_LOGICAL_ID,
        "age_14_plus",
        "self_attestation",
        "eligible",
        LOCAL_PRIVACY_POLICY_VERSION,
        FIXTURE_TIMESTAMP,
        FIXTURE_TIMESTAMP,
    ]]:
        _receipt_error("receipt_privacy_age_profile")
    if [row for row in records if row[0] == "youtube_channel_snapshot"] != [[
        "youtube_channel_snapshot",
        "local-nightly-channel-snapshot",
        "local-nightly-channel",
        "[LOCAL TEST] Nightly channel fixture",
        "@local-nightly",
        1000,
        100000,
        100,
        False,
        True,
        0,
        0,
        0,
        FIXTURE_TIMESTAMP,
        FIXTURE_TIMESTAMP,
        LOCAL_YOUTUBE_CHANNEL_PROVENANCE,
    ]]:
        _receipt_error("receipt_youtube_channel_snapshot")
    restaurants = [row for row in records if row[0] == "restaurants"]
    expected_restaurants = [
        [
            "restaurants",
            "00000000-0000-4000-8000-000000000101",
            "nightly-trace-1",
            "정원분식",
            "approved",
            ["분식"],
            "2026-01-01T00:00:00Z",
            "2026-01-01T00:00:00Z",
        ],
        [
            "restaurants",
            "00000000-0000-4000-8000-000000000102",
            "nightly-trace-2",
            "명동칼국수",
            "approved",
            ["한식"],
            "2026-01-02T00:00:00Z",
            "2026-01-02T00:00:00Z",
        ],
    ]
    if restaurants != expected_restaurants:
        _receipt_error("receipt_restaurant_fixture")
    expected_announcement = [
        "announcements",
        "00000000-0000-4000-8000-000000000201",
        "Local nightly fixture",
        "Deterministic local regression announcement.",
        True,
        True,
        1,
        FIXTURE_TIMESTAMP,
        FIXTURE_TIMESTAMP,
    ]
    announcements = [row for row in records if row[0] == "announcements"]
    allowed_announcement_ids = BASELINE_ANNOUNCEMENT_IDS | {expected_announcement[1]}
    if any(row[1] not in allowed_announcement_ids for row in announcements):
        _receipt_error("receipt_announcement_fixture")
    if [row for row in announcements if row[1] == expected_announcement[1]] != [expected_announcement]:
        _receipt_error("receipt_announcement_fixture")
    expected_buckets = [
        ["seed_buckets", "ad-banner-images", "ad-banner-images", True],
        ["seed_buckets", "avatars", "avatars", True],
        ["seed_buckets", "profile-avatars", "profile-avatars", True],
        ["seed_buckets", "review-photos", "review-photos", True],
        ["seed_buckets", "youtube-thumbnail-releases", "youtube-thumbnail-releases", False],
    ]
    buckets = [row for row in records if row[0] == "seed_buckets"]
    if buckets != expected_buckets:
        _receipt_error("receipt_bucket_fixture")
    storage_buckets = [row for row in records if row[0] == "storage_buckets"]
    if [(row[1], row[2], row[3]) for row in storage_buckets] != [
        ("ad-banner-images", "ad-banner-images", True),
        ("avatars", "avatars", True),
        ("profile-avatars", "profile-avatars", True),
        ("review-photos", "review-photos", True),
        ("youtube-thumbnail-releases", "youtube-thumbnail-releases", False),
    ]:
        _receipt_error("receipt_bucket_fixture")
    storage_policies = [row for row in records if row[0] == "storage_policies"]
    if len(storage_policies) != 12 or any(row[1:3] != ["storage", "objects"] for row in storage_policies):
        _receipt_error("receipt_storage_policy_fixture")
    policy_names = {row[3] for row in storage_policies}
    expected_policy_names = {
        "local_nightly_avatar_insert", "local_nightly_avatar_read",
        "tzudong_ad_banner_delete_admin", "tzudong_ad_banner_insert_admin",
        "tzudong_ad_banner_update_admin", "tzudong_profile_avatar_delete_own",
        "tzudong_profile_avatar_insert_own", "tzudong_profile_avatar_update_own",
        "tzudong_public_media_read", "tzudong_review_photo_delete_own",
        "tzudong_review_photo_insert_own", "tzudong_review_photo_update_own",
    }
    if policy_names != expected_policy_names:
        _receipt_error("receipt_storage_policy_fixture")
    policy_contracts = {
        "local_nightly_avatar_insert": ("INSERT", ["authenticated"], None, ("avatars",)),
        "local_nightly_avatar_read": ("SELECT", ["anon", "authenticated"], ("avatars",), None),
        "tzudong_ad_banner_delete_admin": ("DELETE", ["authenticated"], ("ad-banner-images", "user_roles", "user_account_status", "active", "foldername", "uid()"), None),
        "tzudong_ad_banner_insert_admin": ("INSERT", ["authenticated"], None, ("ad-banner-images", "user_roles", "user_account_status", "active", "foldername", "uid()")),
        "tzudong_ad_banner_update_admin": ("UPDATE", ["authenticated"], ("ad-banner-images", "user_roles", "user_account_status", "active", "foldername", "uid()"), ("ad-banner-images", "user_roles", "user_account_status", "active", "foldername", "uid()")),
        "tzudong_profile_avatar_delete_own": ("DELETE", ["authenticated"], ("profile-avatars", "foldername", "uid()"), None),
        "tzudong_profile_avatar_insert_own": ("INSERT", ["authenticated"], None, ("profile-avatars", "foldername", "uid()")),
        "tzudong_profile_avatar_update_own": ("UPDATE", ["authenticated"], ("profile-avatars", "foldername", "uid()"), ("profile-avatars", "foldername", "uid()")),
        "tzudong_public_media_read": ("SELECT", ["anon", "authenticated"], ("ad-banner-images", "profile-avatars", "review-photos"), None),
        "tzudong_review_photo_delete_own": ("DELETE", ["authenticated"], ("review-photos", "foldername", "uid()"), None),
        "tzudong_review_photo_insert_own": ("INSERT", ["authenticated"], None, ("review-photos", "foldername", "uid()")),
        "tzudong_review_photo_update_own": ("UPDATE", ["authenticated"], ("review-photos", "foldername", "uid()"), ("review-photos", "foldername", "uid()")),
    }
    for row in storage_policies:
        command, roles, using_tokens, check_tokens = policy_contracts[row[3]]
        if row[4] != command or row[5] != roles:
            _receipt_error("receipt_storage_policy_fixture")
        for expression, tokens in ((row[6], using_tokens), (row[7], check_tokens)):
            if tokens is None:
                if expression is not None:
                    _receipt_error("receipt_storage_policy_fixture")
            elif not isinstance(expression, str) or any(token not in expression for token in tokens):
                _receipt_error("receipt_storage_policy_fixture")
    realtime = [row for row in records if row[0] == "seed_realtime"]
    expected_realtime = [
        ["seed_realtime", "supabase_realtime", "public", "notifications"],
        ["seed_realtime", "supabase_realtime", "public", "profiles"],
        ["seed_realtime", "supabase_realtime", "public", "review_likes"],
        ["seed_realtime", "supabase_realtime", "public", "reviews"],
    ]
    if realtime != expected_realtime:
        _receipt_error("receipt_realtime_fixture")
    realtime_membership = [row for row in records if row[0] == "realtime_membership"]
    if realtime_membership != [
        ["realtime_membership", *row[1:]] for row in expected_realtime
    ]:
        _receipt_error("receipt_realtime_fixture")
    if [row for row in records if row[0] == "user_roles"] != [
        ["user_roles", NIGHTLY_LOGICAL_ID, "admin"]
    ]:
        _receipt_error("receipt_admin_fixture")
    if [row for row in records if row[0] == "user_account_status"] != [
        ["user_account_status", NIGHTLY_LOGICAL_ID, "active", True]
    ]:
        _receipt_error("receipt_account_status_fixture")


def parse_readback(value: bytes | str | Sequence[Any]) -> list[list[Any]]:
    if isinstance(value, bytes):
        try:
            text = value.decode("utf-8")
            if not text.endswith("\n"):
                _receipt_error("receipt_newline")
            lines = text.splitlines()
            if any(not line for line in lines):
                _receipt_error("receipt_blank_line")
            raw_records: Sequence[Any] = [json.loads(line) for line in lines]
        except UnicodeDecodeError as error:
            raise LocalMigrationError("receipt_not_utf8") from error
        except json.JSONDecodeError as error:
            raise LocalMigrationError("receipt_json_invalid") from error
    elif isinstance(value, str):
        if not value.endswith("\n"):
            _receipt_error("receipt_newline")
        lines = value.splitlines()
        if any(not line for line in lines):
            _receipt_error("receipt_blank_line")
        try:
            raw_records = [json.loads(line) for line in lines]
        except json.JSONDecodeError as error:
            raise LocalMigrationError("receipt_json_invalid") from error
    else:
        raw_records = value
    records: list[list[Any]] = []
    seen_sections: set[str] = set()
    previous_section_index = -1
    previous_key: tuple[Any, ...] | None = None
    for raw in raw_records:
        if not isinstance(raw, list) or not raw or not isinstance(raw[0], str):
            _receipt_error("receipt_row_shape")
        section = raw[0]
        if section not in READBACK_FIELDS:
            _receipt_error("receipt_unknown_section")
        normalized = _normalize_receipt_value(raw)
        expected_length = len(READBACK_FIELDS[section]) + 1
        if len(normalized) != expected_length:
            _receipt_error("receipt_field_count")
        section_index = READBACK_SECTIONS.index(section)
        if section_index < previous_section_index:
            _receipt_error("receipt_section_order")
        key = _receipt_row_key(section, normalized)
        if section_index == previous_section_index and previous_key is not None and key < previous_key:
            _receipt_error("receipt_row_order")
        previous_section_index, previous_key = section_index, key
        seen_sections.add(section)
        records.append(normalized)
    if not records:
        _receipt_error("receipt_empty")
    if seen_sections != set(READBACK_SECTIONS):
        _receipt_error("receipt_section_missing")
    _validate_auth_catalog(records)
    _validate_public_read_contract(records)
    _validate_admin_map_overlay_contract(records)
    _validate_seed_invariants(records)
    return records


def _serialize_rows(records: Sequence[list[Any]]) -> bytes:
    encoded: list[str] = []
    for row in records:
        try:
            encoded.append(json.dumps(row, ensure_ascii=True, separators=(",", ":"), allow_nan=False))
        except (TypeError, ValueError) as error:
            raise LocalMigrationError("receipt_value_invalid") from error
    return ("\n".join(encoded) + "\n").encode("utf-8")


def serialize_receipt_v1(value: bytes | str | Sequence[Any]) -> bytes:
    """Validate and serialize ordered readback rows according to receipt-v1."""
    return _serialize_rows(parse_readback(value))


def _expected_unit_evidence(item: Mapping[str, Any]) -> str:
    return _sha256_bytes(
        _serialize_rows(
            [
                [
                    "unit",
                    item["path"],
                    item["ordinal"],
                    item["sha256"],
                    item["byteLength"],
                    item["transaction"]["class"],
                    "running",
                    "",
                ]
            ]
        )
    )


def _expected_ledger_records(manifest: Mapping[str, Any]) -> list[list[Any]]:
    files = manifest["source"]["files"]
    if len(files) != EXPECTED_LEDGER_UNITS:
        raise LocalMigrationError("receipt_ledger_state")
    return [
        [
            "ledger",
            item["path"],
            item["ordinal"],
            item["sha256"],
            item["byteLength"],
            item["transaction"]["class"],
            "applied",
            _expected_unit_evidence(item),
        ]
        for item in files
    ]


def _receipt_payload_digests(
    records: Sequence[list[Any]],
    ledger_records: Sequence[list[Any]],
    service_records: Sequence[list[Any]],
    manifest: Mapping[str, Any],
) -> dict[str, str]:
    expected_ledger = _expected_ledger_records(manifest)
    if list(ledger_records) != expected_ledger:
        raise LocalMigrationError("receipt_ledger_state")
    if len(service_records) != 1:
        raise LocalMigrationError("receipt_service_shape")
    service = service_records[0]
    if (
        not isinstance(service, list)
        or len(service) != 4
        or service[0] != "service"
        or any(not isinstance(value, str) for value in service[1:])
    ):
        raise LocalMigrationError("receipt_service_shape")
    return {
        "readback_sha256": _sha256_bytes(_serialize_rows(list(records))),
        "catalog_sha256": _digest_rows(records, CATALOG_SECTIONS),
        "seed_sha256": _digest_rows(records, SEED_SECTIONS),
        "ledger_sha256": _sha256_bytes(_serialize_rows(list(ledger_records))),
        "service_sha256": _sha256_bytes(_serialize_rows(list(service_records))),
    }


def _parse_receipt_payloads(value: Mapping[str, Any]) -> tuple[list[list[Any]], list[list[Any]], list[list[Any]]]:
    readback_payload = value.get("readback")
    if not isinstance(readback_payload, list):
        raise LocalMigrationError("receipt_readback_payload")
    records = parse_readback(readback_payload)
    if records != readback_payload:
        raise LocalMigrationError("receipt_readback_payload")
    service_records = value.get("service")
    if not isinstance(service_records, list):
        raise LocalMigrationError("receipt_service_payload")
    normalized_service = _normalize_receipt_value(service_records)
    if normalized_service != service_records:
        raise LocalMigrationError("receipt_service_payload")
    if len(service_records) != 1:
        raise LocalMigrationError("receipt_service_payload")
    ledger_records = value.get("ledger")
    if not isinstance(ledger_records, list):
        raise LocalMigrationError("receipt_ledger_state")
    return records, ledger_records, service_records


def _digest_rows(records: Sequence[list[Any]], sections: Sequence[str]) -> str:
    selected = [row for row in records if row[0] in sections]
    return _sha256_bytes(_serialize_rows(selected))


def _capture_lines(executor: PsqlExecutor, sql: bytes, expected_fields: int) -> list[list[str]]:
    try:
        text = executor.capture(sql).decode("utf-8")
    except UnicodeDecodeError as error:
        raise LocalMigrationError("receipt_query_not_utf8") from error
    rows: list[list[str]] = []
    for line in text.splitlines():
        if not line:
            continue
        row = line.split("|")
        if len(row) != expected_fields:
            raise LocalMigrationError("receipt_query_shape")
        rows.append(row)
    return rows
def _http_status_class(status: int) -> str:
    if not isinstance(status, int) or status < 100 or status > 599:
        return "invalid"
    return f"{status // 100}xx"

def _local_auth_base_url(values: Mapping[str, str]) -> str:
    raw = values.get("API_EXTERNAL_URL")
    port_text = values.get("KONG_HTTP_PORT")
    if (
        not isinstance(raw, str)
        or not isinstance(port_text, str)
        or not re.fullmatch(r"[0-9]{1,5}", port_text)
        or int(port_text) < 1
        or int(port_text) > 65535
    ):
        raise LocalMigrationError("auth_endpoint_invalid")
    parsed = urlparse(raw)
    try:
        parsed_port = parsed.port
    except ValueError as error:
        raise LocalMigrationError("auth_endpoint_invalid") from error
    if (
        parsed.scheme != "http"
        or parsed.hostname != "127.0.0.1"
        or parsed.username is not None
        or parsed.password is not None
        or parsed.params
        or parsed.query
        or parsed.fragment
        or parsed.path not in {"", "/"}
        or parsed_port != int(port_text)
    ):
        raise LocalMigrationError("auth_endpoint_invalid")
    return f"http://127.0.0.1:{port_text}"

class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise LocalMigrationError("auth_redirect_rejected")

def _auth_api_request(
    values: Mapping[str, str],
    path: str,
    api_key: str,
    payload: Mapping[str, Any],
    operation: str,
) -> tuple[str, dict[str, Any]]:
    if path not in {AUTH_API_CREATE_PATH, AUTH_API_LOGIN_PATH}:
        raise LocalMigrationError("auth_endpoint_invalid")
    if (
        not isinstance(api_key, str)
        or not api_key
        or any(char in api_key for char in "\x00\r\n")
        or not re.fullmatch(r"[A-Za-z0-9._~+/=-]+", api_key)
    ):
        raise LocalMigrationError("auth_key_missing")
    url = _local_auth_base_url(values) + path
    try:
        body = json.dumps(payload, ensure_ascii=True, sort_keys=True, separators=(",", ":")).encode("ascii")
    except (TypeError, ValueError) as error:
        raise LocalMigrationError("auth_request_shape") from error
    request = Request(
        url,
        data=body,
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "apikey": api_key,
            "Authorization": "Bearer " + api_key,
        },
        method="POST",
    )
    opener = build_opener(_NoRedirect)
    try:
        with opener.open(request, timeout=30) as response:
            if response.geturl() != url:
                raise LocalMigrationError("auth_endpoint_invalid")
            status = int(response.status)
            response_body = response.read(131073)
    except LocalMigrationError:
        raise
    except HTTPError as error:
        status = int(error.code)
        raise LocalMigrationError(f"auth_{operation}_{_http_status_class(status)}") from None
    except (URLError, TimeoutError, OSError) as error:
        raise LocalMigrationError(f"auth_{operation}_transport") from error
    if len(response_body) > 131072:
        raise LocalMigrationError(f"auth_{operation}_response_too_large")
    if status < 200 or status >= 300:
        raise LocalMigrationError(f"auth_{operation}_{_http_status_class(status)}")
    if status != 200:
        raise LocalMigrationError(f"auth_{operation}_status_unexpected")
    try:
        decoded = json.loads(response_body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise LocalMigrationError(f"auth_{operation}_response_shape") from error
    if not isinstance(decoded, dict):
        raise LocalMigrationError(f"auth_{operation}_response_shape")
    return _http_status_class(status), decoded

def _auth_api_create_and_login(
    values: Mapping[str, str],
    password: str,
) -> tuple[str, dict[str, str]]:
    email = values.get("NIGHTLY_ADMIN_EMAIL")
    service_key = values.get("SERVICE_ROLE_KEY")
    anon_key = values.get("ANON_KEY")
    if email != NIGHTLY_EMAIL:
        raise LocalMigrationError("auth_email_invalid")
    if (
        not isinstance(password, str)
        or len(password) < 16
        or any(char in password for char in "\x00\r\n")
        or not re.fullmatch(r"[A-Za-z0-9_./:=+@,-]+", password)
    ):
        raise LocalMigrationError("nightly_password_missing")
    _, created = _auth_api_request(
        values,
        AUTH_API_CREATE_PATH,
        service_key if isinstance(service_key, str) else "",
        {
            "email": email,
            "password": password,
            "email_confirm": True,
            "user_metadata": {"nightly": True, "display_name": "Nightly CI"},
        },
        "create",
    )
    created_id = created.get("id")
    if (
        not isinstance(created_id, str)
        or not _UUID.fullmatch(created_id)
        or created.get("email") != email
    ):
        raise LocalMigrationError("auth_create_response_shape")
    _auth_api_login_existing(values, password, created_id)
    return created_id, {
        "schema": AUTH_API_SCHEMA,
        "create_status": "2xx",
        "create_error_class": "none",
        "login_status": "2xx",
        "login_error_class": "none",
    }

def _auth_api_login_existing(
    values: Mapping[str, str],
    password: str,
    expected_user_id: str,
) -> None:
    email = values.get("NIGHTLY_ADMIN_EMAIL")
    anon_key = values.get("ANON_KEY")
    if email != NIGHTLY_EMAIL:
        raise LocalMigrationError("auth_email_invalid")
    if (
        not isinstance(password, str)
        or len(password) < 16
        or any(char in password for char in "\x00\r\n")
        or not re.fullmatch(r"[A-Za-z0-9_./:=+@,-]+", password)
    ):
        raise LocalMigrationError("nightly_password_missing")
    if not isinstance(expected_user_id, str) or not _UUID.fullmatch(expected_user_id):
        raise LocalMigrationError("auth_user_id_invalid")
    _, logged_in = _auth_api_request(
        values,
        AUTH_API_LOGIN_PATH,
        anon_key if isinstance(anon_key, str) else "",
        {"email": email, "password": password},
        "login",
    )
    login_user = logged_in.get("user")
    access_token = logged_in.get("access_token")
    if (
        not isinstance(login_user, dict)
        or login_user.get("id") != expected_user_id
        or login_user.get("email") != email
        or not isinstance(access_token, str)
        or not access_token
    ):
        raise LocalMigrationError("auth_login_response_shape")

def _existing_auth_api_user_id(executor: PsqlExecutor) -> str | None:
    rows = _capture_lines(executor, _AUTH_API_LEDGER_READBACK_SQL, 8)
    if not rows:
        return None
    if len(rows) != 1:
        raise LocalMigrationError("auth_receipt_ledger")
    row = rows[0]
    if (
        row[0] != NIGHTLY_LOGICAL_ID
        or row[1] != NIGHTLY_EMAIL
        or not _UUID.fullmatch(row[2])
        or row[3:] != ["2xx", "none", "2xx", "none", "applied"]
    ):
        raise LocalMigrationError("auth_receipt_ledger")
    return row[2].lower()

def _auth_api_ledger_sql(user_id: str, receipt: Mapping[str, str]) -> bytes:
    if not isinstance(user_id, str) or not _UUID.fullmatch(user_id):
        raise LocalMigrationError("auth_user_id_invalid")
    expected = {
        "schema": AUTH_API_SCHEMA,
        "create_status": "2xx",
        "create_error_class": "none",
        "login_status": "2xx",
        "login_error_class": "none",
    }
    if dict(receipt) != expected:
        raise LocalMigrationError("auth_receipt_shape")
    return (
        "BEGIN;\n"
        "INSERT INTO _tzudong_local.auth_api_ledger("
        "logical_id,email,user_id,create_status,create_error_class,"
        "login_status,login_error_class,status,updated_at"
        ") VALUES ("
        + ",".join((
            _q(NIGHTLY_LOGICAL_ID),
            _q(NIGHTLY_EMAIL),
            _q(user_id.lower()),
            _q(receipt["create_status"]),
            _q(receipt["create_error_class"]),
            _q(receipt["login_status"]),
            _q(receipt["login_error_class"]),
            _q("running"),
            "clock_timestamp()",
        ))
        + ") ON CONFLICT (logical_id) DO UPDATE SET "
        "email=EXCLUDED.email,user_id=EXCLUDED.user_id,"
        "create_status=EXCLUDED.create_status,create_error_class=EXCLUDED.create_error_class,"
        "login_status=EXCLUDED.login_status,login_error_class=EXCLUDED.login_error_class,"
        "status='running',updated_at=clock_timestamp();\nCOMMIT;\n"
    ).encode("utf-8")

def _auth_api_ledger_reseed_sql(user_id: str) -> bytes:
    if not isinstance(user_id, str) or not _UUID.fullmatch(user_id):
        raise LocalMigrationError("auth_user_id_invalid")
    return (
        "BEGIN; DO $reseed$ BEGIN "
        "UPDATE _tzudong_local.auth_api_ledger SET status='running',"
        "updated_at=clock_timestamp() WHERE logical_id='nightly-ci' "
        "AND email='nightly-ci@local.invalid' AND user_id="
        + _q(user_id.lower())
        + "::uuid AND create_status='2xx' AND create_error_class='none' "
        "AND login_status='2xx' AND login_error_class='none' AND status='applied'; "
        "IF NOT FOUND THEN RAISE EXCEPTION 'local_seed_auth_ledger_reuse'; END IF; "
        "END $reseed$; COMMIT;\n"
    ).encode("utf-8")

def _auth_api_ledger_applied_sql() -> bytes:
    return (
        "BEGIN; UPDATE _tzudong_local.auth_api_ledger SET status='applied',"
        "updated_at=clock_timestamp() WHERE logical_id='nightly-ci' AND status='running';"
        " COMMIT;\n"
    ).encode("utf-8")

def _auth_api_ledger_readback(executor: PsqlExecutor, user_id: str | None = None) -> None:
    rows = _capture_lines(executor, _AUTH_API_LEDGER_READBACK_SQL, 8)
    if len(rows) != 1:
        raise LocalMigrationError("auth_receipt_ledger")
    row = rows[0]
    if (
        row[0] != NIGHTLY_LOGICAL_ID
        or row[1] != NIGHTLY_EMAIL
        or not _UUID.fullmatch(row[2])
        or user_id is not None and row[2] != user_id.lower()
        or row[3:] != ["2xx", "none", "2xx", "none", "applied"]
    ):
        raise LocalMigrationError("auth_receipt_ledger")
def _assert_canonical_receipt_container(executor: PsqlExecutor) -> str:
    executor._admit_container()
    return executor._expected_project()


def _repository_commit() -> str | None:
    try:
        result = subprocess.run(
            ["git", "-C", str(repository_root()), "rev-parse", "HEAD"],
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            timeout=10, check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    value = result.stdout.decode("ascii", "ignore").strip()
    return value if _HEX40.fullmatch(value) else None


def _function_source_evidence(
    functions: Any,
    records: Sequence[Mapping[str, Any]],
) -> str:
    """Bind every staged Edge Function source under one legacy receipt field."""
    if (
        not isinstance(functions, dict)
        or functions.get("root") != "functions"
        or functions.get("files") != list(FUNCTION_SOURCES)
    ):
        raise LocalMigrationError("receipt_input_provenance")
    function_records = [
        record for record in records
        if record.get("path") in FUNCTION_SOURCES
    ]
    if (
        len(function_records) != len(FUNCTION_SOURCES)
        or [record.get("path") for record in function_records] != list(FUNCTION_SOURCES)
        or any(
            record.get("source") != record.get("path")
            or not isinstance(record.get("source_sha256"), str)
            or not _HEX64.fullmatch(record["source_sha256"])
            for record in function_records
        )
    ):
        raise LocalMigrationError("receipt_input_provenance")
    return _sha256_bytes(canonical_json([
        {"path": record["path"], "sha256": record["source_sha256"]}
        for record in function_records
    ]))


def _generated_input_evidence(state: Path, project: str) -> dict[str, Any]:
    manifest_candidate = repository_root() / INPUT_MANIFEST_SOURCE
    try:
        manifest_path = _require_owned_regular_file(manifest_candidate, "receipt_input_provenance")
        source_manifest_sha256 = _sha256_file(manifest_path)[0]
        source_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        provenance_path = _require_owned_regular_file(
            state / "stack.inputs.provenance.json",
            "receipt_input_provenance",
        )
        provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
    except LocalMigrationError:
        raise
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise LocalMigrationError("receipt_input_provenance") from error
    if (
        not isinstance(source_manifest, dict)
        or source_manifest.get("schema") != "local-stack-input-manifest-v1"
        or source_manifest.get("generator_version") != LOCAL_STACK_GENERATOR_VERSION
        or not isinstance(source_manifest.get("inputs"), list)
        or provenance.get("schema") != LOCAL_INPUT_PROVENANCE_SCHEMA
        or provenance.get("project_name") != project
        or provenance.get("source_manifest") != INPUT_MANIFEST_SOURCE.relative_to(Path("backend/supabase")).as_posix()
        or provenance.get("source_manifest_sha256") != source_manifest_sha256
        or not isinstance(provenance.get("records"), list)
    ):
        raise LocalMigrationError("receipt_input_provenance")
    records = provenance["records"]
    entries = source_manifest["inputs"]
    if len(records) != len(entries):
        raise LocalMigrationError("receipt_input_provenance")
    expected_records: list[dict[str, Any]] = []
    for entry, record in zip(entries, records):
        if not isinstance(entry, dict) or not isinstance(record, dict):
            raise LocalMigrationError("receipt_input_provenance")
        output = entry.get("output")
        source = entry.get("source") or entry.get("template")
        source_hash = entry.get("source_sha256") or entry.get("template_sha256")
        if (
            not isinstance(output, str)
            or not isinstance(source, str)
            or not isinstance(source_hash, str)
            or not _HEX64.fullmatch(source_hash)
            or record.get("path") != output
            or record.get("source") != source
            or record.get("source_sha256") != source_hash
            or record.get("output_sha256") != source_hash
            or record.get("sha256") != source_hash
        ):
            raise LocalMigrationError("receipt_input_provenance")
        source_path = (
            repository_root() / "backend/supabase/local-inputs" / source
            if entry.get("kind") == "template"
            else repository_root() / "backend/supabase" / source
        )
        output_path = state / "inputs" / output
        try:
            source_path = _require_owned_regular_file(source_path, "receipt_input_provenance")
            output_path = _require_owned_regular_file(output_path, "receipt_input_provenance")
            if (
                _sha256_file(source_path)[0] != source_hash
                or _sha256_file(output_path)[0] != source_hash
            ):
                raise LocalMigrationError("receipt_input_provenance")
        except LocalMigrationError:
            raise
        except OSError as error:
            raise LocalMigrationError("receipt_input_provenance") from error
        expected_records.append(
            {
                "path": output,
                "source": source,
                "source_sha256": source_hash,
                "output_sha256": source_hash,
                "sha256": source_hash,
                "service": entry.get("service"),
                "destination": entry.get("destination"),
            }
        )
    compose_files = source_manifest.get("compose_files")
    if not isinstance(compose_files, list) or len(compose_files) != len(COMPOSE_SOURCES):
        raise LocalMigrationError("receipt_input_provenance")
    current_compose: list[dict[str, str]] = []
    for path, item in zip(COMPOSE_SOURCES, compose_files):
        relative = path.as_posix()
        compose_path = repository_root() / path
        if not isinstance(item, dict) or item.get("path") != relative:
            raise LocalMigrationError("receipt_input_provenance")
        try:
            compose_path = _require_owned_regular_file(compose_path, "receipt_input_provenance")
            digest = _sha256_file(compose_path)[0]
        except LocalMigrationError:
            raise
        except OSError as error:
            raise LocalMigrationError("receipt_input_provenance") from error
        if item.get("sha256") != digest:
            raise LocalMigrationError("receipt_input_provenance")
        current_compose.append({"path": relative, "sha256": digest})
    function_source_sha256 = _function_source_evidence(
        source_manifest.get("functions"), expected_records
    )
    return {
        "input_source_manifest_sha256": source_manifest_sha256,
        "input_evidence_sha256": _sha256_bytes(canonical_json(expected_records)),
        "compose_evidence_sha256": _sha256_bytes(canonical_json(current_compose)),
        "function_source_sha256": function_source_sha256,
    }
def _current_source_bindings() -> dict[str, str]:
    manifest = verify_manifest()
    manifest_candidate = repository_root() / INPUT_MANIFEST_SOURCE
    try:
        manifest_path = _require_owned_regular_file(manifest_candidate, "receipt_input_provenance")
        input_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise LocalMigrationError("receipt_input_provenance") from error
    if (
        not isinstance(input_manifest, dict)
        or input_manifest.get("schema") != "local-stack-input-manifest-v1"
        or input_manifest.get("generator_version") != LOCAL_STACK_GENERATOR_VERSION
        or not isinstance(input_manifest.get("inputs"), list)
    ):
        raise LocalMigrationError("receipt_input_provenance")
    records: list[dict[str, Any]] = []
    for entry in input_manifest["inputs"]:
        if not isinstance(entry, dict):
            raise LocalMigrationError("receipt_input_provenance")
        output = entry.get("output")
        source = entry.get("source") or entry.get("template")
        source_sha256 = entry.get("source_sha256") or entry.get("template_sha256")
        if (
            not isinstance(output, str)
            or not isinstance(source, str)
            or not isinstance(source_sha256, str)
            or not _HEX64.fullmatch(source_sha256)
        ):
            raise LocalMigrationError("receipt_input_provenance")
        source_path = (
            repository_root() / "backend/supabase/local-inputs" / source
            if entry.get("kind") == "template"
            else repository_root() / "backend/supabase" / source
        )
        try:
            source_path = _require_owned_regular_file(source_path, "receipt_input_provenance")
            if _sha256_file(source_path)[0] != source_sha256:
                raise LocalMigrationError("receipt_input_provenance")
        except LocalMigrationError:
            raise
        except OSError as error:
            raise LocalMigrationError("receipt_input_provenance") from error
        records.append({
            "path": output,
            "source": source,
            "source_sha256": source_sha256,
            "output_sha256": source_sha256,
            "sha256": source_sha256,
            "service": entry.get("service"),
            "destination": entry.get("destination"),
        })
    compose_files = input_manifest.get("compose_files")
    if not isinstance(compose_files, list) or len(compose_files) != len(COMPOSE_SOURCES):
        raise LocalMigrationError("receipt_input_provenance")
    compose_evidence: list[dict[str, str]] = []
    for path, item in zip(COMPOSE_SOURCES, compose_files):
        relative = path.as_posix()
        compose_path = repository_root() / path
        if not isinstance(item, dict) or item.get("path") != relative:
            raise LocalMigrationError("receipt_input_provenance")
        try:
            compose_path = _require_owned_regular_file(compose_path, "receipt_input_provenance")
            digest = _sha256_file(compose_path)[0]
        except LocalMigrationError:
            raise
        except OSError as error:
            raise LocalMigrationError("receipt_input_provenance") from error
        if item.get("sha256") != digest:
            raise LocalMigrationError("receipt_input_provenance")
        compose_evidence.append({"path": relative, "sha256": digest})
    function_sha256 = _function_source_evidence(
        input_manifest.get("functions"), records
    )
    _, prerequisite_manifest = _verify_generated_prerequisite(PREREQUISITE_OUTPUT)
    seed_path = _require_owned_regular_file(
        repository_root() / SEED_SOURCE,
        "receipt_input_provenance",
    )
    seed_bytes = seed_path.read_bytes()
    _reject_source_text(seed_bytes)
    readback_path = _require_owned_regular_file(
        repository_root() / READBACK_SOURCE,
        "receipt_input_provenance",
    )
    try:
        _, _, environment_values = PsqlExecutor(
            docker="docker",
            container="db",
            database="postgres",
        )._binding()
        environment_contract_sha256 = _environment_contract_sha256(environment_values)
    except LocalMigrationError:
        raise
    except (OSError, TypeError, ValueError) as error:
        raise LocalMigrationError("receipt_environment_contract") from error
    return {
        "source_manifest_sha256": manifest_digest(manifest),
        "source_chain_sha256": manifest["source"]["chainSha256"],
        "input_source_manifest_sha256": _sha256_file(manifest_path)[0],
        "input_evidence_sha256": _sha256_bytes(canonical_json(records)),
        "compose_evidence_sha256": _sha256_bytes(canonical_json(compose_evidence)),
        "function_source_sha256": function_sha256,
        "seed_source_sha256": _sha256_file(seed_path)[0],
        "prerequisite_sha256": prerequisite_manifest["output"]["sha256"],
        "readback_sql_sha256": _sha256_file(readback_path)[0],
        "platform_bootstrap_sha256": _platform_bootstrap_sha256(),
        "platform_bootstrap_evidence_sha256": _platform_bootstrap_evidence_sha256(),
        "environment_contract_sha256": environment_contract_sha256,
    }

def _stack_provenance(executor: PsqlExecutor, item: Mapping[str, Any]) -> dict[str, Any]:
    _, state, values = executor._binding()
    receipt_path = state / "last-receipt.json"
    try:
        if (
            receipt_path.is_symlink()
            or not receipt_path.is_file()
            or receipt_path.stat().st_uid != os.getuid()
            or stat.S_IMODE(receipt_path.stat().st_mode) != 0o600
        ):

            raise LocalMigrationError("receipt_provenance_incomplete")
        stack_receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    except LocalMigrationError:
        raise
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise LocalMigrationError("receipt_provenance_incomplete") from error
    required = ("config_sha256", "input_provenance_sha256", "env_provenance_sha256")
    if (
        not isinstance(stack_receipt, dict)
        or stack_receipt.get("schema") != LOCAL_STACK_RECEIPT_SCHEMA
        or stack_receipt.get("project_name") != executor._expected_project()
        or stack_receipt.get("renderer") not in {COMPOSE_VERSION, COMPOSE_VERSION.removeprefix("v")}
        or stack_receipt.get("generator_version") != LOCAL_STACK_GENERATOR_VERSION
        or any(not isinstance(stack_receipt.get(key), str) or not _HEX64.fullmatch(stack_receipt[key]) for key in required)
    ):
        raise LocalMigrationError("receipt_provenance_incomplete")
    env_digest = _sha256_file(state / "stack.env.provenance.json")[0]
    input_digest = _sha256_file(state / "stack.inputs.provenance.json")[0]
    if stack_receipt["env_provenance_sha256"] != env_digest or stack_receipt["input_provenance_sha256"] != input_digest:
        raise LocalMigrationError("receipt_provenance_incomplete")
    input_evidence = _generated_input_evidence(state, executor._expected_project())
    service_digests = executor._service_image_digests()
    image_digests = sorted({digest for digests in service_digests.values() for digest in digests})
    return {
        "schema": "local-stack-provenance-v1",
        "project_name": executor._expected_project(),
        "renderer": stack_receipt["renderer"],
        "generator_version": stack_receipt["generator_version"],
        "config_sha256": stack_receipt["config_sha256"],
        "input_provenance_sha256": stack_receipt["input_provenance_sha256"],
        "env_provenance_sha256": stack_receipt["env_provenance_sha256"],
        "environment_contract_sha256": _environment_contract_sha256(values),
        "image_digests": image_digests,
        "image_service_digests": service_digests,
        **input_evidence,
        "commit_sha256": _repository_commit(),
        "readback_sql_sha256": _sha256_file(
            _require_owned_regular_file(
                repository_root() / READBACK_SOURCE,
                "receipt_provenance_incomplete",
            )
        )[0],
    }


def build_receipt(executor: PsqlExecutor) -> dict[str, Any]:
    if executor.database != "postgres":
        raise LocalMigrationError("receipt_database_not_canonical")
    project_name = _assert_canonical_receipt_container(executor)
    _assert_no_ambiguity(executor)
    container = executor._inspect()
    readback_path = _require_owned_regular_file(
        repository_root() / READBACK_SOURCE,
        "readback_source_invalid",
    )
    provenance = _stack_provenance(executor, container)
    readback_sql = readback_path.read_bytes()
    records = parse_readback(executor.capture(readback_sql))
    ledger_rows = _capture_lines(executor, _LEDGER_RECEIPT_SQL, 7)
    if not ledger_rows:
        raise LocalMigrationError("receipt_ledger_empty")
    manifest = verify_manifest()
    expected_files = manifest["source"]["files"]
    if len(ledger_rows) != EXPECTED_LEDGER_UNITS or len(expected_files) != EXPECTED_LEDGER_UNITS:
        raise LocalMigrationError("receipt_ledger_state")
    ledger_records: list[list[Any]] = []
    for expected, row in zip(expected_files, ledger_rows):
        migration_id, ordinal_text, source_sha256, byte_length_text, transaction_class, status, readback_sha256 = row
        if (
            migration_id != expected["path"]
            or ordinal_text != str(expected["ordinal"])
            or source_sha256 != expected["sha256"]
            or byte_length_text != str(expected["byteLength"])
            or transaction_class != expected["transaction"]["class"]
            or status != "applied"
            or readback_sha256 != _expected_unit_evidence(expected)
        ):
            raise LocalMigrationError("receipt_ledger_state")
        ledger_records.append(["ledger", migration_id, int(ordinal_text), source_sha256, int(byte_length_text), transaction_class, status, readback_sha256])
    prerequisite_path, prerequisite_manifest = _verify_generated_prerequisite(PREREQUISITE_OUTPUT)
    prerequisite_sha256 = prerequisite_manifest["output"]["sha256"]
    seed_path = _require_owned_regular_file(
        repository_root() / SEED_SOURCE,
        "seed_source_invalid",
    )
    seed_sha256 = _sha256_file(seed_path)[0]
    seed_bytes = seed_path.read_bytes()
    _reject_source_text(seed_bytes)
    sequence_records, sequence_sha256, closure_binding_sha256 = _sequence_records(
        executor, manifest, seed_sha256, prerequisite_sha256
    )
    service_rows = _capture_lines(executor, _SERVICE_RECEIPT_SQL, 3)
    if len(service_rows) != 1:
        raise LocalMigrationError("receipt_service_shape")
    service_records = [["service", *service_rows[0]]]
    payload_digests = _receipt_payload_digests(records, ledger_records, service_records, manifest)
    return {
        "source_manifest_sha256": manifest_digest(manifest),
        "source_chain_sha256": manifest["source"]["chainSha256"],
        "input_source_manifest_sha256": provenance["input_source_manifest_sha256"],
        "input_evidence_sha256": provenance["input_evidence_sha256"],
        "compose_evidence_sha256": provenance["compose_evidence_sha256"],
        "function_source_sha256": provenance["function_source_sha256"],
        "seed_source_sha256": seed_sha256,
        "prerequisite_sha256": prerequisite_sha256,
        "platform_bootstrap_sha256": _platform_bootstrap_sha256(),
        "platform_bootstrap_evidence_sha256": _platform_bootstrap_evidence_sha256(),
        "sequence": sequence_records,
        "sequence_sha256": sequence_sha256,
        "closure_binding_sha256": closure_binding_sha256,
        "schema": RECEIPT_SCHEMA,
        "serializer": RECEIPT_SERIALIZER,
        "project_name": project_name,
        "stack_provenance": provenance,
        "config_sha256": provenance["config_sha256"],
        "input_provenance_sha256": provenance["input_provenance_sha256"],
        "env_provenance_sha256": provenance["env_provenance_sha256"],
        "environment_contract_sha256": provenance["environment_contract_sha256"],
        "image_digests": provenance["image_digests"],
        "image_service_digests": provenance["image_service_digests"],
        "commit_sha256": provenance["commit_sha256"],
        "ledger": ledger_records,
        "readback_sql_sha256": provenance["readback_sql_sha256"],
        "readback": records,
        "service": service_records,
        **payload_digests,
    }
def _load_receipt_file(path: Path) -> dict[str, Any]:
    try:
        resolved = _require_owned_regular_file(path, "receipt_file_invalid")
        _reject_path_custody(resolved)
        value = json.loads(resolved.read_text(encoding="utf-8"))
    except LocalMigrationError:
        raise
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise LocalMigrationError("receipt_file_invalid") from error
    if not isinstance(value, dict) or set(value) != RECEIPT_TOP_LEVEL_FIELDS:
        raise LocalMigrationError("receipt_unknown_field")
    if value.get("schema") != RECEIPT_SCHEMA or value.get("serializer") != RECEIPT_SERIALIZER:
        raise LocalMigrationError("receipt_file_schema")
    project = value.get("project_name")
    provenance = value.get("stack_provenance")
    if not isinstance(project, str) or not _LOCAL_PROJECT.fullmatch(project) or not isinstance(provenance, dict):
        raise LocalMigrationError("receipt_provenance_incomplete")
    if set(provenance) != STACK_PROVENANCE_FIELDS:
        raise LocalMigrationError("receipt_unknown_field")
    expected_project = "tzudong-local-" + hashlib.sha256(str(repository_root()).encode("utf-8")).hexdigest()[:12]
    if project != expected_project:
        raise LocalMigrationError("receipt_project_mismatch")
    service_digests = provenance.get("image_service_digests")
    if not isinstance(service_digests, dict):
        raise LocalMigrationError("receipt_provenance_incomplete")
    if set(service_digests) != set(EXPECTED_SERVICES):
        raise LocalMigrationError("receipt_unknown_field")
    if any(
        not isinstance(digests, list)
        or not digests
        or any(
            not isinstance(digest, str)
            or not re.fullmatch(r"sha256:[0-9a-f]{64}", digest)
            for digest in digests
        )
        for digests in service_digests.values()
    ):
        raise LocalMigrationError("receipt_provenance_incomplete")
    flattened_digests = sorted({digest for digests in service_digests.values() for digest in digests})
    if (
        provenance.get("image_digests") != flattened_digests
        or value.get("image_digests") != flattened_digests
        or value.get("image_service_digests") != service_digests
    ):
        raise LocalMigrationError("receipt_provenance_incomplete")
    if (
        provenance.get("schema") != "local-stack-provenance-v1"
        or provenance.get("project_name") != project
        or provenance.get("renderer") not in {COMPOSE_VERSION, COMPOSE_VERSION.removeprefix("v")}
        or provenance.get("generator_version") != LOCAL_STACK_GENERATOR_VERSION
        or not isinstance(provenance.get("image_digests"), list)
        or any(not isinstance(item, str) or not _HEX64.fullmatch(item.removeprefix("sha256:")) for item in provenance["image_digests"])
        or provenance.get("commit_sha256") is not None and not _HEX40.fullmatch(provenance["commit_sha256"])
    ):
        raise LocalMigrationError("receipt_provenance_incomplete")
    for field in (
        "config_sha256",
        "input_provenance_sha256",
        "env_provenance_sha256",
        "environment_contract_sha256",
    ):
        if not isinstance(value.get(field), str) or not _HEX64.fullmatch(value[field]) or provenance.get(field) != value[field]:
            raise LocalMigrationError("receipt_provenance_incomplete")
    provenance_fields = (
        "input_source_manifest_sha256",
        "input_evidence_sha256",
        "compose_evidence_sha256",
        "function_source_sha256",
        "readback_sql_sha256",
    )
    for field in provenance_fields:
        if (
            not isinstance(provenance.get(field), str)
            or not _HEX64.fullmatch(provenance[field])
            or value.get(field) != provenance[field]
        ):
            raise LocalMigrationError("receipt_provenance_incomplete")
    for field in (
        "source_manifest_sha256",
        "source_chain_sha256",
        "seed_source_sha256",
        "prerequisite_sha256",
        "platform_bootstrap_sha256",
        "platform_bootstrap_evidence_sha256",
        "sequence_sha256",
    ):
        if not isinstance(value.get(field), str) or not _HEX64.fullmatch(value[field]):
            raise LocalMigrationError("receipt_provenance_incomplete")
    ledger = value.get("ledger")
    if not isinstance(ledger, list) or not ledger:
        raise LocalMigrationError("receipt_ledger_empty")
    records, ledger_records, service_records = _parse_receipt_payloads(value)
    manifest = verify_manifest()
    if len(ledger_records) != EXPECTED_LEDGER_UNITS:
        raise LocalMigrationError("receipt_ledger_state")
    payload_digests = _receipt_payload_digests(records, ledger_records, service_records, manifest)
    sequence = value.get("sequence")
    if (
        not isinstance(sequence, list)
        or len(sequence) != len(SEQUENCE_MARKERS)
        or any(
            not isinstance(row, list)
            or len(row) != 5
            or row[0] != "sequence"
            or row[1] != SEQUENCE_MARKERS[index]
            or row[2] != index + 1
            or not isinstance(row[3], str)
            or not _HEX64.fullmatch(row[3])
            or not isinstance(row[4], str)
            or not _HEX64.fullmatch(row[4])
            for index, row in enumerate(sequence)
        )
    ):
        raise LocalMigrationError("receipt_sequence_state")
    if _sha256_bytes(_serialize_rows(sequence)) != value["sequence_sha256"]:
        raise LocalMigrationError("receipt_sequence_state")
    closure_definition_hash = sequence[2][3]
    closure_binding_sha256 = value.get("closure_binding_sha256")
    if (
        not isinstance(closure_binding_sha256, str)
        or not _HEX64.fullmatch(closure_binding_sha256)
        or _closure_binding_for_current_source(closure_definition_hash) != closure_binding_sha256
    ):
        raise LocalMigrationError("receipt_closure_binding")
    for field in (
        "readback_sql_sha256",
        "readback_sha256",
        "catalog_sha256",
        "seed_sha256",
        "ledger_sha256",
        "service_sha256",
    ):
        if not isinstance(value.get(field), str) or not _HEX64.fullmatch(value[field]):
            raise LocalMigrationError("receipt_digest_invalid")
    for field, expected in payload_digests.items():
        if value.get(field) != expected:
            raise LocalMigrationError("receipt_digest_mismatch")
    current = _current_source_bindings()
    for field, expected in current.items():
        if value.get(field) != expected:
            raise LocalMigrationError("receipt_manifest_mismatch")
    expected_sequence = [
        ["sequence", marker, ordinal, evidence, current["source_manifest_sha256"]]
        for ordinal, (marker, evidence) in enumerate(
            (
                ("prerequisite", current["prerequisite_sha256"]),
                ("migration", current["source_chain_sha256"]),
                ("closure", value["sequence"][2][3]),
                ("platform-bootstrap", current["platform_bootstrap_evidence_sha256"]),
                ("seed", current["seed_source_sha256"]),
            ),
            1,
        )
    ]
    if value["sequence"] != expected_sequence:
        raise LocalMigrationError("receipt_sequence_state")
    return value


def compare_receipts(first: Path, second: Path) -> dict[str, Any]:
    left = _load_receipt_file(first)
    right = _load_receipt_file(second)
    expected_ledger = _expected_ledger_records(build_manifest())
    for receipt in (left, right):
        if receipt["ledger"] != expected_ledger:
            raise LocalMigrationError("receipt_manifest_mismatch")
    current_bindings = _current_source_bindings()
    for receipt in (left, right):
        expected_sequence = [
            ["sequence", marker, ordinal, evidence, current_bindings["source_manifest_sha256"]]
            for ordinal, (marker, evidence) in enumerate(
                (
                    ("prerequisite", current_bindings["prerequisite_sha256"]),
                    ("migration", current_bindings["source_chain_sha256"]),
                    ("closure", receipt["sequence"][2][3]),
                    ("platform-bootstrap", current_bindings["platform_bootstrap_evidence_sha256"]),
                    ("seed", current_bindings["seed_source_sha256"]),
                ),
                1,
            )
        ]
        if (
            any(receipt.get(field) != expected for field, expected in current_bindings.items())
            or receipt.get("sequence") != expected_sequence
        ):
            raise LocalMigrationError("receipt_manifest_mismatch")
    fields = (
        "source_manifest_sha256",
        "source_chain_sha256",
        "input_source_manifest_sha256",
        "input_evidence_sha256",
        "compose_evidence_sha256",
        "function_source_sha256",
        "seed_source_sha256",
        "platform_bootstrap_sha256",
        "platform_bootstrap_evidence_sha256",
        "prerequisite_sha256",
        "sequence",
        "sequence_sha256",
        "closure_binding_sha256",
        "config_sha256",
        "input_provenance_sha256",
        "environment_contract_sha256",
        "image_digests",
        "image_service_digests",
        "commit_sha256",
        "readback_sql_sha256",
        "readback_sha256",
        "catalog_sha256",
        "seed_sha256",
        "ledger_sha256",
        "service_sha256",
        "readback",
        "service",
    )
    left_provenance = dict(left["stack_provenance"])
    right_provenance = dict(right["stack_provenance"])
    left_provenance.pop("env_provenance_sha256", None)
    right_provenance.pop("env_provenance_sha256", None)
    if (
        left["project_name"] != right["project_name"]
        or left["ledger"] != right["ledger"]
        or left_provenance != right_provenance
        or any(left[field] != right[field] for field in fields)
    ):
        raise LocalMigrationError("receipt_mismatch")
    return {
        "schema": RECEIPT_SCHEMA,
        "serializer": RECEIPT_SERIALIZER,
        "equal": True,
        "project_name": left["project_name"],
        "comparedFields": ["project_name", "ledger", *fields],
        "ledgerUnitCount": len(left["ledger"]),
        "catalogSha256": left["catalog_sha256"],
        "seedSha256": left["seed_sha256"],
        "ledgerSha256": left["ledger_sha256"],
        "serviceSha256": left["service_sha256"],
    }


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="local-migrate.py", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    def add_binding_options(command: argparse.ArgumentParser) -> None:
        command.add_argument("--project", help="exact repository-derived local Compose project")
        command.add_argument("--state-dir", type=Path, help="project-scoped generated local stack state")
        command.add_argument("--env-file", type=Path, help="generated stack.env (must be project-scoped)")
    generate = sub.add_parser("generate-prerequisite", help="generate the source-bound local DDL prerequisite")
    generate.add_argument("--input", type=Path, default=PREREQUISITE_SOURCE)
    generate.add_argument("--output", type=Path, default=PREREQUISITE_OUTPUT)
    generate.add_argument("--manifest-output", type=Path, default=PREREQUISITE_MANIFEST)
    manifest = sub.add_parser("manifest", help="emit the source-bound migration manifest")
    manifest.add_argument("--output", type=Path, help="create a new manifest file instead of stdout")
    verify = sub.add_parser("verify", help="verify source bytes and an optional manifest")
    verify.add_argument("--manifest", type=Path, help="manifest to compare with current source")
    dry = sub.add_parser("dry-run", help="emit a database-free execution plan")
    dry.add_argument("--manifest", type=Path, help="manifest to compare with current source")
    dry.add_argument("--output", type=Path, help="create a new plan file instead of stdout")
    prerequisite = sub.add_parser("verify-prerequisite", help="validate/transform DDL-only local prerequisites")
    prerequisite.add_argument("--input", required=True, type=Path)
    prerequisite.add_argument("--output", type=Path, help="create transformed SQL; omission only verifies")
    apply = sub.add_parser("apply", help="apply source migrations to a disposable local Compose database")
    prerequisite_apply = sub.add_parser("apply-prerequisite", help="apply the generated local DDL prerequisite")
    prerequisite_apply.add_argument("--input", type=Path, default=PREREQUISITE_OUTPUT)
    prerequisite_apply.add_argument("--container", required=True)
    prerequisite_apply.add_argument("--database", default="postgres")
    prerequisite_apply.add_argument("--docker", default="docker")
    prerequisite_apply.add_argument("--allow-local", action="store_true", help="required explicit local-only admission")
    prerequisite_apply.add_argument("--timeout", type=float, default=300.0)
    seed = sub.add_parser("seed", help="apply deterministic local auth/profile/fixture seed")
    seed.add_argument("--input", type=Path, default=SEED_SOURCE)
    seed.add_argument("--container", required=True)
    seed.add_argument("--database", default="postgres")
    seed.add_argument("--docker", default="docker")
    seed.add_argument("--allow-local", action="store_true", help="required explicit local-only admission")
    seed.add_argument("--timeout", type=float, default=300.0)
    apply.add_argument("--container", required=True, help="local Compose database container name")
    apply.add_argument("--database", default="postgres")
    apply.add_argument("--docker", default="docker")
    apply.add_argument("--manifest", type=Path)
    apply.add_argument("--allow-local", action="store_true", help="required explicit local-only admission")
    apply.add_argument("--timeout", type=float, default=300.0)
    receipt = sub.add_parser("receipt", help="emit a sanitized deterministic local receipt-v1")
    receipt.add_argument("--container", required=True, help="canonical local Compose db container name")
    receipt.add_argument("--database", default="postgres")
    receipt.add_argument("--docker", default="docker")
    receipt.add_argument("--allow-local", action="store_true", help="required explicit local-only admission")
    receipt.add_argument("--timeout", type=float, default=300.0)
    receipt.add_argument("--output", type=Path, help="create a new receipt file instead of stdout")
    compare = sub.add_parser("compare-receipts", help="compare two sanitized local receipt-v1 files")
    compare.add_argument("--first", required=True, type=Path)
    compare.add_argument("--second", required=True, type=Path)
    compare.add_argument("--allow-local", action="store_true", help="required explicit local-only admission")
    compare.add_argument("--output", type=Path, help="create a comparison receipt instead of stdout")
    add_binding_options(apply)
    add_binding_options(prerequisite_apply)
    add_binding_options(seed)
    add_binding_options(receipt)
    return parser
def _executor_from_args(args: argparse.Namespace) -> PsqlExecutor:
    return PsqlExecutor(
        args.docker,
        args.container,
        args.database,
        args.timeout,
        args.project,
        args.state_dir,
        args.env_file,
    )


def _emit(value: Any, output: Path | None = None) -> None:
    data = canonical_json(value) + b"\n"
    if output is None:
        sys.stdout.buffer.write(data)
    else:
        _write_new(output, data)


def main(argv: Sequence[str] | None = None) -> int:
    parser = _parser()
    args = parser.parse_args(argv)
    try:
        if args.command == "generate-prerequisite":
            candidate = (repository_root() / args.input) if not args.input.is_absolute() else args.input
            input_path = _require_owned_regular_file(candidate, "prerequisite_source_invalid")
            expected = _require_owned_regular_file(
                repository_root() / PREREQUISITE_SOURCE,
                "prerequisite_source_invalid",
            )
            if input_path != expected:
                raise LocalMigrationError("prerequisite_source_invalid")
            source = input_path.read_bytes()
            output, prerequisite_manifest = build_prerequisite(source)
            _write_new(args.output, output)
            _emit(prerequisite_manifest, args.manifest_output)
            return 0
        if args.command == "manifest":
            manifest = build_manifest()
            _emit(manifest, args.output)
            return 0
        if args.command == "apply-prerequisite":
            if not args.allow_local:
                raise LocalMigrationError("apply_requires_allow_local")
            path, prerequisite_manifest = _verify_generated_prerequisite(args.input)
            data = path.read_bytes()
            output_meta = prerequisite_manifest["output"]
            if len(data) != output_meta["byteLength"] or _sha256_bytes(data) != output_meta["sha256"]:
                raise LocalMigrationError("prerequisite_manifest_mismatch")
            executor = _executor_from_args(args)
            _assert_no_ambiguity(executor)
            try:
                executor.run(b"BEGIN;\n" + data + b"\nCOMMIT;\n")
                manifest = verify_manifest()
                executor.run(
                    _sequence_marker_sql(
                        {
                            "prerequisite": (
                                1,
                                output_meta["sha256"],
                                manifest_digest(manifest),
                            )
                        }
                    )
                )
            except KeyboardInterrupt:
                _record_keyboard_interrupt(executor, "application-prerequisite")
                raise
            except LocalMigrationError as error:
                _record_ambiguity(executor, "application-prerequisite", error.code)
                raise
            print("local prerequisite apply completed: " + _sha256_bytes(data))
            return 0
        if args.command == "seed":
            if not args.allow_local:
                raise LocalMigrationError("seed_requires_allow_local")
            candidate = args.input if args.input.is_absolute() else repository_root() / args.input
            path = _require_owned_regular_file(candidate, "seed_source_invalid")
            expected = _require_owned_regular_file(
                repository_root() / SEED_SOURCE,
                "seed_source_invalid",
            )
            if path != expected:
                raise LocalMigrationError("seed_source_invalid")
            data = path.read_bytes()
            _reject_source_text(data)
            manifest = verify_manifest()
            _, prerequisite_manifest = _verify_generated_prerequisite(PREREQUISITE_OUTPUT)
            prerequisite_sha256 = prerequisite_manifest["output"]["sha256"]
            executor = _executor_from_args(args)
            _assert_no_ambiguity(executor)
            _, _, values = executor._binding()
            password = values.get(NIGHTLY_PASSWORD_ENV, "")
            if (
                not isinstance(password, str)
                or len(password) < 16
                or any(char in password for char in "\x00\r\n")
                or not re.fullmatch(r"[A-Za-z0-9_./:=+@,-]+", password)
            ):
                raise LocalMigrationError("nightly_password_missing")
            try:
                _assert_sequence_prefix(executor, manifest, prerequisite_sha256, 4)
                nightly_user_id = _existing_auth_api_user_id(executor)
                if nightly_user_id is None:
                    nightly_user_id, auth_receipt = _auth_api_create_and_login(values, password)
                    executor.run(_auth_api_ledger_sql(nightly_user_id, auth_receipt))
                else:
                    # A repeat seed must prove the same disposable Auth user can
                    # still log in while preserving the original 2xx creation
                    # receipt; it never fabricates a second create response.
                    _auth_api_login_existing(values, password, nightly_user_id)
                    executor.run(_auth_api_ledger_reseed_sql(nightly_user_id))
                executor.run(
                    data,
                    variables={"nightly_user_id": nightly_user_id.lower()},
                )
                executor.run(_auth_api_ledger_applied_sql())
                _auth_api_ledger_readback(executor, nightly_user_id)
                executor.run(
                    _sequence_marker_sql(
                        {
                            "seed": (
                                5,
                                _sha256_bytes(data),
                                manifest_digest(manifest),
                            )
                        }
                    )
                )
            except KeyboardInterrupt:
                _record_keyboard_interrupt(executor, "local-seed")
                raise
            except LocalMigrationError as error:
                _record_ambiguity(executor, "local-seed", error.code)
                raise
            print("local seed apply completed: " + _sha256_bytes(data))
            return 0
        if args.command == "receipt":
            if not args.allow_local:
                raise LocalMigrationError("receipt_requires_allow_local")
            executor = _executor_from_args(args)
            _emit(build_receipt(executor), args.output)
            return 0
        if args.command == "compare-receipts":
            if not args.allow_local:
                raise LocalMigrationError("compare_receipts_requires_allow_local")
            _emit(compare_receipts(args.first, args.second), args.output)
            return 0
        if args.command == "verify":
            manifest = verify_manifest(args.manifest)
            print("local migration source verified: " + manifest["source"]["chainSha256"])
            return 0
        if args.command == "dry-run":
            manifest = verify_manifest(args.manifest)
            _emit(plan(manifest), args.output)
            return 0
        if args.command == "verify-prerequisite":
            path = _require_owned_regular_file(args.input, "prerequisite_path_invalid")
            _reject_path_custody(path)
            if path.suffix.lower() != ".sql":
                raise LocalMigrationError("prerequisite_path_invalid")
            data = path.read_bytes()
            transformed = transform_ddl_prerequisite(data)
            if args.output is not None:
                _write_new(args.output, transformed)
            print("DDL prerequisite verified: " + _sha256_bytes(transformed))
            return 0
        if args.command == "apply":
            if not args.allow_local:
                raise LocalMigrationError("apply_requires_allow_local")
            manifest = verify_manifest(args.manifest)
            executor = _executor_from_args(args)
            _assert_no_ambiguity(executor)
            prerequisite_path, prerequisite_manifest = _verify_generated_prerequisite(PREREQUISITE_OUTPUT)
            prerequisite_sha256 = prerequisite_manifest["output"]["sha256"]
            try:
                _assert_sequence_prefix(executor, manifest, prerequisite_sha256, 1)
            except KeyboardInterrupt:
                _record_keyboard_interrupt(executor, "migration-prefix")
                raise
            for migration_id, sql in execution_batches(manifest):
                item = next(item for item in manifest["source"]["files"] if item["path"] == migration_id)
                _assert_execution_batch_fresh(item, sql)
                try:
                    executor.run(sql)
                    evidence_sha256 = _unit_readback(executor, item)
                    _mark_applied(executor, migration_id, evidence_sha256)
                    _verify_applied_readback(executor, item, evidence_sha256)
                except KeyboardInterrupt:
                    _record_keyboard_interrupt(executor, migration_id)
                    raise
                except LocalMigrationError as error:
                    # The executor cannot distinguish a failed migration from a
                    # ledger update that was lost after the database accepted it.
                    # Preserve the only safe classification until a fresh reset.
                    ambiguous = True
                    if item["transaction"]["class"] == "self_committing":
                        ambiguous = True
                    status = "ambiguous" if ambiguous else "failed"
                    code = "commit_ambiguous_readback_only" if ambiguous else error.code
                    try:
                        mark_terminal(executor, migration_id, status, code)
                    except LocalMigrationError as ledger_error:
                        _record_ambiguity(executor, migration_id, "ledger_update_ambiguous")
                        raise LocalMigrationError("ledger_update_ambiguous") from ledger_error
                    if ambiguous:
                        _record_ambiguity(executor, migration_id, code)
                    raise
            _apply_sequence_marker(executor, manifest)
            _apply_platform_bootstrap(executor, manifest)
            print("local migration apply completed: " + manifest["source"]["chainSha256"])
            return 0
    except (LocalMigrationError, OSError, ValueError) as error:
        code = error.code if isinstance(error, LocalMigrationError) else "input_invalid"
        print("local-migrate: " + code, file=sys.stderr)
        return 2
    parser.error("unknown command")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
