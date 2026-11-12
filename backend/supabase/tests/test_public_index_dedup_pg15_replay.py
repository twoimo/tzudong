"""Exact-source and dispatch checks for the isolated PG15 index cleanup replay."""

import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest

from backend.supabase.scripts import transform_public_index_dedup_pg15_replay as replay
from backend.supabase.scripts import recover_public_index_dedup_replay_prerequisites as recovery


ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "backend/supabase/scripts/transform_public_index_dedup_pg15_replay.py"
GENERATOR = ROOT / "backend/supabase/scripts/generate_g014_catalog_contract_baseline.sh"
REPLAY_SHA256 = "c97bd16d4336c92e7c3252fb08999f0f3fd2ba3936b9f66e8e7718732acfcd8c"


class PublicIndexDedupPg15ReplayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source_path = ROOT / "backend/supabase/migrations" / replay.NAME
        cls.source = cls.source_path.read_bytes()
        cls.driver = GENERATOR.read_text()

    def test_only_one_executor_version_byte_changes(self) -> None:
        actual = replay.transform(self.source)
        self.assertEqual(len(actual), replay.BYTE_LENGTH)
        self.assertEqual(hashlib.sha256(self.source).hexdigest(), replay.SHA256)
        self.assertEqual(hashlib.sha256(actual).hexdigest(), REPLAY_SHA256)
        self.assertEqual(sum(a != b for a, b in zip(actual, self.source)), 1)
        self.assertEqual(actual.count(replay.PG15_VERSION_GUARD), 1)
        self.assertNotIn(replay.PG17_VERSION_GUARD, actual)
        self.assertEqual(
            actual.replace(replay.PG15_VERSION_GUARD, replay.PG17_VERSION_GUARD, 1),
            self.source,
        )

    def test_source_filename_and_every_other_byte_are_bound(self) -> None:
        for source, name in (
            (self.source, "20261112105200_deduplicate_equivalent_public_indexes.sql"),
            (self.source + b"\n", replay.NAME),
            (self.source.replace(b"lock_timeout = '1s'", b"lock_timeout = '2s'"), replay.NAME),
            (self.source.replace(b"RESTRICT", b"CASCADE"), replay.NAME),
            (self.source + replay.PG17_VERSION_GUARD, replay.NAME),
            (replay.transform(self.source), replay.NAME),
        ):
            with self.subTest(name=name, digest=hashlib.sha256(source).hexdigest()):
                with self.assertRaisesRegex(ValueError, "^PUBLIC_INDEX_DEDUP_PG15_REPLAY_SOURCE_DRIFT$"):
                    replay.transform(source, name)

    def test_pg15_body_preserves_all_executor_and_destructive_operation_guards(self) -> None:
        actual = replay.transform(self.source)
        for marker in (
            b"current_database() <> 'postgres'",
            b"current_user <> 'postgres' OR session_user <> 'postgres'",
            b"transaction_read_only') <> 'off'",
            b"SET LOCAL lock_timeout = '1s';",
            b"SET LOCAL statement_timeout = '15s';",
            b"pg_advisory_xact_lock",
            b"IN ACCESS EXCLUSIVE MODE",
            b"public_index_dedup_dependency_denied",
            b"public_index_dedup_readback_failed",
            b"RESTRICT",
            b"BEGIN;",
            b"COMMIT;",
        ):
            self.assertGreater(self.source.count(marker), 0, marker)
            self.assertEqual(actual.count(marker), self.source.count(marker), marker)

    def test_cli_never_overwrites_an_existing_output_or_the_source(self) -> None:
        with tempfile.TemporaryDirectory(prefix="index-dedup-cli-") as temporary:
            root = Path(temporary)
            source = root / replay.NAME
            source.write_bytes(self.source)
            output = root / "pg15-replay.sql"
            arguments = [sys.executable, str(SCRIPT), "--source", str(source), "--output", str(output)]
            first = subprocess.run(arguments, capture_output=True, timeout=5)
            self.assertEqual(first.returncode, 0, first.stderr)
            self.assertEqual(output.read_bytes(), replay.transform(self.source))
            output.write_bytes(b"existing-output-canary")
            repeated = subprocess.run(arguments, capture_output=True, timeout=5)
            self.assertNotEqual(repeated.returncode, 0)
            self.assertEqual(output.read_bytes(), b"existing-output-canary")
            same_source = subprocess.run(arguments[:-1] + [str(source)], capture_output=True, timeout=5)
            self.assertNotEqual(same_source.returncode, 0)
            self.assertEqual(source.read_bytes(), self.source)

    def test_generator_has_one_exact_branch_and_tracks_the_adapter_input(self) -> None:
        branches = re.findall(r"^\s+([^\n]+\.sql)\)\s*$", self.driver, re.M)
        self.assertEqual(sum(replay.NAME in value.split("|") for value in branches), 1)
        relevant = self.driver.split("relevant_sources=(", 1)[1].split("\n)", 1)[0]
        self.assertIn("backend/supabase/scripts/transform_public_index_dedup_pg15_replay.py", relevant)
        self.assertIn("backend/supabase/scripts/recover_public_index_dedup_replay_prerequisites.py", relevant)

    def _dispatch(self, *, source: bytes | None = None, psql_exit: int = 0,
                  fail_call: int = 2, prerequisite_source: bytes | None = None):
        """Run the real shell dispatch with a recording, database-free psql boundary."""
        case = self.driver.split('  case "${migration##*/}" in\n', 1)[1].split(
            "  esac\n  previous_effective_filename=", 1
        )[0]
        with tempfile.TemporaryDirectory(prefix="index-dedup-dispatch-") as temporary:
            root = Path(temporary)
            migration = root / replay.NAME
            migration.write_bytes(self.source if source is None else source)
            staging = root / "evidence"
            staging.mkdir()
            baselines = ROOT / "backend/supabase/baselines"
            if prerequisite_source is not None:
                baselines = root / "baselines"
                (baselines / "local").mkdir(parents=True)
                (baselines / "local/application-prerequisites.sql").write_bytes(prerequisite_source)
            argv = root / "argv"
            sql = root / "stdin.sql"
            chain = root / "chain.tsv"
            stub = r'''
set -euo pipefail
test_call_index=0
g026_chain_apply() {
  printf '%s\t%s\n' "$1" "$(sha256sum -- "$2" | cut -d' ' -f1)" >> "$TEST_CHAIN"
}
compose() {
  test_call_index=$((test_call_index + 1))
  printf '%s\0' "$@" > "$TEST_ARGV.$test_call_index"
  cat > "$TEST_SQL.$test_call_index"
  if [[ "$test_call_index" == "$TEST_FAIL_CALL" ]]; then
    return "$TEST_PSQL_EXIT"
  fi
  return 0
}
'''
            result = subprocess.run(
                ["bash", "-c", stub + 'case "${migration##*/}" in\n' + case + "esac\n"],
                env={"PATH": os.environ.get("PATH", os.defpath), "migration": str(migration),
                     "work_dir": str(root), "script_dir": str(SCRIPT.parent),
                     "staging_dir": str(staging), "baselines_dir": str(baselines),
                     "TEST_ARGV": str(argv), "TEST_SQL": str(sql),
                     "TEST_CHAIN": str(chain), "TEST_PSQL_EXIT": str(psql_exit),
                     "TEST_FAIL_CALL": str(fail_call)},
                capture_output=True, timeout=5,
            )
            return (
                result,
                [path.read_bytes().decode().rstrip("\0").split("\0")
                 for path in sorted(root.glob("argv.*"))],
                [path.read_bytes() for path in sorted(root.glob("stdin.sql.*"))],
                chain.read_text().splitlines() if chain.exists() else [],
                migration.read_bytes(),
            )

    def test_generator_executes_the_complete_replay_once_and_hashes_both_inputs(self) -> None:
        result, arguments, sql, chain, source = self._dispatch()
        self.assertEqual(result.returncode, 0, result.stderr)
        expected_args = ["exec", "-T", "db", "psql", "-X", "-v", "ON_ERROR_STOP=1",
                         "-h", "127.0.0.1", "-p", "5432", "-U", "postgres", "-d", "postgres"]
        self.assertEqual(arguments, [expected_args, expected_args])
        prerequisites, receipt = recovery.recover((ROOT / recovery.SOURCE_PATH).read_bytes())
        self.assertEqual(sql, [prerequisites, replay.transform(self.source)])
        self.assertEqual(source, self.source)
        receipt_bytes = (json.dumps(receipt, sort_keys=True, indent=2) + "\n").encode()
        recovery_script = ROOT / "backend/supabase/scripts/recover_public_index_dedup_replay_prerequisites.py"
        self.assertEqual(chain, [
            "public-index-dedup-prerequisite-source\t" + recovery.SOURCE_SHA256,
            "public-index-dedup-prerequisite-generator\t" + hashlib.sha256(recovery_script.read_bytes()).hexdigest(),
            "public-index-dedup-prerequisite-sql\t" + hashlib.sha256(prerequisites).hexdigest(),
            "public-index-dedup-prerequisite-receipt\t" + hashlib.sha256(receipt_bytes).hexdigest(),
            "public-index-dedup-pg15-replay-transformer\t" + hashlib.sha256(SCRIPT.read_bytes()).hexdigest(),
            "public-index-dedup-pg15-replay:" + replay.NAME + "\t" + REPLAY_SHA256,
        ])

    def test_generator_preserves_psql_failure_instead_of_skipping_the_body(self) -> None:
        result, arguments, sql, chain, source = self._dispatch(psql_exit=3)
        self.assertEqual(result.returncode, 3)
        self.assertEqual(len(arguments), 2)
        self.assertEqual(sql[-1], replay.transform(self.source))
        self.assertEqual(len(chain), 6)
        self.assertEqual(source, self.source)

    def test_generator_stops_before_dedup_when_prerequisite_execution_fails(self) -> None:
        result, arguments, sql, _, source = self._dispatch(psql_exit=7, fail_call=1)
        self.assertEqual(result.returncode, 7)
        self.assertEqual(len(arguments), 1)
        prerequisites, _ = recovery.recover((ROOT / recovery.SOURCE_PATH).read_bytes())
        self.assertEqual(sql, [prerequisites])
        self.assertEqual(source, self.source)

    def test_generator_rejects_source_drift_before_any_psql_execution(self) -> None:
        changed = self.source + b"\n"
        result, arguments, sql, chain, source = self._dispatch(source=changed)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b"PUBLIC_INDEX_DEDUP_PG15_REPLAY_SOURCE_DRIFT", result.stderr)
        self.assertEqual(arguments, [])
        self.assertEqual(sql, [])
        self.assertEqual(chain, [])
        self.assertEqual(source, changed)

    def test_generator_rejects_baseline_drift_before_any_psql_execution(self) -> None:
        baseline = (ROOT / recovery.SOURCE_PATH).read_bytes()
        result, arguments, sql, chain, source = self._dispatch(prerequisite_source=baseline + b"\n")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b"PUBLIC_INDEX_DEDUP_REPLAY_PREREQUISITE_SOURCE_DRIFT", result.stderr)
        self.assertEqual(arguments, [])
        self.assertEqual(sql, [])
        self.assertEqual(chain, [])
        self.assertEqual(source, self.source)


if __name__ == "__main__":
    unittest.main()
