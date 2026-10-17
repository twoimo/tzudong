import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationPath = join(
  import.meta.dir,
  '../../../backend/supabase/migrations/20261013190200_review_verification_immutable_key_fence.sql',
);
const migration = readFileSync(migrationPath, 'utf8');

describe('review verification immutable Storage key fence', () => {
  test('sorts after durable OCR and records the CLI-generated source name', () => {
    expect(migrationPath).toContain('20261013190200_review_verification_immutable_key_fence.sql');
    expect(migration).toContain('20261013113348_review_verification_immutable_key_fence.sql');
    expect(migration).toContain('20261013190000');
    expect(migration).toContain('20261013190100');
  });

  test('combines an authenticated restrictive policy with a privileged UPDATE trigger', () => {
    expect(migration).toContain('CREATE POLICY review_verifications_immutable_update');
    expect(migration).toContain('AS RESTRICTIVE');
    expect(migration).toContain('FOR UPDATE');
    expect(migration).toContain("USING (bucket_id <> 'review-verifications')");
    expect(migration).toContain("WITH CHECK (bucket_id <> 'review-verifications')");
    expect(migration).toContain('CREATE TRIGGER a01_review_verification_immutable_update');
    expect(migration).toContain('BEFORE UPDATE ON storage.objects');
    expect(migration).toContain("MESSAGE = 'REVIEW_VERIFICATION_OBJECT_IMMUTABLE'");
    expect(migration).toContain('SECURITY INVOKER');
  });

  test('serializes DELETE with review writes and persists an exact canonical tombstone', () => {
    expect(migration).toContain('CREATE TRIGGER a01_review_verification_guard_delete');
    expect(migration).toContain('BEFORE DELETE ON storage.objects');
    expect(migration).toContain('PERFORM pg_catalog.pg_advisory_xact_lock(741093, 1)');
    expect(migration).toContain('IF review_media_private.referenced(OLD.name) THEN');
    expect(migration).toContain("MESSAGE = 'REVIEW_VERIFICATION_OBJECT_REFERENCED'");
    expect(migration).toContain('IF NOT review_media_private.canonical(');
    expect(migration).toContain("MESSAGE = 'REVIEW_VERIFICATION_OBJECT_DELETE_UNBOUND'");
    expect(migration).toContain('INSERT INTO review_media_private.cleanup(');
    expect(migration).toContain('ON CONFLICT (path) DO UPDATE');
    expect(migration).toContain('SET retired = true,');
    expect(migration).toContain('complete = false;');
  });

  test('preserves existing delete policies and denies direct trigger-function execution', () => {
    expect(migration).toContain("p.polname = 'review_verifications_owner_delete'");
    expect(migration).toContain("p.polname = 'review_verifications_safe_delete'");
    expect(migration).toContain('AND p.polpermissive');
    expect(migration).toContain('AND NOT p.polpermissive');
    expect(migration).not.toMatch(/DROP\s+POLICY/i);
    expect(migration).not.toMatch(/DELETE\s+FROM\s+storage\.objects/i);
    expect(migration).toContain(
      'FROM PUBLIC, anon, authenticated, service_role, supabase_storage_admin;',
    );
    expect(migration).toContain('REVOKE EXECUTE ON FUNCTION review_media_private.reject_verification_object_update()');
    expect(migration).toContain('REVOKE EXECUTE ON FUNCTION review_media_private.guard_verification_object_delete()');
    expect(migration).toContain('FROM postgres;');
    expect(migration).toContain('does not claim to lock provider bytes');
  });

  test('activates the runtime capability only after the final fence readback', () => {
    const readbackIndex = migration.indexOf('DO $readback$');
    const capabilityIndex = migration.indexOf('INSERT INTO ocr_private.feature_runtime_capability');
    const commitIndex = migration.lastIndexOf('COMMIT;');
    expect(readbackIndex).toBeGreaterThanOrEqual(0);
    expect(capabilityIndex).toBeGreaterThan(readbackIndex);
    expect(commitIndex).toBeGreaterThan(capabilityIndex);
    expect(migration).toContain("'review-media-feature-v1'");
  });
});
