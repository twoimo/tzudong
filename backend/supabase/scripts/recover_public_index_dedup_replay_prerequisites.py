#!/usr/bin/env python3
"""Normalize three source-bound indexes in disposable canonical PG15 replay.

The historical reconstruction retains two older index definitions and lacks
one keeper. Extract only the pinned intended CREATE statements. The immutable
production migration, its PG15 adapter, and both sources remain unchanged.
This module generates SQL and a provenance receipt; it never connects to a DB.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re


SOURCE_PATH = "backend/supabase/baselines/local/application-prerequisites.sql"
SOURCE_SHA256 = "c4fce4f7ddaf6315474cb3a3d408eef1fb7ff538af7f39183ebdc46828630356"
SOURCE_BYTE_LENGTH = 210_720
ROLES_SOURCE_PATH = "backend/supabase/migrations/20260514_00_admin_user_management_hardening.sql"
ROLES_SOURCE_SHA256 = "da60b7b3fdcd623213d204d076a26dba41d4d1d60486afe62d7a84e077e1445b"
ROLES_SOURCE_BYTE_LENGTH = 7_436

INDEX_NAME = "idx_transcript_embeddings_bge_video_id"
INDEX_STATEMENT_SHA256 = "cb2c3de6ec909e758c0a791404c406cad4f622123f180be4b29ddc46beb29ed2"
INDEX_STATEMENT_BYTE_LENGTH = 112
BGE_CANDIDATE_NAME = "idx_bge_embeddings_video_id"
BGE_CANDIDATE_STATEMENT_SHA256 = "1e453eb79d481a0168eb121f3b30ea3ede2eff78883f8bd141d1ac9b8c169982"
BGE_CANDIDATE_STATEMENT_BYTE_LENGTH = 101
ROLES_INDEX_NAME = "user_roles_user_id_role_idx"
ROLES_STATEMENT_SHA256 = "df27f06ccf5ab2202bb31856160fcda5ed8ccc282325dbc1de41d35708856a16"
ROLES_STATEMENT_BYTE_LENGTH = 102

PROTECTED_LIST_BODY_SHA256 = "20acd5742d891cf8a33b265a3a1298c65dd9646402c58391cd17829951cf92f2"
PROTECTED_LIST_BODY_BYTE_LENGTH = 3_673
PROTECTED_LIST_RELATION_COUNT = 61
PROTECTED_LIST_SOURCE_PATH = "backend/supabase/migrations/20260713002500_g014_catalog_contract.sql"
PROTECTED_LIST_SOURCE_SHA256 = "808532b79fdc20d1c12a71c7988954188c7fe1d91bbfe4b7d47d9da458615838"
PROTECTED_LIST_EXTENSION_PATH = "backend/supabase/migrations/20261008201635_review_media_catalog_integration.sql"
PROTECTED_LIST_EXTENSION_SHA256 = "6e820eb535bc514e78f258110e36dff00537bcaefcffd8b354356107ca9c09fe"
APPEND_ONLY_SOURCE_PATH = "backend/supabase/migrations/20260713002300_g014_account_deletion_state_machine.sql"
APPEND_ONLY_BODY_SHA256 = "3feee3cf653348cbe020b9301870a06baa509fffb1e8b0040dd919b02a262117"

PREFIX = b"""BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '15s';
SET LOCAL search_path = pg_catalog;
DO $public_index_dedup_replay_prerequisite$
DECLARE
  target record;
  metadata record;
  table_name text;
  table_oid oid;
  index_oid oid;
  column_numbers smallint[];
  operator_classes oid[];
  collations oid[];
  expected jsonb;
  observed jsonb;
  drift_fields text[];
  protected_body text;
  manifest_oid oid;
