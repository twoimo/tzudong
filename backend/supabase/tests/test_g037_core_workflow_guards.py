"""Workflow contracts for G037 secondary producer admission guards."""
from pathlib import Path
import unittest

import yaml


ROOT = Path(__file__).parents[3]
WORKFLOWS = ROOT / ".github" / "workflows"
FREEZE_GUARD = "vars.G037_WRITE_FREEZE != 'active'"
DAILY_COMPUTE_GUARD = (
    "${{ github.repository == github.event.repository.full_name && "
    "github.ref_name == github.event.repository.default_branch && "
    "github.ref_protected }}"
)
DAILY_UPLOAD_GUARD = "${{ always() }}"
DAILY_PUBLICATION_GUARD = (
    "${{ always() && needs.daily-compute.outputs.publication_ready == 'true' && "
    "needs.daily-compute.outputs.publication_manifest_sha256 != '' }}"
)
BACKFILL_GUARD = (
    "${{ github.repository == github.event.repository.full_name && "
    "github.ref_name == github.event.repository.default_branch && "
    "github.ref_protected && "
    "(github.event_name != 'workflow_run' || "
    "(github.event.workflow_run.conclusion == 'success' && "
    "github.event.workflow_run.event == 'schedule' && "
    "github.event.workflow_run.head_branch == github.event.repository.default_branch && "
    "github.event.workflow_run.head_repository.full_name == github.repository)) }}"
)


