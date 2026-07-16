import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
GENERATOR = ROOT / "backend/supabase/scripts/generate_g014_catalog_contract_baseline.sh"


class G024SourceReconstructionContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = GENERATOR.read_text(encoding="utf-8")

    def test_legacy_dump_seed_and_transform_inputs_are_absent(self):
        prohibited = (
            "pre-20260214-public-schema.raw.sql",
            "PRE_20260214_PUBLIC_SCHEMA.v1.json",
            "pre-20260214-public-schema.transformed.sql",
            "pre-20260214-announcements.seed.sql",
            "PRE_20260214_ANNOUNCEMENTS_SEED.v1.json",
            "7660b1650c8cd974991437948d65e70cb7c8a65665a16eeb90162e0c2fe3e119",
            "e7295b8b4b429e8a1ce526eca5b00c0fd7d79e53d561ca27f8c9f554b87724ae",
            "036d0a073bfcf50fead4e3379bc8e4373372e934b69112dbed4963767245ed68",
            "remote_public_schema.before_20260214.sql",
            "transformed_schema=",
            "announcements_seed=",
            "seed_manifest=",
        )
        for value in prohibited:
            self.assertNotIn(value, self.source)

    def test_archive_contract_is_validated_extracted_and_replayed_once_in_order(self):
        self.assertIn("verify_reconstruction_source_archive.py", self.source)
        self.assertIn("RECONSTRUCTION_SOURCES.v1.zip", self.source)
        self.assertIn("RECONSTRUCTION_SOURCES.v1.json", self.source)
        self.assertIn('python3 "$reconstruction_validator"', self.source)
        self.assertIn("reconstruction_extract_dir", self.source)
        self.assertIn("reconstruction-source-members.tsv", self.source)
        self.assertIn('[[ "$ordinal" == "$expected_ordinal"', self.source)
        self.assertIn('mapfile -t reconstruction_member_rows <"$reconstruction_members"', self.source)
        self.assertIn('for reconstruction_member_row in "${reconstruction_member_rows[@]}"', self.source)
        self.assertEqual(
            self.source.count("while IFS=$'\\t' read -r ordinal member_path member_hash extracted; do"),
            1,
        )
        self.assertIn(
            'reconstruction-sources/{entry["ordinal"]:02d}.sql',
            self.source,
        )
        self.assertIn(
            '[[ "$extracted" == "reconstruction-sources/$(printf \'%02d\' "$ordinal").sql" ]]',
            self.source,
        )
        self.assertIn(
            'extracted="$reconstruction_extract_dir/$(printf \'%02d\' "$ordinal").sql"',
            self.source,
        )
        self.assertIn('psql -X -v ON_ERROR_STOP=1', self.source)
        self.assertIn("PGOPTIONS='-c check_function_bodies=off'", self.source)
        self.assertIn('if [[ "$ordinal" == 0 ]]', self.source)
        self.assertIn('[[ "$reconstruction_replay_count" == 10', self.source)
        self.assertIn('reconstruction source archive must contain exactly ten members', self.source)
        self.assertIn('length == 10', self.source)
        self.assertIn('"ordinal":1,"path":"supabase/migrations/temp/20251210_redesign_submissions_v2.sql"', self.source)
        self.assertIn('"blobSha1":"254765d14e47bc2754fcbbcecc1365153f944505"', self.source)
        self.assertIn("reconstruction members were not replayed exactly once", self.source)
        self.assertIn("reconstruction-compatibility-exclusions.jsonl", self.source)
        self.assertIn("excluded_without_replacement", self.source)
        self.assertIn("reconstruction compatibility block bytes mismatch", self.source)
        self.assertIn("entry_exclusions", self.source)
        self.assertIn("range is invalid or overlaps", self.source)
        self.assertIn("for exclusion in exclusions", self.source)
        self.assertIn("reconstruction-compatibility-relocations.jsonl", self.source)
        self.assertIn("reconstruction_relocation_source", self.source)
        self.assertIn(' <"$reconstruction_relocation_source"', self.source)
        self.assertIn("relocated_before_source_without_modification", self.source)
        self.assertNotIn("EXECUTE format", self.source)
        self.assertNotIn("CREATE OR REPLACE FUNCTION public.refresh_materialized_views()", self.source)

    def test_evidence_is_scoped_unauthorized_and_includes_overlap_report(self):
        scope = "source-only reconstruction candidate; not historical application proof or hosted-state evidence"
        self.assertIn(scope, self.source)
        self.assertIn("reconstructionAuthorized == false", self.source)
        self.assertIn("reconstruction_authorized false", self.source)
        self.assertIn("pre-20260214-overlap-classification.jsonl", self.source)
        self.assertIn("before_canonical_public_catalog_projection_hash", self.source)
        self.assertIn("after_canonical_public_catalog_projection_hash", self.source)
        self.assertIn("classification=unchanged", self.source)
        self.assertIn("reconstruction_archive_sha256", self.source)
        self.assertIn("reconstruction_manifest_sha256", self.source)
        self.assertIn("reconstruction_entries", self.source)
        self.assertIn("reconstruction_compatibility_exclusions_sha256", self.source)
        self.assertIn("reconstruction_compatibility_exclusions", self.source)
        self.assertIn("reconstruction_compatibility_relocations_sha256", self.source)
        self.assertIn("reconstruction_compatibility_relocations", self.source)
    def test_artifact_manifest_is_the_deterministic_checksum_authority(self):
        self.assertIn("artifact-manifest.txt", self.source)
        self.assertIn("LC_ALL=C sort >artifact-manifest.txt", self.source)
        self.assertIn('done <artifact-manifest.txt >SHA256SUMS', self.source)
        self.assertNotIn("sha256sum migration-chain.txt catalog-manifest.jsonl", self.source)
    def test_g026_v4_bundle_is_verified_replayed_and_receipted_in_exact_slots(self):
        for value in (
            'python3 "$g026_validator"',
            "G026_RECONSTRUCTION_BUNDLE.v4.json",
            "G026_RECONSTRUCTION_TRANSITION.v4.sql",
            "G026_RECONSTRUCTION_REPAIRS.v4.sql",
            "g026-validation-ledger.json",
            "g026-semantic-receipt.json",
            "g026-readback-receipt.json",
            "g026-behavior-receipt.json",
            "g026-phase-a-after-ordinal-2",
            "g026-phase-b-before-20260713002000_g014_public_api_private_boundary.sql",
            "G026 ordinal-6 function-body validation quarantine",
            "G026 repairs require function-body validation on",
        ):
            self.assertIn(value, self.source)
        self.assertIn("CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions", self.source)
        self.assertIn("CREATE EXTENSION IF NOT EXISTS fuzzystrmatch WITH SCHEMA extensions", self.source)
        self.assertIn("CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions", self.source)
        self.assertIn(
            "fuzzystrmatch:extensions,pgcrypto:extensions,vector:extensions",
            self.source,
        )
        self.assertIn(
            "if [[ ${migration##*/} == '20260713002000_g014_public_api_private_boundary.sql' ]]; then\n"
            "    g026_apply_repairs",
            self.source,
        )
        self.assertNotIn(
            "g026-phase-c-after-20260713002600_g014_account_deletion_receipt_parity.sql",
            self.source,
        )
        self.assertIn(
            'psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5432 -U postgres -d postgres -At',
            self.source,
        )
        for value in (
            'final_catalog_assertion_window="$work_dir/g026-final-catalog-assertion-window.sql"',
            "g026_chain_apply 'g026-final-catalog-assertion-window'",
            "SELECT privacy_retention.assert_g014_catalog_contract();",
            "jq -er '.replayMembershipWindows.finalZeroMembershipProof'",
            "jq -er '.replayMembershipWindows.catalogSchemaUsageGrantStatement'",
            "jq -er '.replayMembershipWindows.catalogFunctionExecuteGrantStatement'",
            "jq -er '.replayMembershipWindows.cleanupMembershipGrantStatement'",
            "jq -er '.replayMembershipWindows.catalogFunctionExecuteRevokeStatement'",
            "jq -er '.replayMembershipWindows.catalogSchemaUsageRevokeStatement'",
            "jq -er '.replayMembershipWindows.cleanupMembershipRevokeStatement'",
            "jq -er '.replayMembershipWindows.catalogPrivilegePostcondition'",
            "g026_capture_owner_catalog_query()",
            "'g026-catalog-jsonl-readback-window'",
            "'g026-catalog-tuple-readback-window'",
            "SET LOCAL ROLE privacy_workflow_owner;",
            "RESET ROLE;",
        ):
            self.assertIn(value, self.source)
        self.assertNotIn(
            'cp -- "$reconstruction_members" "$staging_dir/reconstruction-source-members.tsv"',
            self.source,
        )
        for staged_path in (
            "gotrue_ledger_evidence",
            "storage_ledger_evidence",
            "storage_native_source_map",
            "storage_native_file_expected_ledger",
            "storage_inventory_source_map",
            "storage_file_evidence",
        ):
            self.assertNotIn(f'cp -- "${staged_path}" "$staging_dir/', self.source)
        final_window = self.source.index(
            'final_catalog_assertion_window="$work_dir/g026-final-catalog-assertion-window.sql"'
        )
        final_zero_membership = self.source.index(
            "jq -er '.replayMembershipWindows.finalZeroMembershipProof'"
        )
        self.assertLess(final_window, final_zero_membership)
        staging_assignment = self.source.index('staging_dir="$work_dir/evidence"')
        staging_creation = self.source.index('mkdir -m 700 "$docker_config" "$staging_dir"')
        ledger_assignment = self.source.index('g026_validation_ledger="$staging_dir/g026-validation-ledger.json"')
        self.assertLess(staging_assignment, staging_creation)
        self.assertLess(staging_creation, ledger_assignment)
    def test_g026_role_management_transform_is_atomic_hash_bound_and_staged_as_postgres(self):
        for value in (
            "g026_apply_role_management_transform()",
            "G026 role-management source hash mismatch",
            "G026 role-management anchor count drifted",
            "G026 role-management final-contract anchor drifted",
            "G026 role-management transform ordering drifted",
            "G026 role-management transformed hash mismatch",
            "roleManagementReplayTransform",
            "BEGIN;",
            "grantStatement",
            "revokeStatement",
            "postcondition",
            "COMMIT;",
            "publicSchemaGrantStatement",
            "publicSchemaRevokeStatement",
            "publicSchemaPostcondition",
            "publicSchemaGrantAnchor",
            "relocatedFinalContractInvocation",
            "G026 public-schema compatibility binding drifted",
        ):
            self.assertIn(value, self.source)
        transform_start = self.source.index("g026_apply_role_management_transform()")
        transform_end = self.source.index("g026_chain_apply()", transform_start)
        transform_source = self.source[transform_start:transform_end]
        self.assertNotIn("-U supabase_admin", transform_source)
        self.assertNotIn("SET ROLE supabase_admin", transform_source)
        self.assertNotIn("GRANT privacy_workflow_owner TO postgres WITH ADMIN OPTION", transform_source)
        self.assertNotIn("SET LOCAL ROLE privacy_workflow_owner", transform_source)
        replay = self.source.index("transformed_migration=$(g026_apply_role_management_transform")
        self.assertLess(transform_start, replay)

    def test_generator_has_no_hosted_database_or_ledger_feed(self):
        prohibited = ("SUPABASE_DB_URL", "SUPABASE_URL", "psql \"$DATABASE_URL\"", "curl ", "wget ")
        for value in prohibited:
            self.assertNotIn(value, self.source)


if __name__ == "__main__":
    unittest.main()
