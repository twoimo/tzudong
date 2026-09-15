#!/usr/bin/env python3
"""Install the pinned local-only catalog editor without changing the replay ledger."""
import argparse
import hashlib
import json
from pathlib import Path

import local_catalog_workspace as catalog
from local_working_schema import verify_working_snapshot

FEATURE = 'restaurant-catalog-edit-v1'
SOURCES = {
    'restaurant_catalog_edit_core.sql': 'ef6dde352ff2a26810a4cdda7d1c670bfe8814477e4fb508059518a64d5ad5aa',
    'restaurant_catalog_edit_api.sql': '151bc692d42d1ad7bd9b87ec3e4934c4319ba7e7d84c51accabd86ac8a32568b',
}
LEDGER_SQL = """SELECT COALESCE(jsonb_agg(jsonb_build_object('path',migration_id,'ordinal',ordinal,
 'sha256',source_sha256,'byteLength',source_byte_length,'transactionClass',transaction_class,
 'status',status,'readbackSha256',readback_sha256,'replayProof',replay_proof) ORDER BY ordinal),'[]'::jsonb)
 FROM _tzudong_local.migration_ledger"""
SNAPSHOT_SQL = """SELECT jsonb_build_object(
 'functions',(SELECT jsonb_agg(jsonb_build_array(n.nspname,p.proname,p.proargtypes::text,
   pg_get_userbyid(p.proowner),p.proacl::text,pg_get_functiondef(p.oid)) ORDER BY n.nspname,p.proname,p.proargtypes::text)
   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='admin_catalog_edit' OR (n.nspname='public' AND p.proname IN
   ('prepare_local_restaurant_catalog_edit','apply_local_restaurant_catalog_edit','readback_local_restaurant_catalog_edit'))),
 'schema',(SELECT jsonb_build_array(pg_get_userbyid(nspowner),nspacl::text) FROM pg_namespace WHERE nspname='admin_catalog_edit'),
 'relations',(SELECT jsonb_agg(jsonb_build_array(c.oid::regclass::text,pg_get_userbyid(c.relowner),c.relacl::text,c.relrowsecurity,c.relforcerowsecurity)
   ORDER BY c.oid::regclass::text) FROM pg_class c WHERE c.oid IN
   (to_regclass('admin_catalog_edit.audit_events'),to_regclass('_tzudong_local.working_feature_receipts'))),
 'columns',(SELECT jsonb_agg(jsonb_build_array(a.attrelid::regclass::text,a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attacl::text)
   ORDER BY a.attrelid::regclass::text,a.attnum) FROM pg_attribute a WHERE a.attnum>0 AND NOT a.attisdropped AND a.attrelid IN
   ('public.restaurants'::regclass,to_regclass('admin_catalog_edit.audit_events'),to_regclass('_tzudong_local.working_feature_receipts'))),
 'constraints',(SELECT jsonb_agg(jsonb_build_array(conrelid::regclass::text,conname,pg_get_constraintdef(oid)) ORDER BY conrelid::regclass::text,conname)
   FROM pg_constraint WHERE conrelid IN (to_regclass('admin_catalog_edit.audit_events'),to_regclass('_tzudong_local.working_feature_receipts'))),
 'triggers',(SELECT jsonb_agg(pg_get_triggerdef(oid) ORDER BY tgrelid::regclass::text,tgname) FROM pg_trigger
   WHERE NOT tgisinternal AND tgrelid IN (to_regclass('admin_catalog_edit.audit_events'),to_regclass('_tzudong_local.working_feature_receipts'))),
 'policies',(SELECT jsonb_agg(jsonb_build_array(polrelid::regclass::text,polname,polcmd,polroles::text,
   pg_get_expr(polqual,polrelid),pg_get_expr(polwithcheck,polrelid)) ORDER BY polrelid::regclass::text,polname)
   FROM pg_policy WHERE polrelid=to_regclass('admin_catalog_edit.audit_events') OR
   (polrelid='public.restaurants'::regclass AND polname='g014_local_catalog_edit_update')),
 'allowlist',(SELECT jsonb_agg(to_jsonb(a) ORDER BY source_signature,grantee) FROM privacy_retention.g014_public_rpc_allowlist a
   WHERE function_name IN ('prepare_local_restaurant_catalog_edit','apply_local_restaurant_catalog_edit','readback_local_restaurant_catalog_edit'))
)"""


def source_bodies():
    result = []
    for name, expected in SOURCES.items():
        path = Path(__file__).resolve().parents[1] / 'candidates' / name
        if path.is_symlink():
            raise catalog.CatalogError('catalog_edit_source_mismatch')
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != expected:
            raise catalog.CatalogError('catalog_edit_source_mismatch')
        text = data.decode()
        if text.count('BEGIN;') != 1 or not text.endswith('COMMIT;\n'):
            raise catalog.CatalogError('catalog_edit_transaction_invalid')
        result.append(text.replace('BEGIN;', '', 1).removesuffix('COMMIT;\n'))
    return result


def presence(ex):
    return json.loads(ex.capture(b"""SELECT jsonb_build_object(
      'schema',to_regnamespace('admin_catalog_edit') IS NOT NULL,
      'receipts',to_regclass('_tzudong_local.working_feature_receipts') IS NOT NULL,
      'public_api',EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN
        ('prepare_local_restaurant_catalog_edit','apply_local_restaurant_catalog_edit','readback_local_restaurant_catalog_edit')));"""))