BEGIN
  IF current_database() <> 'postgres'
     OR current_user <> 'postgres' OR session_user <> 'postgres'
     OR current_setting('server_version_num')::integer / 10000 <> 15
     OR current_setting('transaction_read_only') <> 'off'
     OR to_regnamespace('supabase_migrations') IS NOT NULL THEN
    RAISE EXCEPTION 'PUBLIC_INDEX_DEDUP_REPLAY_PREREQUISITE_EXECUTOR_DENIED';
  END IF;

  -- Lock the complete, fixed object set before inspecting or changing indexes.
  IF to_regclass('public.document_embeddings_bge') IS NULL
     OR to_regclass('public.transcript_embeddings_bge') IS NULL
     OR to_regclass('public.user_roles') IS NULL THEN
    RAISE EXCEPTION 'PUBLIC_INDEX_DEDUP_REPLAY_PREREQUISITE_TABLE_MISSING';
  END IF;
  LOCK TABLE public.document_embeddings_bge, public.transcript_embeddings_bge,
    public.user_roles IN ACCESS EXCLUSIVE MODE;
  FOREACH table_name IN ARRAY ARRAY[
    'document_embeddings_bge', 'transcript_embeddings_bge', 'user_roles'
  ] LOOP
    table_oid := to_regclass(format('public.%I', table_name));
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.oid = table_oid AND n.nspname = 'public' AND c.relname = table_name
        AND c.relkind = 'r' AND c.relpersistence = 'p' AND NOT c.relispartition
    ) OR EXISTS (
      SELECT 1 FROM pg_inherits WHERE inhrelid = table_oid OR inhparent = table_oid
    ) THEN
      RAISE EXCEPTION 'PUBLIC_INDEX_DEDUP_REPLAY_PREREQUISITE_TABLE_DRIFT'
        USING DETAIL = 'table=public.' || table_name || ';fields=relation_shape';
    END IF;
  END LOOP;
  IF to_regclass('public.idx_transcript_embeddings_bge_video_id') IS NOT NULL THEN
    RAISE EXCEPTION 'PUBLIC_INDEX_DEDUP_REPLAY_KEEPER_ALREADY_PRESENT';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute a JOIN pg_collation c ON c.oid = a.attcollation
    JOIN pg_namespace n ON n.oid = c.collnamespace
    WHERE a.attrelid = 'public.transcript_embeddings_bge'::regclass
      AND a.attname = 'video_id' AND a.attnum > 0 AND NOT a.attisdropped
      AND a.atttypid = 'text'::regtype AND a.atttypmod = -1
      AND n.nspname = 'pg_catalog' AND c.collname = 'default'
  ) THEN
    RAISE EXCEPTION 'PUBLIC_INDEX_DEDUP_REPLAY_TARGET_COLUMN_DRIFT'
      USING DETAIL = 'index=public.idx_transcript_embeddings_bge_video_id;fields=video_id_type,collation';
  END IF;

  -- Inspect only public system catalogs. Never execute private G014 functions
  -- or read FORCE RLS manifest rows. The exact body is a static VALUES list,
  -- pinned by the same source fingerprint as local_catalog_readback.sql.
  SELECT p.prosrc INTO protected_body
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
    WHERE n.nspname = 'privacy_retention' AND p.proname = 'g014_catalog_protected_relations'
      AND p.pronargs = 0 AND p.pronargdefaults = 0 AND p.provariadic = 0
      AND p.prokind = 'f' AND p.proretset AND p.provolatile = 's' AND p.prosecdef
      AND NOT p.proisstrict AND p.proparallel = 'u' AND p.prosqlbody IS NULL
      AND p.proconfig = ARRAY['search_path=""']::text[]
      AND pg_get_userbyid(p.proowner) = 'privacy_workflow_owner' AND l.lanname = 'sql'
      AND pg_get_function_result(p.oid) = 'TABLE(schema_name name, relation_name name)'
      AND p.proargmodes = ARRAY['t','t']::"char"[]
      AND p.proargnames = ARRAY['schema_name','relation_name']::text[]
      AND p.proallargtypes = ARRAY['name'::regtype::oid,'name'::regtype::oid]
      AND octet_length(convert_to(p.prosrc, 'UTF8')) = 3673
      AND encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex')
        = '20acd5742d891cf8a33b265a3a1298c65dd9646402c58391cd17829951cf92f2';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PUBLIC_INDEX_DEDUP_REPLAY_PROTECTION_SOURCE_DRIFT';
  END IF;
  IF (SELECT count(*) FROM regexp_matches(protected_body,
      $g014_relation$\\('([^']+)', '([^']+)'\\)$g014_relation$, 'g')) <> 61
     OR EXISTS (
       SELECT 1 FROM regexp_matches(protected_body,
         $g014_relation$\\('([^']+)', '([^']+)'\\)$g014_relation$, 'g') AS m(parts)
       WHERE (m.parts)[1] = 'public' AND (m.parts)[2] = ANY(ARRAY[
         'document_embeddings_bge', 'transcript_embeddings_bge', 'user_roles'
       ])
  ) THEN
    RAISE EXCEPTION 'PUBLIC_INDEX_DEDUP_REPLAY_PROTECTED_OBJECT';
  END IF;
  SELECT c.oid INTO manifest_oid
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'privacy_retention' AND c.relname = 'g014_catalog_contract_manifest'
      AND c.relkind = 'r' AND c.relpersistence = 'p' AND NOT c.relispartition
      AND pg_get_userbyid(c.relowner) = 'privacy_workflow_owner'
      AND c.relrowsecurity AND c.relforcerowsecurity;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PUBLIC_INDEX_DEDUP_REPLAY_MANIFEST_METADATA_DRIFT';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = manifest_oid AND NOT tgisinternal) <> 1
     OR NOT EXISTS (
       SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
       JOIN pg_namespace n ON n.oid = p.pronamespace
       JOIN pg_language l ON l.oid = p.prolang
       WHERE t.tgrelid = manifest_oid AND t.tgname = 'g014_catalog_manifest_immutable'
         AND NOT t.tgisinternal AND t.tgenabled = 'O' AND t.tgtype = 27
         AND t.tgnargs = 0 AND t.tgqual IS NULL AND t.tgattr::text = ''
         AND t.tgconstraint = 0 AND NOT t.tgdeferrable AND NOT t.tginitdeferred
         AND n.nspname = 'privacy_retention' AND p.proname = 'g014_account_deletion_append_only'
         AND p.pronargs = 0 AND p.prorettype = 'trigger'::regtype AND p.prokind = 'f'
         AND pg_get_userbyid(p.proowner) = 'privacy_workflow_owner' AND l.lanname = 'plpgsql'
         AND p.proconfig = ARRAY['search_path=""']::text[]
         AND encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex')
           = '3feee3cf653348cbe020b9301870a06baa509fffb1e8b0040dd919b02a262117'
  ) THEN
    RAISE EXCEPTION 'PUBLIC_INDEX_DEDUP_REPLAY_MANIFEST_TRIGGER_DRIFT';
  END IF;

  -- Validate both legacy indexes completely before the first DROP. Their
  -- current reconstruction definitions are deliberately not the desired ones.
  FOR target IN
    SELECT * FROM (VALUES
      ('document_embeddings_bge', 'idx_bge_embeddings_video_id',
       ARRAY['video_id'], ARRAY['text_ops'], ARRAY['default']),
      ('user_roles', 'user_roles_user_id_role_idx',
       ARRAY['user_id', 'role'], ARRAY['uuid_ops', 'enum_ops'], ARRAY['none', 'none'])
    ) AS plan(table_name, index_name, columns, opclasses, collation_names)
  LOOP
    table_oid := to_regclass(format('public.%I', target.table_name));
    index_oid := to_regclass(format('public.%I', target.index_name));
    IF index_oid IS NULL THEN
      RAISE EXCEPTION 'PUBLIC_INDEX_DEDUP_REPLAY_LEGACY_INDEX_MISSING'
        USING DETAIL = 'index=public.' || target.index_name;
    END IF;
    SELECT array_agg(a.attnum ORDER BY k.position) INTO column_numbers
      FROM unnest(target.columns) WITH ORDINALITY AS k(column_name, position)
      JOIN pg_attribute a ON a.attrelid = table_oid AND a.attname = k.column_name
        AND a.attnum > 0 AND NOT a.attisdropped;
    SELECT array_agg(o.oid ORDER BY k.position) INTO operator_classes
      FROM unnest(target.opclasses) WITH ORDINALITY AS k(opclass_name, position)
      JOIN pg_opclass o ON o.opcname = k.opclass_name
      JOIN pg_namespace n ON n.oid = o.opcnamespace AND n.nspname = 'pg_catalog'
      JOIN pg_am am ON am.oid = o.opcmethod AND am.amname = 'btree';
    SELECT array_agg(CASE WHEN k.collation_name = 'none' THEN 0::oid ELSE c.oid END ORDER BY k.position)
      INTO collations
      FROM unnest(target.collation_names) WITH ORDINALITY AS k(collation_name, position)
      LEFT JOIN pg_collation c ON c.collname = k.collation_name
        AND c.collnamespace = 'pg_catalog'::regnamespace;
    IF cardinality(column_numbers) IS DISTINCT FROM cardinality(target.columns)
       OR cardinality(operator_classes) IS DISTINCT FROM cardinality(target.columns)
       OR cardinality(collations) IS DISTINCT FROM cardinality(target.columns)
       OR array_position(collations, NULL::oid) IS NOT NULL THEN
      RAISE EXCEPTION 'PUBLIC_INDEX_DEDUP_REPLAY_LEGACY_INDEX_DRIFT'
        USING DETAIL = 'index=public.' || target.index_name || ';fields=columns';
    END IF;

    SELECT i.*, c.relname AS index_name, c.relkind AS index_kind,
           c.relpersistence AS index_persistence, c.relispartition AS index_partition,
           c.relowner AS index_owner, c.reloptions AS index_options,
           n.nspname AS index_schema, am.amname AS access_method, t.relowner AS table_owner
      INTO metadata
      FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_am am ON am.oid = c.relam
      JOIN pg_class t ON t.oid = i.indrelid
      WHERE i.indexrelid = index_oid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'PUBLIC_INDEX_DEDUP_REPLAY_LEGACY_INDEX_DRIFT'
        USING DETAIL = 'index=public.' || target.index_name || ';fields=pg_index';
    END IF;
    observed := to_jsonb(metadata) || jsonb_build_object(
      'indkey', metadata.indkey::text, 'indclass', metadata.indclass::text,
      'indcollation', metadata.indcollation::text, 'indoption', metadata.indoption::text
    );
    expected := jsonb_build_object(
      'indrelid', table_oid, 'index_name', target.index_name, 'index_schema', 'public',
      'index_kind', 'i', 'index_persistence', 'p', 'index_partition', false,
      'access_method', 'btree', 'index_owner', metadata.table_owner, 'index_options', NULL,
      'indnatts', cardinality(target.columns), 'indnkeyatts', cardinality(target.columns),
      'indkey', array_to_string(column_numbers, ' '),
      'indclass', array_to_string(operator_classes, ' '),
      'indcollation', array_to_string(collations, ' '),
      'indoption', array_to_string(array_fill(0::smallint, ARRAY[cardinality(target.columns)]), ' '),
      'indexprs', NULL, 'indpred', NULL, 'indisunique', false,
      'indnullsnotdistinct', false, 'indisprimary', false, 'indisexclusion', false,
      'indisclustered', false, 'indisreplident', false,
      'indisvalid', true, 'indisready', true, 'indislive', true, 'indimmediate', true
    );
    SELECT array_agg(e.key ORDER BY e.key) INTO drift_fields
      FROM jsonb_each(expected) e WHERE observed->e.key IS DISTINCT FROM e.value;
    IF drift_fields IS NOT NULL THEN
      RAISE EXCEPTION 'PUBLIC_INDEX_DEDUP_REPLAY_LEGACY_INDEX_DRIFT'
        USING DETAIL = 'index=public.' || target.index_name
          || ';fields=' || array_to_string(drift_fields, ',');
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conindid = index_oid)
       OR EXISTS (SELECT 1 FROM pg_inherits WHERE inhrelid = index_oid OR inhparent = index_oid)
       OR EXISTS (SELECT 1 FROM pg_depend
         WHERE refclassid = 'pg_class'::regclass AND refobjid = index_oid)
       OR EXISTS (SELECT 1 FROM pg_depend d
         WHERE d.classid = 'pg_class'::regclass AND d.objid = index_oid
           AND NOT (d.deptype = 'a' AND d.objsubid = 0
             AND d.refclassid = 'pg_class'::regclass AND d.refobjid = table_oid
             AND d.refobjsubid = ANY(column_numbers)))
       OR (SELECT count(*) FROM pg_depend d
         WHERE d.classid = 'pg_class'::regclass AND d.objid = index_oid)
         <> cardinality(target.columns) THEN
      RAISE EXCEPTION 'PUBLIC_INDEX_DEDUP_REPLAY_DEPENDENCY_DENIED'
        USING DETAIL = 'index=public.' || target.index_name || ';fields=dependency';
    END IF;
    RAISE NOTICE 'PUBLIC_INDEX_DEDUP_REPLAY_PREFLIGHT index=public.% fields=validated', target.index_name;
  END LOOP;
