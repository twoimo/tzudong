import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import { statementSpans } from '../scripts/supabase-migration-transaction.mjs';

const migrationUrl = new URL(
  '../../../backend/supabase/migrations/20261013190100_g014_feature_rpc_catalog_contract.sql',
  import.meta.url,
);
const source = readFileSync(migrationUrl, 'utf8');

const ocrSignatures = [
  'public.claim_receipt_ocr_result(uuid,text,text,text,jsonb,uuid,text,text,text,uuid,boolean)',
  'public.mark_receipt_ocr_dispatched(uuid,uuid)',
  'public.complete_receipt_ocr_result(uuid,uuid,jsonb)',
  'public.mark_receipt_ocr_result_indeterminate(uuid,uuid)',
  'public.release_receipt_ocr_claim(uuid,uuid)',
  'public.read_receipt_ocr_result(uuid,text,text,text,jsonb,uuid,text,text,text)',
  'public.get_review_receipt_ocr_generation(uuid,uuid)',
  'public.publish_review_receipt_ocr_result(uuid,uuid,uuid,uuid,uuid,text,jsonb,boolean)',
  'public.get_feature_runtime_capability(uuid)',
  'public.get_owned_review_storage_objects(uuid,uuid,text,text[])',
  'public.create_review_with_receipt_ocr(uuid,uuid,uuid,text,text,timestamptz,text,text[],text[],uuid,uuid,uuid,text,timestamptz,text,jsonb)',
] as const;

describe('G014 feature RPC catalog successor', () => {
  test('is a whole-file transaction sorted after the frozen OCR dependency', () => {
    const statements = statementSpans(source).map(span => span.token.trim());
    expect(statements[0]).toEndWith('BEGIN');
    expect(statements.at(-1)).toBe('COMMIT');
    expect(source).toContain(
      '20261013113313_g014_feature_rpc_catalog_contract.sql, then renamed before any',
    );
    expect(migrationUrl.pathname).toContain(
      '/20261013190100_g014_feature_rpc_catalog_contract.sql',
    );
  });

  test('registers exactly the eleven typed OCR service RPCs', () => {
    const registryValues = source.match(
      /INSERT INTO pg_temp\.g014_feature_rpc_registry[\s\S]*?;\n\nCREATE TEMPORARY TABLE/,
    )?.[0] ?? '';
    expect(registryValues).not.toBe('');
    for (const signature of ocrSignatures) {
      expect(registryValues).toContain(`'${signature}'`);
    }
    expect(registryValues.match(/\('public\./g)).toHaveLength(ocrSignatures.length);
    expect(source).toContain("'service_role'::name");
    expect(source).toContain('expected_volatility "char" NOT NULL');
    expect(source).toContain('procedure_row.provolatile <> required.expected_volatility');
    expect(source).toContain('ON CONFLICT (source_signature, grantee) DO UPDATE SET');
  });

  test('moves privileged OCR implementations behind workflow-owner public wrappers', () => {
    expect(source).toContain("procedure_row.proowner <> 'postgres'::regrole");
    expect(source).toContain('OR NOT procedure_row.prosecdef');
    expect(source).toContain(
      "procedure_row.proconfig IS DISTINCT FROM ARRAY['search_path=\"\"']::text[]",
    );
    expect(source).toContain("'ALTER FUNCTION %s SET SCHEMA ocr_private'");
    expect(source).toContain(
      'INSERT INTO privacy_retention.g014_nested_helper_allowlist (source_signature)',
    );
    expect(source.match(/CREATE FUNCTION public\.(?:claim_receipt_ocr_result|mark_receipt_ocr_dispatched|complete_receipt_ocr_result|mark_receipt_ocr_result_indeterminate|release_receipt_ocr_claim|read_receipt_ocr_result|get_review_receipt_ocr_generation|publish_review_receipt_ocr_result|get_feature_runtime_capability|get_owned_review_storage_objects|create_review_with_receipt_ocr)\(/g)).toHaveLength(
      ocrSignatures.length,
    );
    expect(source).toContain("wrapper_row.proowner <> 'privacy_workflow_owner'::regrole");
    expect(source).toContain("helper_row.proowner <> 'postgres'::regrole");
    expect(source).toContain("WHERE language.lanname = 'sql'");
    expect(source).toContain("WHERE language.lanname = 'plpgsql'");
    expect(source).toContain(
      "NOT pg_catalog.has_function_privilege('privacy_workflow_owner', helper_oid, 'EXECUTE')",
    );
    expect(source).toContain(
      "pg_catalog.has_function_privilege('service_role', helper_oid, 'EXECUTE')",
    );
    expect(source).toContain("VALUES ('ocr_private.register_review_ocr_generation()')");
  });

  test('removes direct Data API access to the installed trigger helper', () => {
    expect(source).toContain(
      'REVOKE ALL ON FUNCTION public.storyboard_production_reject_archived_write()',
    );
    expect(source).toContain(
      'FROM PUBLIC, anon, authenticated, service_role, privacy_workflow_owner;',
    );
    expect(source).not.toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.storyboard_production_reject_archived_write/,
    );
    expect(source).toContain("procedure_row.prorettype <> 'trigger'::regtype");
    expect(source).toContain(') <> 6 THEN');
  });

  test('preserves role membership and validates only the affected G014 contracts', () => {
    expect(source).toContain('CREATE TEMPORARY TABLE pg_temp.g014_feature_membership_before');
    expect(source).toContain('G014_FEATURE_RPC_MEMBERSHIP_DRIFT');
    expect(source).toContain('PERFORM privacy_retention.assert_g014_public_rpc_allowlist();');
    expect(source).toContain('PERFORM privacy_retention.assert_g014_definer_contract();');
    expect(source).not.toContain('PERFORM privacy_retention.assert_g014_catalog_contract();');
    expect(source).toContain('G014_FEATURE_RPC_CATALOG_MANIFEST_DRIFT');
  });
});
