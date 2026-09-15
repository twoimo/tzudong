#!/usr/bin/env python3
"""Apply the catalog identity correction to an existing local working database.

The frozen replay ledger and its receipts remain immutable. This explicit working
extension has its own append-only receipt; it does not certify a nightly replay,
hosted migration, or release. PsqlExecutor binds execution to this checkout's DB.
"""
import argparse
import json
from pathlib import Path

import local_catalog_workspace as catalog

MIGRATION = 'backend/supabase/migrations/20260908000100_separate_ingestion_candidate_identity.sql'
LEDGER = "SELECT COALESCE(jsonb_agg(jsonb_build_array(migration_id,source_sha256,source_byte_length,ordinal,status) ORDER BY ordinal),'[]'::jsonb) FROM _tzudong_local.migration_ledger"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply-preview-sha256')
    args = parser.parse_args()
    ex, module = catalog.executor()
    manifest = module.build_manifest()
    files = manifest['source']['files']
    if len(files) != 97 or files[-1]['path'] != MIGRATION:
        raise catalog.CatalogError('working_schema_source_mismatch')
    migration = files[-1]
    sql = module._verified_migration_bytes(migration).decode()
    ledger = json.loads(ex.capture(('BEGIN READ ONLY; '+LEDGER+'; COMMIT;').encode()))
    expected = [[f['path'], f['sha256'], f['byteLength'], f['ordinal']] for f in files[:-1]]
    if [r[:4] for r in ledger] != expected or any(r[4] not in {'applied', 'verified-existing', 'legacy-contract-preserved'} for r in ledger):
        raise catalog.CatalogError('working_schema_base_ledger_mismatch')
    preview = {'schema': 'local-working-schema-v1', 'project': ex._expected_project(),
               'base_ledger_sha256': catalog.sha(ledger), 'migration': migration}
    digest = catalog.sha(preview)
    if not args.apply_preview_sha256:
        print(json.dumps({'preview_sha256': digest, 'migration': MIGRATION, 'base_migrations': 96}))
        return
    if args.apply_preview_sha256 != digest:
        raise catalog.CatalogError('working_schema_preview_mismatch')
    if sql.count('BEGIN;') != 1 or sql.count('COMMIT;') != 1 or not sql.endswith('COMMIT;\n'):
        raise catalog.CatalogError('working_schema_transaction_invalid')
    # No provider input and no general SQL executor: exactly one source-pinned
    # correction, an unchanged base ledger, and one atomic extension receipt.
    q = catalog.quote
    before = catalog.local_state(ex)['rows']
    prefix = f"""BEGIN;
      SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
      SELECT pg_advisory_xact_lock(82917623051);
      LOCK TABLE _tzudong_local.migration_ledger IN SHARE MODE;
      DO $guard$ BEGIN
        IF ({LEDGER}) <> {q(catalog.canonical(ledger).decode())}::jsonb THEN
          RAISE EXCEPTION 'working_schema_base_changed';
        END IF;
      END $guard$;
      CREATE TABLE IF NOT EXISTS _tzudong_local.working_schema_extensions (
        migration_id text PRIMARY KEY, source_sha256 text NOT NULL,
        preview_sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
      );
      REVOKE ALL ON _tzudong_local.working_schema_extensions FROM PUBLIC, anon, authenticated;
    """
    already = ex.capture(b"SELECT to_regclass('_tzudong_local.working_schema_extensions') IS NOT NULL;").strip() == b't'
    if already:
        saved = ex.capture(("SELECT source_sha256||':'||preview_sha256 FROM _tzudong_local.working_schema_extensions WHERE migration_id="+q(MIGRATION)+';').encode()).decode().strip()
        if saved:
            if saved != migration['sha256']+':'+digest:
                raise catalog.CatalogError('working_schema_receipt_mismatch')
            verify(ex)
            print(json.dumps({'result': 'already_present', 'preview_sha256': digest}))
            return
    body = sql.replace('BEGIN;', '', 1).removesuffix('COMMIT;\n')
    suffix = f"INSERT INTO _tzudong_local.working_schema_extensions(migration_id,source_sha256,preview_sha256) VALUES ({q(MIGRATION)},{q(migration['sha256'])},{q(digest)}); COMMIT;"
    ex.run((prefix+body+suffix).encode())
    verify(ex)
    if catalog.canonical(catalog.local_state(ex)['rows']) != catalog.canonical(before):
        raise catalog.CatalogError('working_schema_catalog_readback_mismatch')
    print(json.dumps({'result': 'applied_and_read_back', 'preview_sha256': digest,
                      'base_ledger_preserved': True, 'restaurant_projection_preserved': True}))


def verify(ex):
    passed = ex.capture(b"""SELECT
      to_regclass('public.idx_restaurants_active_candidate_identity') IS NULL
      AND to_regclass('public.idx_restaurants_active_video_identity') IS NOT NULL
      AND EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND
        indexname='idx_restaurants_active_ingestion_candidate' AND
        indexdef LIKE '%UNIQUE%extract_youtube_video_id(youtube_link)%is_ingestion_candidate%');
    """).strip()
    if passed != b't':
        raise catalog.CatalogError('working_schema_index_readback_mismatch')


def verify_working_snapshot(module, rows):
    """Read-only dev admission for the frozen base plus this exact extension."""
    manifest = module.verify_manifest()
    files = manifest['source']['files']
    if len(files) != 97 or files[-1]['path'] != MIGRATION:
        raise catalog.CatalogError('working_schema_source_mismatch')
    expected = [module._expected_snapshot_row(item) for item in files[:-1]]
    if module.canonical_json(rows) != module.canonical_json(expected):
        raise catalog.CatalogError('working_schema_base_ledger_mismatch')
    module._validate_replay_proofs(manifest, {r['path']: r['replayProof'] for r in rows if r['replayProof'] is not None})
    ex, _ = catalog.executor()
    ledger = json.loads(ex.capture((LEDGER+';').encode()))
    preview = {'schema': 'local-working-schema-v1', 'project': ex._expected_project(),
               'base_ledger_sha256': catalog.sha(ledger), 'migration': files[-1]}
    saved = ex.capture(("SELECT source_sha256||':'||preview_sha256 FROM _tzudong_local.working_schema_extensions WHERE migration_id="+catalog.quote(MIGRATION)+';').encode()).decode().strip()
    if saved != files[-1]['sha256']+':'+catalog.sha(preview):
        raise catalog.CatalogError('working_schema_receipt_mismatch')
    verify(ex)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        code = str(error) if isinstance(error, catalog.CatalogError) else 'working_schema_operation_failed'
        print(json.dumps({'error': code}))
        raise SystemExit(1)