def verify_if_installed(ex=None):
    ex = ex or catalog.executor()[0]
    state = presence(ex)
    if not any(state.values()):
        return {'installed': False}
    if not all(state.values()):
        raise catalog.CatalogError('catalog_edit_partial_installation')
    source_bodies()
    receipt = json.loads(ex.capture(("SELECT COALESCE((SELECT to_jsonb(r) FROM _tzudong_local.working_feature_receipts r WHERE feature_id=" + catalog.quote(FEATURE) + "),'null'::jsonb);").encode()))
    if not isinstance(receipt, dict) or receipt.get('sources') != SOURCES or receipt.get('project') != ex._expected_project():
        raise catalog.CatalogError('catalog_edit_receipt_mismatch')
    observed = json.loads(ex.capture(("BEGIN READ ONLY; SELECT jsonb_build_object('snapshot',value,'sha256',"
      "encode(sha256(convert_to(value::text,'UTF8')),'hex')) FROM ("+SNAPSHOT_SQL+") s(value); COMMIT;").encode()))
    if observed['sha256'] != receipt.get('verification_sha256') or len(observed['snapshot']['functions'] or []) != 10:
        raise catalog.CatalogError('catalog_edit_catalog_drift')
    return {'installed': True, 'feature': FEATURE, 'preview_sha256': receipt['preview_sha256'],
            'verification_sha256': receipt['verification_sha256']}


def verified_base(ex, module):
    rows = json.loads(ex.capture(('BEGIN READ ONLY; '+LEDGER_SQL+'; COMMIT;').encode(), role='postgres'))
    if len(rows) == 96 and len(module.verify_manifest()['source']['files']) == 97:
        verify_working_snapshot(module, rows)
    else:
        module._validate_ledger_snapshot(rows)
    return rows


def plan(ex, module):
    source_bodies()
    ledger = verified_base(ex, module)
    return {'schema': 'local-working-feature-plan-v1', 'feature': FEATURE,
            'project': ex._expected_project(), 'sources': SOURCES,
            'ledger': ledger, 'restaurant_digest': catalog.local_state(ex)['digest']}


def install_sql(preview, digest):
    q = catalog.quote
    # All business-table checks and installation metadata are in the same transaction.
    return (f"""BEGIN;
      SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
      SELECT pg_advisory_xact_lock(82917623052);
      LOCK TABLE _tzudong_local.migration_ledger IN SHARE MODE;
      LOCK TABLE public.restaurants IN SHARE MODE;
      DO $bound$ BEGIN
        IF ({LEDGER_SQL}) <> {q(catalog.canonical(preview['ledger']).decode())}::jsonb THEN RAISE EXCEPTION 'catalog_edit_ledger_changed'; END IF;
        IF ({catalog.DIGEST_SQL}) <> {q(preview['restaurant_digest'])} THEN RAISE EXCEPTION 'catalog_edit_working_data_changed'; END IF;
      END; $bound$;
      """ + ''.join(source_bodies()) + f"""
      CREATE TABLE _tzudong_local.working_feature_receipts (
        feature_id text PRIMARY KEY, project text NOT NULL, sources jsonb NOT NULL,
        preview_sha256 text NOT NULL, verification_sha256 text NOT NULL,
        installed_at timestamptz NOT NULL DEFAULT clock_timestamp()
      );
      ALTER TABLE _tzudong_local.working_feature_receipts ENABLE ROW LEVEL SECURITY;
      REVOKE ALL ON _tzudong_local.working_feature_receipts FROM PUBLIC,anon,authenticated,service_role;
      CREATE TRIGGER immutable_feature_receipt BEFORE UPDATE OR DELETE ON _tzudong_local.working_feature_receipts
        FOR EACH ROW EXECUTE FUNCTION admin_catalog_edit.reject_audit_mutation();
      CREATE TRIGGER immutable_feature_receipt_truncate BEFORE TRUNCATE ON _tzudong_local.working_feature_receipts
        FOR EACH STATEMENT EXECUTE FUNCTION admin_catalog_edit.reject_audit_mutation();
      INSERT INTO _tzudong_local.working_feature_receipts(feature_id,project,sources,preview_sha256,verification_sha256)
        SELECT {q(FEATURE)},{q(preview['project'])},{q(catalog.canonical(SOURCES).decode())}::jsonb,{q(digest)},
        encode(sha256(convert_to(snapshot.value::text,'UTF8')),'hex')
        FROM ({SNAPSHOT_SQL}) snapshot(value);
      DO $preserved$ BEGIN
        IF ({catalog.DIGEST_SQL}) <> {q(preview['restaurant_digest'])} THEN RAISE EXCEPTION 'catalog_edit_working_data_changed'; END IF;
      END; $preserved$;
      NOTIFY pgrst, 'reload schema';
      COMMIT;
      """).encode()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('preview','apply','status'))
    parser.add_argument('--preview-sha256')
    args = parser.parse_args()
    ex, module = catalog.executor()
    existing = verify_if_installed(ex)
    if args.command == 'status' or existing['installed']:
        print(json.dumps(existing))
        return
    preview = plan(ex, module)
    digest = catalog.sha(preview)
    if args.command == 'preview':
        print(json.dumps({'feature': FEATURE, 'preview_sha256': digest, 'business_updates': 0}))
        return
    if args.preview_sha256 != digest:
        raise catalog.CatalogError('catalog_edit_preview_mismatch')
    ex.run(install_sql(preview, digest))
    # Separate connection: no install-success claim from a submitted transaction alone.
    result = verify_if_installed(ex)
    if catalog.local_state(ex)['digest'] != preview['restaurant_digest']:
        raise catalog.CatalogError('catalog_edit_working_data_readback_changed')
    print(json.dumps({**result, 'business_data_preserved': True}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        code = str(error) if isinstance(error, catalog.CatalogError) else 'catalog_edit_installation_unverified'
        print(json.dumps({'error': code, 'next': 'Run status before any retry.'}))
        raise SystemExit(1)
