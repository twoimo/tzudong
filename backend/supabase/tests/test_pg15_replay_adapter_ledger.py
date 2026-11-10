"""Keep the PG15 replay adapter ledger equal to the adapter layer in code.

`local-migrate.py::_canonical_source_replay_bodies()` rewrites nine migrations and
loads five helper modules plus the G026 verifier, all of which assume PostgreSQL
15. Retiring them (the first workstream of
`docs/operations/local-postgres17-transition.md`) is mechanical only if the list
cannot drift: adding an adapter without recording it, or deleting one without
removing its ledger entry, has to fail here instead of surfacing as a mid-chain
`psql_failed` on somebody's nightly run.
"""
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
LEDGER = ROOT / "backend/supabase/baselines/local/PG15_REPLAY_ADAPTERS.v1.json"
MIGRATE = ROOT / "backend/supabase/scripts/local-migrate.py"
SCRIPTS = ROOT / "backend/supabase/scripts"

LOADED = re.compile(r'load\("([a-zA-Z0-9_]+)"\)')
ADAPTER_KEY = re.compile(r'"(transform_[a-zA-Z0-9_]+)":\s*\(')


def _adapter_block() -> str:
    source = MIGRATE.read_text(encoding="utf-8")
    start = source.index("def _canonical_source_replay_bodies()")
    end = source.index("\ndef ", start + 10)
    return source[start:end]


def _modules_in_code() -> list[str]:
    block = _adapter_block()
    return sorted(set(LOADED.findall(block)) | set(ADAPTER_KEY.findall(block)))


class Pg15ReplayAdapterLedgerTests(unittest.TestCase):
    def test_ledger_matches_the_adapter_layer(self) -> None:
        ledger = json.loads(LEDGER.read_text(encoding="utf-8"))
        self.assertEqual(ledger["schemaVersion"], 1)
        self.assertEqual(ledger["id"], "local-pg15-replay-adapters-v1")
        self.assertEqual(ledger["postgresMajor"], 15)
        self.assertEqual(
            sorted(ledger["modules"]),
            _modules_in_code(),
            "Update PG15_REPLAY_ADAPTERS.v1.json with local-migrate.py",
        )

    def test_every_recorded_module_exists(self) -> None:
        ledger = json.loads(LEDGER.read_text(encoding="utf-8"))
        for module in ledger["modules"]:
            self.assertTrue((SCRIPTS / f"{module}.py").is_file(), module)
        for binding in ledger["dataBindings"]:
            self.assertTrue((SCRIPTS / binding).is_file(), binding)
        self.assertTrue((ROOT / ledger["transactionContract"]).is_file())

    def test_the_landed_pin_guard_knows_the_same_adapter_layer(self) -> None:
        """The image-pin guard fails a major bump while this layer exists."""
        migrate = MIGRATE.read_text(encoding="utf-8")
        self.assertIn("_canonical_source_replay_bodies", migrate)
        guard = (ROOT / "backend/supabase/tests/test_local_postgres_image_pin.py").read_text(encoding="utf-8")
        self.assertIn("_canonical_source_replay_bodies", guard)


if __name__ == "__main__":
    unittest.main()
