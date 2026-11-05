import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';

import {
  assertPost106AclLaunchReady,
  compilePost106AclOperatingPlan,
  compilePost106AclRehearsalPlan,
  expectedPost106AclTerminalState,
  loadPost106AclSuccessorManifest,
  validatePost106AclTerminalState,
} from '../scripts/receipt-ocr-post106-acl-admission-sql-successor.mjs';

const temporaryDirectories: string[] = [];
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('held receipt OCR 105 -> 106 -> 107 ACL admission successor', () => {
  test('pins frozen 106 as held_unapplied and binds the exact 107 source identity', () => {
    const record = loadPost106AclSuccessorManifest();

    expect(record.manifest.operatingTransition).toEqual({
      before: 105,
      intermediate: 106,
      after: 107,
    });
    expect(record.manifest.baseSuccessor).toMatchObject({
      state: 'held_unapplied',
      manifestSha256: 'ecc1d0678210f4ac06fe47fc4b62cfdd0694511aacc18ab20978d3e83d82af81',
      compilerSha256: '4ba7e8b5c12e212809acf6d3c5fdaed4cf58ac70a1c663c25fb7db0bc979ebda',
      operatingTargetIdentityRoot: '83a1b91fa12541581e53dca933a12ca6c5aa4470dd70f912444d38dcd19522c1',
    });
    expect(record.material.identity).toEqual({
      version: '20261019120000',
      name: 'receipt_ocr_credential_release_acl_admission_v2',
      statementCount: 27,
      statementVectorSha256: '37decc48cfcd3cbb9e40afd6511929262da2400264aa1f18e51317a01d92e9bf',
    });
    expect(sha256(record.material.bytes)).toBe(
      '512f778b71a196e28f092266782fe5938b7d15ec72b61bf05978f3b1696faec9',
    );
    expect(() => assertPost106AclLaunchReady(record)).toThrow(
      'RECEIPT_OCR_POST106_ACL_LAUNCH_HELD',
    );
  });

  test('compiles both migrations in one explicit outer transaction with ordered seals', () => {
    const record = loadPost106AclSuccessorManifest();
    const plan = compilePost106AclOperatingPlan(record);

    expect(plan.transactionMode).toBe('single-explicit-outer-transaction');
    expect(plan.sql.match(/\bBEGIN;/g)).toHaveLength(1);
    expect(plan.sql.match(/\bCOMMIT;/g)).toHaveLength(1);
    expect(plan.sql.match(/INSERT INTO supabase_migrations\.schema_migrations/g)).toHaveLength(2);
    expect(plan.sql.indexOf('20261018152032')).toBeLessThan(plan.sql.indexOf('20261019120000'));
    expect(plan.sql.indexOf('RECEIPT_OCR_CATALOG_SEAL_READBACK_FAILED')).toBeLessThan(
      plan.sql.indexOf('RECEIPT_OCR_ACL_V2_SEAL_ADMISSION_FAILED'),
    );
    expect(plan.sql).toContain('MIGRATION_ALREADY_APPLIED');
    expect(plan.sql).toContain('MIGRATION_LEDGER_CONFLICT');
    expect(plan.sql).toContain('receipt-ocr-definitive-credential-release-v2');
    expect(plan.finalReadback.expected).toEqual(expectedPost106AclTerminalState(record));
  });

  test('keeps operating and rehearsal identities separate while requiring v2 readiness', () => {
    const record = loadPost106AclSuccessorManifest();
    const operating = compilePost106AclOperatingPlan(record);
    const rehearsal = compilePost106AclRehearsalPlan(record);

    expect(operating.finalReadback.expected.ledgerIdentityRoot).toBe(
      'cd04aebfc1efcc5588486adf3b7ba47fc5b5b76e39a9c23e316768f2919d9d9e',
    );
    expect(rehearsal.finalReadback.expected.ledgerIdentityRoot).toBe(
      '1b869222e1efc419e744eeabda52fd1d1900a6a71308a7227a583859136706f7',
    );
    for (const plan of [operating, rehearsal]) {
      expect(plan.finalReadback.expected).toMatchObject({
        aclAdmitted: true,
        ledgerCount: 107,
        v1ContractSealed: true,
        v2ContractSealed: true,
        capability: {
          schema_version: 1,
          status: 'ready',
          capability_version: 'receipt-ocr-definitive-credential-release-v2',
        },
      });
    }
  });

  test('rejects target readback drift instead of accepting a 106-only state', () => {
    const record = loadPost106AclSuccessorManifest();
    const expected = expectedPost106AclTerminalState(record);

    expect(validatePost106AclTerminalState(expected, record)).toEqual({
      mode: 'operating',
      targetIdentityRoot: expected.ledgerIdentityRoot,
    });
    expect(() => validatePost106AclTerminalState({
      ...expected,
      ledgerCount: 106,
      v2ContractSealed: false,
      capability: {
        schema_version: 1,
        status: 'ready',
        capability_version: 'receipt-ocr-definitive-credential-release-v1',
      },
    }, record)).toThrow('RECEIPT_OCR_POST106_ACL_STAGE_INVALID');
  });

  test('fails closed on manifest identity drift', () => {
    const manifest = JSON.parse(readFileSync(
      join(import.meta.dir, '../../../.github/receipt-ocr-post106-acl-admission-sql-successor.v1.json'),
      'utf8',
    ));
    manifest.operatingIdentity.targetIdentityRoot = '0'.repeat(64);
    const directory = mkdtempSync(join(tmpdir(), 'receipt-ocr-post106-acl-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'manifest.json');
    writeFileSync(path, `${JSON.stringify(manifest)}\n`);

    expect(() => loadPost106AclSuccessorManifest({ manifestPath: path })).toThrow(
      'RECEIPT_OCR_POST106_ACL_IDENTITY_BINDING_INVALID',
    );
  });

  test('source encodes an independent exact ACL allowlist before snapshot equality', () => {
    const migration = readFileSync(
      join(import.meta.dir, '../../../backend/supabase/migrations/20261019120000_receipt_ocr_credential_release_acl_admission_v2.sql'),
      'utf8',
    );

    expect(migration).toContain('receipt_credential_release_acl_admitted_v2');
    expect(migration).toContain('(SELECT * FROM actual_function_acl)\n      EXCEPT\n      (SELECT * FROM expected_function_acl)');
    expect(migration).toContain('(SELECT * FROM actual_table_acl)\n      EXCEPT\n      (SELECT * FROM expected_table_acl)');
    expect(migration).toContain("pg_catalog.acldefault('f', function_row.expected_owner)");
    expect(migration).toContain("pg_catalog.acldefault('r', table_row.expected_owner)");
    expect(migration).toContain('acl.is_grantable');
    expect(migration).toContain('acl.grantor');
    expect(migration.indexOf('RECEIPT_OCR_ACL_V2_INITIAL_ADMISSION_FAILED')).toBeLessThan(
      migration.indexOf('INSERT INTO ocr_private.receipt_credential_release_catalog_contract'),
    );
    expect(migration).toContain('RECEIPT_OCR_ACL_V2_UNSEALED_CAPABILITY_DRIFT');
  });

  test('owner-role lease preserves preexisting membership options and stays outside the PG15 adapter boundary', () => {
    const migration = readFileSync(
      join(import.meta.dir, '../../../backend/supabase/migrations/20261019120000_receipt_ocr_credential_release_acl_admission_v2.sql'),
      'utf8',
    );
    const boundaryEnd = migration.indexOf('-- END RECEIPT OCR 107 OPERATING ADMISSION');
    const leaseStart = migration.indexOf('CREATE TEMPORARY TABLE pg_temp.receipt_ocr_acl_v2_owner_lease');
    const setRole = migration.indexOf('SET LOCAL ROLE privacy_workflow_owner;', leaseStart);
    const allowlistInsert = migration.indexOf(
      'INSERT INTO privacy_retention.g014_nested_helper_allowlist',
      setRole,
    );
    const ownerAssertions = migration.indexOf('DO $post_replace_acl_admission$', allowlistInsert);
    const resetRole = migration.indexOf('RESET ROLE;', ownerAssertions);
    const restore = migration.indexOf('DO $restore_owner_lease$', resetRole);

    expect(boundaryEnd).toBeGreaterThan(-1);
    expect(leaseStart).toBeGreaterThan(boundaryEnd);
    expect(setRole).toBeGreaterThan(leaseStart);
    expect(allowlistInsert).toBeGreaterThan(setRole);
    expect(ownerAssertions).toBeGreaterThan(allowlistInsert);
    expect(resetRole).toBeGreaterThan(ownerAssertions);
    expect(restore).toBeGreaterThan(resetRole);
    expect(migration).toContain(
      'WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY postgres',
    );
    expect(migration).toContain("lease.self_membership->>'inherit_option'");
    expect(migration).toContain("lease.self_membership->>'set_option'");
    expect(migration).toContain('after_members IS DISTINCT FROM lease.before_members');
    expect(migration).toContain('RECEIPT_OCR_ACL_V2_OWNER_LEASE_RESTORE_FAILED');
  });

  test('fixtures cover creator defaults and forbidden ACL even when the seal matches', () => {
    const initialDefaultFixture = readFileSync(
      join(import.meta.dir, '../../../backend/supabase/tests/receipt_ocr_credential_release_acl_initial_default_v2.sql'),
      'utf8',
    );
    const admissionFixture = readFileSync(
      join(import.meta.dir, '../../../backend/supabase/tests/receipt_ocr_credential_release_acl_admission_v2.sql'),
      'utf8',
    );

    expect(initialDefaultFixture).toContain(
      'ALTER DEFAULT PRIVILEGES FOR ROLE privacy_workflow_owner',
    );
    expect(initialDefaultFixture).toContain('ALTER DEFAULT PRIVILEGES FOR ROLE postgres');
    expect(initialDefaultFixture).toContain("default_acl.defaclobjtype = 'f'");
    expect(initialDefaultFixture).toContain("default_acl.defaclobjtype = 'r'");
    expect(admissionFixture).toContain('refresh_receipt_ocr_acl_v2_seal');
    expect(admissionFixture).toContain('RECEIPT_OCR_ACL_V2_FORBIDDEN_SEALED_ACL_READY');
    expect(admissionFixture).toContain('TO service_role WITH GRANT OPTION');
    expect(admissionFixture).toContain(
      'ALTER TABLE ocr_private.receipt_credential_rejection_releases OWNER TO supabase_admin',
    );
    expect(admissionFixture).toContain('ROLLBACK;');
  });
});
