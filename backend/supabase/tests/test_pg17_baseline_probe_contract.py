"""The PG17 baseline probe must stay gated and non-mutating.

The probe runs inside the nightly local regression, where the stack is live: it
dumps the working schema read-only and restores it into a disposable PG17
container. This test pins that shape - the workflow input defaults to false, the
step is gated on it, and the script uses a disposable container instead of the
running one.
"""
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
WORKFLOW = ROOT / ".github/workflows/nightly-local-regression.yml"
SCRIPT = ROOT / "backend/supabase/scripts/pg17_baseline_probe.py"


class Pg17BaselineProbeContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.workflow = WORKFLOW.read_text(encoding="utf-8")
        self.script = SCRIPT.read_text(encoding="utf-8")

    def test_the_input_defaults_to_off(self) -> None:
        self.assertIn("      pg17_baseline:\n", self.workflow)
        self.assertIn("        default: false\n        type: boolean\n", self.workflow)
        self.assertIn("if: ${{ inputs.pg17_baseline == true }}", self.workflow)

    def test_the_step_resolves_its_own_container_and_database(self) -> None:
        self.assertIn('com.docker.compose.service=db', self.workflow)
        self.assertIn('"$LOCAL_STATE/stack.env"', self.workflow)
        self.assertNotIn('--database-container "$LOCAL_DB_CONTAINER"', self.workflow)

    def test_the_probe_runs_before_the_stack_is_removed(self) -> None:
        probe = self.workflow.index("Probe the PostgreSQL 17 baseline restore")
        teardown = self.workflow.index("Stop and remove disposable local stack")
        self.assertLess(probe, teardown)

    def test_the_script_restores_into_a_disposable_container(self) -> None:
        self.assertIn('PG17_IMAGE = "supabase/postgres:17.11.0.018"', self.script)
        self.assertIn('RESTORE_CONTAINER = "tzudong-pg17-baseline"', self.script)
        self.assertIn('"pg_dump"', self.script)
        self.assertIn('"--schema-only"', self.script)
        self.assertIn('docker", "rm", "-f", RESTORE_CONTAINER', self.script)
        self.assertNotIn("docker rm -f {args.database_container}", self.script)

    def test_the_restore_uses_the_role_that_owns_the_catalog(self) -> None:
        # Measured: `postgres` in the supabase image has no DDL rights and fails every
        # statement with "permission denied for database", which reads as a schema
        # incompatibility but is not one.
        self.assertIn('RESTORE_ROLE = "supabase_admin"', self.script)
        self.assertIn('"psql", "-U", args.restore_role', self.script)
        self.assertNotIn('"psql", "-U", "postgres", "-d", "profile"', self.script)


if __name__ == "__main__":
    unittest.main()
