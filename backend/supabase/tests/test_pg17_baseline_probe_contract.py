"""The PG17 probe must stay gated, non-mutating, and thin.

The probe runs inside the nightly local regression where the stack is live: it
captures the working schema read-only and provisions it into a disposable PG17
container. The restore logic itself lives in local_baseline.py and is covered by
test_local_baseline; this file pins the workflow wiring and the fact that the probe
does not carry its own copy of that logic.
"""
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
WORKFLOW = ROOT / ".github/workflows/nightly-local-regression.yml"
PROBE = ROOT / "backend/supabase/scripts/pg17_baseline_probe.py"
MODULE = ROOT / "backend/supabase/scripts/local_baseline.py"


class Pg17BaselineProbeContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.workflow = WORKFLOW.read_text(encoding="utf-8")
        self.probe = PROBE.read_text(encoding="utf-8")
        self.module = MODULE.read_text(encoding="utf-8")

    def test_the_input_defaults_to_off(self) -> None:
        self.assertIn("      pg17_baseline:\n", self.workflow)
        self.assertIn("        default: false\n        type: boolean\n", self.workflow)
        self.assertIn("if: ${{ always() && inputs.pg17_baseline == true }}", self.workflow)

    def test_the_probe_runs_while_the_stack_is_live_and_before_the_lanes(self) -> None:
        # A lane failure must not consume the measurement: six dispatches died at
        # 'Install Chromium' before the probe was moved ahead of the lanes.
        migrated = self.workflow.index("Verify generated Supabase types match the local catalog")
        probe = self.workflow.index("Probe the PostgreSQL 17 baseline restore")
        lanes = self.workflow.index("Run local nightly unit regression")
        teardown = self.workflow.index("Stop and remove disposable local stack")
        self.assertLess(migrated, probe)
        self.assertLess(probe, lanes)
        self.assertLess(probe, teardown)

    def test_the_step_resolves_its_own_container_and_database(self) -> None:
        self.assertIn("com.docker.compose.service=db", self.workflow)
        self.assertIn('"$LOCAL_STATE/stack.env"', self.workflow)
        self.assertNotIn('--database-container "$LOCAL_DB_CONTAINER"', self.workflow)

    def test_the_probe_uses_the_shared_module_instead_of_a_copy(self) -> None:
        self.assertIn("import local_baseline as lb", self.probe)
        self.assertIn("lb.capture(", self.probe)
        self.assertIn("lb.provision(", self.probe)
        self.assertNotIn("pg_dump", self.probe)
        self.assertNotIn("CREATE ROLE", self.probe)

    def test_the_probe_keeps_the_baseline_it_captured(self) -> None:
        # The captured baseline is the artifact a provisioned stack needs, so the run
        # keeps it and the workflow uploads it with the record.
        self.assertIn('"--baseline-output"', self.workflow)
        self.assertIn("pg17-baseline/", self.workflow)
        self.assertIn('args.baseline_output if args.baseline_output', self.probe)

    def test_the_probe_restores_into_a_disposable_container(self) -> None:
        self.assertIn('PG17_IMAGE = "supabase/postgres:17.11.0.018"', self.probe)
        self.assertIn('RESTORE_CONTAINER = "tzudong-pg17-baseline"', self.probe)
        self.assertIn('docker", "rm", "-f", RESTORE_CONTAINER', self.probe)
        self.assertNotIn("rm\", \"-f\", args.database_container", self.probe)


class BaselineModuleContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.module = MODULE.read_text(encoding="utf-8")

    def test_the_restore_uses_the_role_that_owns_the_catalog(self) -> None:
        # Measured: `postgres` in the supabase image has no DDL rights and fails every
        # statement with "permission denied for database", which reads as a schema
        # incompatibility but is not one.
        self.assertIn('RESTORE_ROLE = "supabase_admin"', self.module)

    def test_preexisting_image_objects_are_reset_before_restoring(self) -> None:
        self.assertIn("SEEDED_SCHEMAS", self.module)
        self.assertIn("DROP SCHEMA IF EXISTS", self.module)
        self.assertIn("pg_catalog.pg_policy", self.module)
        self.assertIn("pg_catalog.pg_default_acl", self.module)

    def test_success_requires_object_parity(self) -> None:
        self.assertIn('"missingObjectCount": len(missing)', self.module)
        self.assertIn('"provisioned":', self.module)
        self.assertIn('len(restored_names) == baseline.manifest.get("objectCount")', self.module)

    def test_the_baseline_is_self_verifying(self) -> None:
        self.assertIn('"schemaSha256"', self.module)
        self.assertIn('"objectNamesSha256"', self.module)
        self.assertIn('"rolesSha256"', self.module)
        self.assertIn("does not match its manifest digest", self.module)


if __name__ == "__main__":
    unittest.main()