class G037CoreWorkflowGuardTests(unittest.TestCase):
    @staticmethod
    def _workflow(name):
        with (WORKFLOWS / name).open(encoding="utf8") as source:
            return yaml.safe_load(source)
    @staticmethod
    def _normalized_scalar(value):
        return " ".join(value.split())

    def assert_scalar_equal(self, actual, expected):
        self.assertEqual(
            self._normalized_scalar(actual),
            self._normalized_scalar(expected),
        )

    def assert_run_fragments_in_order(self, run, fragments):
        cursor = 0
        for fragment in fragments:
            position = run.find(fragment, cursor)
            self.assertNotEqual(position, -1, f"missing command fragment: {fragment!r}")
            cursor = position + len(fragment)

    @staticmethod
    def _step(job, name):
        matches = [step for step in job["steps"] if step["name"] == name]
        if len(matches) != 1:
            raise AssertionError(f"expected exactly one {name!r} step, got {len(matches)}")
        return matches[0]

    def test_migration_apply_admission_precedes_database_secret_and_writer(self):
        apply = self._workflow("supabase-migration-apply.yml")["jobs"]["apply"]
        self.assert_scalar_equal(
            apply["if"],
            "needs.validate.result == 'success' && "
            "github.event.inputs.dry_run != 'true' && "
            "needs.validate.outputs.validated_sha == github.sha && "
            "needs.validate.outputs.manifest_sha256 == "
            "needs.validate.outputs.expected_manifest_sha256 && "
            "github.repository == 'twoimo/tzudong' && "
            "github.event.repository.full_name == 'twoimo/tzudong' && "
            "github.event.repository.default_branch == 'main' && "
            "github.ref == 'refs/heads/main' && github.ref_name == 'main' && "
            "(vars.G037_WRITE_FREEZE != 'active' || "
            "contains(fromJSON('[\"g016_privacy_audit_owner_policy\","
            "\"g016_onboarding_confirmation_freshness\"]'), "
            "needs.validate.outputs.migration_id)) && "
            "(!contains(fromJSON('[\"g016_privacy_audit_owner_policy\","
            "\"g016_onboarding_confirmation_freshness\"]'), "
            "needs.validate.outputs.migration_id) || "
            "github.event.inputs.verify_terminal_state == 'true')",
        )
        self.assertNotIn("environment", apply)
        self.assertLess(list(apply).index("if"), list(apply).index("steps"))
        writer = self._step(
            apply,
            "Apply reviewed migration or verify provider-applied terminal state",
        )
        self.assertEqual(writer["env"], {
            "SUPABASE_DB_URL": "${{ secrets.SUPABASE_DB_URL }}",
            "MIGRATION_ID": "${{ needs.validate.outputs.migration_id }}",
            "VERIFY_TERMINAL_STATE": "${{ github.event.inputs.verify_terminal_state }}",
            "PROVIDER_MIGRATION_RECEIPT_SHA256": "${{ secrets.PROVIDER_MIGRATION_RECEIPT_SHA256 }}",
            "PROVIDER_RECEIPT": "${{ github.event.inputs.provider_receipt }}",
        })
        self.assert_run_fragments_in_order(
            writer["run"],
            (
                "set -euo pipefail",
                'args=(--migration-id "$MIGRATION_ID" --json)',
                'if [ "$VERIFY_TERMINAL_STATE" = "true" ]; then',
                "args+=(--verify-terminal-state)",
                'args+=(--provider-receipt "$PROVIDER_RECEIPT")',
                'node apps/web/scripts/apply-supabase-migration.mjs "${args[@]}"',
            ),
        )

    def test_daily_compute_upload_and_publication_admission_are_exact(self):
        daily = self._workflow("daily-crawler.yml")
        compute = daily["jobs"]["daily-compute"]
        self.assert_scalar_equal(compute["if"], DAILY_COMPUTE_GUARD)
        upload = self._step(compute, "Upload Results to GDrive")
        self.assert_scalar_equal(upload["if"], DAILY_UPLOAD_GUARD)
        self.assertLess(list(upload).index("if"), list(upload).index("env"))
        self.assertLess(list(upload).index("if"), list(upload).index("run"))
        self.assert_run_fragments_in_order(
            upload["run"],
            (
                'rclone copyto "$RESIDUAL_QUEUE" "$GDRIVE_STATUS_SCOPE_PATH/gdrive-upload-residual-queue.jsonl"',
                'rclone copyto "$UPLOAD_STATUS" "$GDRIVE_STATUS_SCOPE_PATH/current-upload-status.json"',
                'rclone copyto "$EXPECTED_MANIFEST" "$GDRIVE_STATUS_SCOPE_PATH/current-upload-expected.json"',
                'rclone copyto "$BATCH_MANIFEST" "$GDRIVE_STATUS_SCOPE_PATH/current-upload-batches.json"',
                'rclone copyto "$REMOTE_PROOF_JSON" "$GDRIVE_STATUS_SCOPE_PATH/current-upload-remote-proof.json"',
                'rclone copyto "$STAGING_MANIFEST_FOR_STATUS" "$GDRIVE_STAGING_SCOPE_PATH/current-upload-staging-manifest.json"',
                'rclone copy . "$GDRIVE_FRAMES_PATH"',
                'rclone copy "$STAGING_DIR" "$GDRIVE_STAGING_SCOPE_PATH"',
            ),
        )

        publish = daily["jobs"]["daily-publish"]
        self.assert_scalar_equal(publish["if"], DAILY_PUBLICATION_GUARD)
        self.assertNotIn("environment", publish)
        push = self._step(publish, "Push the one verified content commit")
        self.assertEqual(push["env"], {
            "PUSH_TOKEN": "${{ github.token }}",
            "TARGET_WORKTREE": "${{ runner.temp }}/daily-data-target",
            "BASE_SHA": "${{ steps.verify-publication.outputs.base_sha }}",
        })
        self.assertLess(list(push).index("env"), list(push).index("run"))
        self.assert_run_fragments_in_order(
            push["run"],
            (
                "set -euo pipefail",
                'test "$(git -C "$TARGET_WORKTREE" rev-parse HEAD^)" = "$BASE_SHA"',
                'git -C "$TARGET_WORKTREE" merge-base --is-ancestor "$BASE_SHA" HEAD',
                'askpass="$RUNNER_TEMP/daily-publication-askpass"',
                'chmod 700 "$askpass"',
                'GIT_ASKPASS="$askpass" GIT_TERMINAL_PROMPT=0 GIT_PASSWORD="$PUSH_TOKEN"',
                'git -C "$TARGET_WORKTREE" -c credential.helper= push',
                '"https://github.com/${GITHUB_REPOSITORY}.git" HEAD:refs/heads/data',
            ),
        )

    def test_backfill_admission_precedes_environment_secret_and_writer(self):
        backfill = self._workflow("gdrive-frame-backfill.yml")["jobs"]["backfill"]
        self.assert_scalar_equal(backfill["if"], BACKFILL_GUARD)
        self.assertNotIn("environment", backfill)
        credentials = self._step(backfill, "Setup rclone credentials")
        self.assertEqual(
            credentials["env"],
            {"GDRIVE_RCLONE_CONFIG": "${{ secrets.GDRIVE_RCLONE_CONFIG }}"},
        )
        writer = self._step(backfill, "Backfill staged frame shards")
        self.assertLess(list(credentials).index("env"), list(credentials).index("run"))
        self.assertLess(
            backfill["steps"].index(credentials),
            backfill["steps"].index(writer),
        )
        self.assertIn(
            'rclone copy . "$GDRIVE_FRAMES_PATH" \\',
            writer["run"],
        )

    def test_read_only_migration_validation_remains_available_during_freeze(self):
        validate = self._workflow("supabase-migration-apply.yml")["jobs"]["validate"]
        self.assertNotIn(FREEZE_GUARD, validate["if"])
        validation_steps = [
            step
            for step in validate["steps"]
            if step.get("id") == "manifest"
            and step.get("env", {}).get("MIGRATION_ID")
            == "${{ github.event.inputs.migration_id }}"
        ]
        self.assertEqual(len(validation_steps), 1)
        self.assertIn("--dry-run", validation_steps[0]["run"])


if __name__ == "__main__":
    unittest.main()
