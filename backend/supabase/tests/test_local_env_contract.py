"""The generated stack env and the applier must agree on their keys.

`local-migrate.py` validates the whole key set (`set(values) != LOCAL_ENV_KEYS`) before
it touches the database, and it exits 2 with `local_env_provenance` when the stack env
grew a key it does not know. That is how the PostgreSQL 17 pin attempt failed: adding
`POSTGRES_IMAGE` to the generated env made the nightly die at `prerequisite_apply`,
three stages after the stack itself started cleanly.

This test runs in seconds and names the offending key, so the next attempt fails in the
pre-flight instead of after a twenty-minute stack start.
"""
import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


class LocalEnvContractTests(unittest.TestCase):
    def test_the_generated_stack_env_matches_the_applier_contract(self) -> None:
        stack = _load("local_stack_env_contract", ROOT / "backend/supabase/scripts/local-stack.py")
        migrate = _load("local_migrate_env_contract", ROOT / "backend/supabase/scripts/local-migrate.py")
        with tempfile.TemporaryDirectory() as tmp:
            values = stack._env_values(ROOT, "probe-project", Path(tmp))
        extra = sorted(set(values) - migrate.LOCAL_ENV_KEYS)
        missing = sorted(migrate.LOCAL_ENV_KEYS - set(values))
        self.assertEqual(
            extra,
            [],
            "local-migrate.py rejects an env key it does not know (local_env_provenance): "
            f"add {extra} to LOCAL_ENV_KEYS in backend/supabase/scripts/local-migrate.py",
        )
        self.assertEqual(missing, [], f"the applier expects keys the stack no longer writes: {missing}")


if __name__ == "__main__":
    unittest.main()
