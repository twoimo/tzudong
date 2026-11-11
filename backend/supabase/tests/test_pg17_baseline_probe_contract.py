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
        self.assertIn("if: ${{ always() && inputs.pg17_baseline == true }}", self.workflow)

    def test_the_step_resolves_its_own_container_and_database(self) -> None:
        self.assertIn('com.docker.compose.service=db', self.workflow)
        self.assertIn('"$LOCAL_STATE/stack.env"', self.workflow)
        self.assertNotIn('--database-container "$LOCAL_DB_CONTAINER"', self.workflow)

    def test_the_probe_runs_while_the_stack_is_live_and_before_the_lanes(self) -> None:
        # The stack must exist for the dump to mean anything, and a lane failure
        # (measured: the Actions runners stopped resolving archive.ubuntu.com and the
        # browser lane died before the probe) must not consume the measurement.
        migrated = self.workflow.index("Verify generated Supabase types match the local catalog")
        probe = self.workflow.index("Probe the PostgreSQL 17 baseline restore")
        lanes = self.workflow.index("Run local nightly unit regression")
        teardown = self.workflow.index("Stop and remove disposable local stack")
        self.assertLess(migrated, probe)
        self.assertLess(probe, lanes)
        self.assertLess(probe, teardown)

    def test_the_script_restores_into_a_disposable_container(self) -> None:
        self.assertIn('PG17_IMAGE = "supabase/postgres:17.11.0.018"', self.script)
        self.assertIn('RESTORE_CONTAINER = "tzudong-pg17-baseline"', self.script)
        self.assertIn('"pg_dump"', self.script)
        self.assertIn('"--schema-only"', self.script)
        self.assertIn('docker", "rm", "-f", RESTORE_CONTAINER', self.script)
        self.assertNotIn("docker rm -f {args.database_container}", self.script)

    def test_preexisting_image_objects_are_not_counted_as_failures(self) -> None:
        # Measured: the first successful restore reported 172 errors that were all
        # "already exists" - the supabase image seeds auth/storage/vault/extensions.
        # Counting those as incompatibilities would report a false negative.
        self.assertIn('def _is_already_exists(error: str) -> bool:', self.script)
        self.assertIn('"preexistingObjectCount": len(preexisting)', self.script)
        self.assertIn('"missingObjectCount": len(missing)', self.script)
        self.assertIn('"--clean", "--if-exists"', self.script)

    def test_the_probe_prepares_roles_and_seeded_schemas(self) -> None:
        # Measured: 119 of 120 genuine errors were 'role "privacy_workflow_owner" does
        # not exist', because a schema-only dump carries no CREATE ROLE; the one
        # remaining was --clean failing to drop a schema the image also seeds.
        self.assertIn('ROLE_STATEMENTS_SQL', self.script)
        self.assertIn("format('CREATE ROLE %I NOLOGIN', r.rolname)", self.script)
        # Policies and default ACLs name roles that own nothing, so an owner-only
        # query misses them (measured: 119 failures naming privacy_workflow_owner).
        self.assertIn('pg_catalog.pg_policy', self.script)
        self.assertIn('pg_catalog.pg_default_acl', self.script)
        self.assertIn('SEEDED_SCHEMAS', self.script)
        self.assertIn('DROP SCHEMA IF EXISTS', self.script)
        self.assertIn('"preparedRoleCount": len(role_statements)', self.script)

    def test_the_restore_uses_the_role_that_owns_the_catalog(self) -> None:
        # Measured: `postgres` in the supabase image has no DDL rights and fails every
        # statement with "permission denied for database", which reads as a schema
        # incompatibility but is not one.
        self.assertIn('RESTORE_ROLE = "supabase_admin"', self.script)
        self.assertIn('"psql", "-U", args.restore_role', self.script)
        self.assertNotIn('"psql", "-U", "postgres", "-d", "profile"', self.script)


if __name__ == "__main__":
    unittest.main()
