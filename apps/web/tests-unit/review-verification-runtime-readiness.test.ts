import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const predecessorPath = join(
  import.meta.dir,
  '../../../backend/supabase/migrations/20261013190000_durable_receipt_ocr_results.sql',
);
const successorPath = join(
  import.meta.dir,
  '../../../backend/supabase/migrations/20261016090000_review_verification_delete_guard_readiness.sql',
);
const predecessor = readFileSync(predecessorPath, 'utf8');
const successor = readFileSync(successorPath, 'utf8');

describe('review verification runtime readiness successor', () => {
  test('leaves the applied durable OCR migration immutable and replaces the private helper forward-only', () => {
    expect(predecessor).not.toContain('24311fc7071597fbc78c4c54897690da5aaa70edb62c24f7912fd23fecf515b0');
    expect(successor).toContain('Forward-only successor for an already applied durable OCR migration');
    expect(successor).toContain(
      'CREATE OR REPLACE FUNCTION ocr_private.get_feature_runtime_capability(p_user_id uuid)',
    );
    expect(successor).not.toContain('CREATE OR REPLACE FUNCTION public.get_feature_runtime_capability');
  });

  test('holds runtime on exact delete trigger, helper body, metadata, and execute exposure drift', () => {
    expect(successor).toContain("trigger_row.tgname = 'a01_review_verification_guard_delete'");
    expect(successor).toContain("trigger_row.tgenabled = 'O'");
    expect(successor).toContain('trigger_row.tgtype = 11');
    expect(successor).toContain('pg_catalog.pg_get_triggerdef(trigger_row.oid, false)');
    expect(successor).toContain(
      'CREATE TRIGGER a01_review_verification_guard_delete BEFORE DELETE ON storage.objects FOR EACH ROW EXECUTE FUNCTION review_media_private.guard_verification_object_delete()',
    );
    expect(successor).toContain(
      "'review_media_private.guard_verification_object_delete()'::pg_catalog.regprocedure",
    );
    expect(successor).toContain(
      '24311fc7071597fbc78c4c54897690da5aaa70edb62c24f7912fd23fecf515b0',
    );
    expect(successor).toContain("function_row.proowner = 'privacy_workflow_owner'::pg_catalog.regrole");
    expect(successor).toContain('AND function_row.prosecdef');
    expect(successor).toContain("'supabase_storage_admin'");
    expect(successor).toContain('pg_catalog.has_function_privilege(');
  });

  test('keeps the feature receipt bounded and verifies the replacement ACL before commit', () => {
    const readbackIndex = successor.indexOf('DO $readback$');
    const commitIndex = successor.lastIndexOf('COMMIT;');
    expect(readbackIndex).toBeGreaterThanOrEqual(0);
    expect(commitIndex).toBeGreaterThan(readbackIndex);
    expect(successor).toContain("'status', CASE WHEN v_ready THEN 'ready' ELSE 'held' END");
    expect(successor).toContain("'code', CASE WHEN v_ready THEN 'FEATURE_DATABASE_READY' ELSE 'FEATURE_DATABASE_HELD' END");
    expect(successor).toContain(
      'GRANT EXECUTE ON FUNCTION ocr_private.get_feature_runtime_capability(uuid)\n  TO privacy_workflow_owner',
    );
    expect(successor).toContain("pg_catalog.has_function_privilege(\n      'service_role',\n      capability_oid");
  });
});