END;
$public_index_dedup_replay_prerequisite$;
"""

BGE_DROP = b"DROP INDEX public.idx_bge_embeddings_video_id RESTRICT;\n"
ROLES_DROP = b"DROP INDEX public.user_roles_user_id_role_idx RESTRICT;\n"


def _statement(source: bytes, pattern: bytes, length: int, digest: str) -> bytes:
    matches = re.findall(pattern, source, re.MULTILINE)
    if len(matches) != 1 or len(matches[0]) != length or hashlib.sha256(matches[0]).hexdigest() != digest:
        raise ValueError("PUBLIC_INDEX_DEDUP_REPLAY_PREREQUISITE_DEFINITION_DRIFT")
    return matches[0]


def recover(source: bytes, roles_source: bytes) -> tuple[bytes, dict]:
    if len(source) != SOURCE_BYTE_LENGTH or hashlib.sha256(source).hexdigest() != SOURCE_SHA256:
        raise ValueError("PUBLIC_INDEX_DEDUP_REPLAY_PREREQUISITE_SOURCE_DRIFT")
    if len(roles_source) != ROLES_SOURCE_BYTE_LENGTH or hashlib.sha256(roles_source).hexdigest() != ROLES_SOURCE_SHA256:
        raise ValueError("PUBLIC_INDEX_DEDUP_REPLAY_PREREQUISITE_ROLES_SOURCE_DRIFT")
    candidate = _statement(
        source, rb"^CREATE INDEX idx_bge_embeddings_video_id [^\n]*;\n",
        BGE_CANDIDATE_STATEMENT_BYTE_LENGTH, BGE_CANDIDATE_STATEMENT_SHA256,
    )
    keeper = _statement(
        source, rb"^CREATE INDEX idx_transcript_embeddings_bge_video_id [^\n]*;\n",
        INDEX_STATEMENT_BYTE_LENGTH, INDEX_STATEMENT_SHA256,
    )
    roles = _statement(
        roles_source, rb"^CREATE UNIQUE INDEX IF NOT EXISTS user_roles_user_id_role_idx\n[^\n]*;\n",
        ROLES_STATEMENT_BYTE_LENGTH, ROLES_STATEMENT_SHA256,
    )
    actions = (
        ("drop-index-restrict", BGE_CANDIDATE_NAME, BGE_DROP, None),
        ("drop-index-restrict", ROLES_INDEX_NAME, ROLES_DROP, None),
        ("create-source-index", BGE_CANDIDATE_NAME, candidate, SOURCE_PATH),
        ("create-source-index", ROLES_INDEX_NAME, roles, ROLES_SOURCE_PATH),
        ("create-source-index", INDEX_NAME, keeper, SOURCE_PATH),
    )
    sql = PREFIX + b"".join(action[2] for action in actions) + b"COMMIT;\n"
    return sql, {
        "schemaVersion": 2,
        "scope": "source-only canonical PG15 index normalization generation; not execution or hosted-state evidence",
        "sources": [
            {"path": SOURCE_PATH, "sha256": SOURCE_SHA256, "byteLength": SOURCE_BYTE_LENGTH},
            {"path": ROLES_SOURCE_PATH, "sha256": ROLES_SOURCE_SHA256, "byteLength": ROLES_SOURCE_BYTE_LENGTH},
        ],
        "outputSha256": hashlib.sha256(sql).hexdigest(),
        "protection": {
            "verification": "pg_catalog source identity and metadata only; manifest rows are not read",
            "protectedListBodySha256": PROTECTED_LIST_BODY_SHA256,
            "protectedListBodyBytes": PROTECTED_LIST_BODY_BYTE_LENGTH,
            "protectedRelationCount": PROTECTED_LIST_RELATION_COUNT,
            "sourceCitations": [
                {"path": PROTECTED_LIST_SOURCE_PATH, "sha256": PROTECTED_LIST_SOURCE_SHA256},
                {"path": PROTECTED_LIST_EXTENSION_PATH, "sha256": PROTECTED_LIST_EXTENSION_SHA256},
            ],
            "appendOnlyFunctionSourcePath": APPEND_ONLY_SOURCE_PATH,
            "appendOnlyFunctionBodySha256": APPEND_ONLY_BODY_SHA256,
        },
        "indexes": [{
            "name": "public." + name,
            "definitionSourcePath": path,
            "definitionSha256": hashlib.sha256(statement).hexdigest(),
            "definitionBytes": len(statement),
        } for name, statement, path in (
            (BGE_CANDIDATE_NAME, candidate, SOURCE_PATH),
            (ROLES_INDEX_NAME, roles, ROLES_SOURCE_PATH),
            (INDEX_NAME, keeper, SOURCE_PATH),
        )],
        "actions": [{
            "kind": kind, "index": "public." + name, "sourcePath": path,
            "sqlSha256": hashlib.sha256(statement).hexdigest(), "sqlBytes": len(statement),
        } for kind, name, statement, path in actions],
        "dataRowsCopied": 0,
        "canonicalMigrationsChanged": False,
        "publicExecutionGranted": False,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--roles-source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--receipt", type=Path, required=True)
    args = parser.parse_args()
    sql, receipt = recover(args.source.read_bytes(), args.roles_source.read_bytes())
    with args.output.open("xb") as destination:
        destination.write(sql)
    with args.receipt.open("x", encoding="utf-8") as destination:
        destination.write(json.dumps(receipt, sort_keys=True, indent=2) + "\n")


if __name__ == "__main__":
    main()
