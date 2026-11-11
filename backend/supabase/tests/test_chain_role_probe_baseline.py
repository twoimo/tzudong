"""Keep the committed role-probe baselines readable and comparable.

`backend/supabase/scripts/chain_role_probe.py` is the tool the PostgreSQL 17
transition uses to compare role sequences. The baselines it produced are the
numbers the plan quotes, so a malformed or silently regenerated baseline has to
fail here rather than drift away from the document.
"""
import json
import unittest
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
BASELINES = ROOT / "backend/supabase/baselines/local"
ADMIN = BASELINES / "pg15-chain-role-probe-20261111.json"
POSTGRES = BASELINES / "pg15-chain-role-probe-prereq-postgres-20261111.json"
MIXED = BASELINES / "pg15-chain-role-probe-mixed-20261111.json"


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


class ChainRoleProbeBaselineTests(unittest.TestCase):
    def test_baselines_describe_the_same_migration_set(self) -> None:
        records = [load(ADMIN), load(POSTGRES), load(MIXED)]
        self.assertEqual(len({r["migrationCount"] for r in records}), 1)
        self.assertEqual(len({r["image"] for r in records}), 1)
        for record in records:
            self.assertEqual(record["schemaVersion"], 1)
            self.assertEqual(record["kind"], "local-chain-role-probe")
            self.assertTrue(record["prerequisiteApplied"])
            self.assertEqual(
                record["appliedCount"] + record["failedCount"], record["migrationCount"]
            )
            self.assertEqual(len(record["failed"]), record["failedCount"])

    def test_mixed_privileged_execution_improves_on_the_postgres_baseline(self) -> None:
        postgres, mixed = load(POSTGRES), load(MIXED)
        self.assertTrue(mixed["mixedPrivileged"])
        self.assertTrue(mixed["grantFile"].endswith("role-grant-normalisation.v1.sql"))
        self.assertGreater(mixed["appliedCount"], postgres["appliedCount"])
        self.assertLess(mixed["failedCount"], postgres["failedCount"])

    def test_prerequisite_role_moves_ownership_onto_postgres(self) -> None:
        admin, postgres = load(ADMIN), load(POSTGRES)
        self.assertEqual(admin["prerequisiteRole"], "supabase_admin")
        self.assertEqual(postgres["prerequisiteRole"], "postgres")
        self.assertTrue(postgres["prerequisiteContinue"])
        self.assertEqual(
            postgres["prerequisiteErrors"], ['must be member of role "supabase_admin"']
        )
        admin_owners = Counter(row["owner"] for row in admin["ownership"])
        postgres_owners = Counter(row["owner"] for row in postgres["ownership"])
        self.assertGreater(postgres["appliedCount"], admin["appliedCount"])
        self.assertLess(postgres["failedCount"], admin["failedCount"])
        self.assertGreater(
            postgres_owners["postgres"] / sum(postgres_owners.values()),
            admin_owners["postgres"] / sum(admin_owners.values()),
        )


if __name__ == "__main__":
    unittest.main()
