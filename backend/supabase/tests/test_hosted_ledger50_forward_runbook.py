"""Source contract for the hosted ledger-50 forward-apply runbook."""
from __future__ import annotations

import re
from pathlib import Path
import unittest


ROOT = Path(__file__).parents[3]
RUNBOOK = (
    ROOT / "backend" / "supabase" / "docs" / "g035-hosted-recovery-runbook.md"
)
FORWARD_MIGRATIONS = (
    "20260814010000_hosted_g016_g041_catalog_reconciliation.sql",
    "20260814010100_hosted_runtime_boundary_convergence.sql",
    "20260814010200_hosted_public_profile_read_convergence.sql",
    "20260814010300_hosted_current_profile_mutation.sql",
)


class HostedLedger50ForwardRunbookTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source = RUNBOOK.read_text(encoding="utf8")
        start = cls.source.index("## Hosted ledger-50 forward application")
        end = cls.source.index("## Key custody and destination", start)
        cls.section = cls.source[start:end]

    def test_promotion_and_exact_current_main_are_hard_gates(self):
        self.assertNotIn("There is no hosted-apply implementation", self.source)
        self.assertIn("`develop` → `data` → `main`", self.section)
        self.assertIn("legitimate checks", self.section)
        self.assertIn("branch-protection requirements", self.section)
        self.assertIn("never use an administrator bypass", self.section)
        self.assertIn("fresh detached checkout", self.section)
        self.assertIn("exact current `origin/main` commit", self.section)
        self.assertIn("clean tree including untracked files", self.section)
        self.assertIn("fresh `ls-remote` readback", self.section)

    def test_recovery_is_fresh_dual_local_restore_with_anonymous_fd_custody(self):
        self.assertIn("local-dual-restore-rehearsal-v2", self.section)
        self.assertGreaterEqual(self.section.count("--identity-fd"), 2)
        self.assertNotIn("--identity-file", self.section)
        self.assertIn("selectively inherited anonymous pipe", self.section)
        self.assertIn("at most **3,600 seconds (one hour)** old", self.section)
        self.assertIn("both retained restore receipts", self.section)
        self.assertIn("cleanup proof", self.section)
        self.assertIn("two containers, networks, temporary service files", self.section)

    def test_workspace_and_cli_surface_are_exact(self):
        self.assertIn("exactly 50 fail-closed predecessor sentinels", self.section)
        for migration in FORWARD_MIGRATIONS:
            self.assertEqual(1, self.section.count(f"`{migration}`"))
        self.assertIn("Supabase CLI **v2.109.1**", self.section)
        self.assertIn("exact size and SHA-256", self.section)
        self.assertRegex(
            self.section,
            re.compile(
                r"never add `--include-all`, migration `repair`, seed application, "
                r"or roles application"
            ),
        )
        self.assertIn("canonical migration-directory push", self.section)

    def test_apply_is_one_attempt_then_terminal_read_only_or_failure_receipt(self):
        self.assertIn("`db push --dry-run` for exactly the remaining suffix", self.section)
        self.assertIn("exactly one non-dry-run `db push` subprocess", self.section)
        self.assertIn("Do not retry within the same invocation", self.section)
        self.assertIn("Start a fresh invocation", self.section)
        self.assertIn("new dry run must plan only the exact remaining suffix", self.section)
        self.assertIn("`failure-receipt.json`", self.section)
        self.assertIn("`retryAttempted=false`", self.section)
        self.assertIn("terminal already-applied path is readback only", self.section)
        for fixture in (
            "hosted_forward_convergence_readback.sql",
            "hosted_profile_convergence.sql",
        ):
            self.assertIn(f"`{fixture}`", self.section)
        self.assertIn("explicit read-only transactions", self.section)

    def test_receipts_do_not_overclaim_release_or_recovery_coverage(self):
        self.assertIn("do not prove legal or privacy compliance", self.section)
        self.assertIn("branch approval, or release certification", self.section)
        self.assertIn("`managedPitrAvailable=false`", self.section)
        self.assertIn("not managed PITR", self.section)
        self.assertIn("physical Storage blobs", self.section)
        self.assertIn("external Supabase Auth/provider configuration", self.section)


if __name__ == "__main__":
    unittest.main()
