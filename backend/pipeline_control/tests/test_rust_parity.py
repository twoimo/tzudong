"""Task 43 Parity_Harness: normalization, comparison, the 600s budget, the N=3
default-switch gate, artifact-change reset, readback verification, python-removal
gating, and the injected-recorder persistence boundary.

Covers the requirement-2 parity-evidence contract:

- 2.1/2.2/2.3: ``run_parity`` feeds one input to both implementations, applies
  normalization rule ``v1``, and produces a Parity_Result carrying matched, one
  input id, the rule id, the artifact id, the compared-field set, and at most 50
  mismatch field *names* plus the full count — never a field value.
- 2.9: a 600s overrun or abnormal termination yields ``matched=false`` +
  ``parity_run_incomplete`` with no partial comparison.
- 2.4/2.5: the N=3 gate counts distinct-input, same-artifact, non-empty,
  uninterrupted matched results and excludes empty comparisons; fewer than three
  yields ``parity_evidence_insufficient``.
- 2.10: an artifact-id change resets the count to 0 and reverts to python.
- 2.11: a readback that differs from the recorded evidence reverts to python.
- 2.6: python removal requires a separate explicit candidate with a ledger or
  operator approval reference.
- design D2: recording goes through an injected recorder and holds names only.
"""

from __future__ import annotations

import hashlib
import importlib.machinery
import multiprocessing
import os
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

from backend.pipeline_control import rust_parity as rp


def _match_impl(payload):
    return {"a": 1, "b": 2, "generated_at": "x"}


def _diff_rust(payload):
    return {"a": 1, "b": 999, "duration_ms": 5}


class NormalizationTests(unittest.TestCase):
    def test_v1_drops_nondeterministic_and_sorts(self) -> None:
        norm = rp.normalize_output(
            {"b": 2, "a": 1, "generated_at": "x", "pid": 9}, "v1"
        )
        self.assertEqual(list(norm.keys()), ["a", "b"])
        self.assertNotIn("generated_at", norm)
        self.assertNotIn("pid", norm)

    def test_unknown_rule_raises(self) -> None:
        with self.assertRaises(KeyError):
            rp.normalize_output({"a": 1}, "v99")


class CompareTests(unittest.TestCase):
    def test_identical_after_normalization_matches(self) -> None:
        result = rp.compare_normalized({"a": 1, "b": 2}, {"a": 1, "b": 2})
        self.assertTrue(result["matched"])
        self.assertEqual(result["compared_fields"], ["a", "b"])
        self.assertEqual(result["mismatch_field_count"], 0)

    def test_mismatch_records_names_only_and_bounds_50(self) -> None:
        py = {f"f{i}": i for i in range(60)}
        rust = {f"f{i}": i + 1 for i in range(60)}
        result = rp.compare_normalized(py, rust)
        self.assertFalse(result["matched"])
        self.assertEqual(result["mismatch_field_count"], 60)
        self.assertEqual(len(result["mismatch_fields"]), rp.MAX_MISMATCH_FIELDS)
        # Names only — no values leak into the record.
        for name in result["mismatch_fields"]:
            self.assertIsInstance(name, str)

    def test_field_present_in_one_side_is_mismatch(self) -> None:
        result = rp.compare_normalized({"a": 1}, {"a": 1, "b": 2})
        self.assertFalse(result["matched"])
        self.assertEqual(result["mismatch_fields"], ["b"])


class RunParityTests(unittest.TestCase):
    def test_matched_result_shape(self) -> None:
        result = rp.run_parity(
            "R1-validators",
            "input-1",
            {"any": "payload"},
            python_impl=_match_impl,
            rust_impl=lambda p: {"a": 1, "b": 2, "duration_ms": 7},
            rust_artifact_id="tzudong_validators@sha256:abc",
        )
        self.assertTrue(result["matched"])
        self.assertEqual(result["input_id"], "input-1")
        self.assertEqual(result["normalization_rule_id"], "v1")
        self.assertEqual(result["rust_artifact_id"], "tzudong_validators@sha256:abc")
        self.assertEqual(result["compared_fields"], ["a", "b"])
        self.assertIsNone(result["result_code"])

    def test_mismatch_result(self) -> None:
        result = rp.run_parity(
            "R1-validators",
            "input-2",
            {},
            python_impl=_match_impl,
            rust_impl=_diff_rust,
            rust_artifact_id="art-1",
        )
        self.assertFalse(result["matched"])
        self.assertIn("b", result["mismatch_fields"])
        self.assertNotIn("generated_at", result["compared_fields"])

    def test_timeout_yields_parity_run_incomplete(self) -> None:
        def _hang(payload):
            time.sleep(1.0)
            return {"a": 1}

        result = rp.run_parity(
            "R1-validators",
            "input-3",
            {},
            python_impl=_hang,
            rust_impl=lambda p: {"a": 1},
            rust_artifact_id="art-1",
            timeout_seconds=0.1,
        )
        self.assertFalse(result["matched"])
        self.assertEqual(result["result_code"], rp.CODE_PARITY_RUN_INCOMPLETE)
        self.assertEqual(result["compared_fields"], [])
        self.assertEqual(result["mismatch_fields"], [])

    def test_timeout_reaps_implementations_and_delayed_descendants(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            marker = Path(raw) / "late-write"
            child = "import time,pathlib;time.sleep(0.4);pathlib.Path(%r).write_text('late')" % str(marker)
            def hangs(_):
                signal.signal(signal.SIGTERM, signal.SIG_IGN)
                descendant = subprocess.Popen([sys.executable, "-c", child])
                self.assertIsNotNone(descendant.pid)
                time.sleep(5)
                marker.write_text("parent")
                return {"a": 1}
            existing = {p.pid for p in multiprocessing.active_children()}
            result = rp.run_parity("R1", "timeout", {}, python_impl=hangs,
                rust_impl=hangs, rust_artifact_id="art", timeout_seconds=0.15)
            self.assertEqual(result["result_code"], rp.CODE_PARITY_RUN_INCOMPLETE)
            self.assertEqual({p.pid for p in multiprocessing.active_children()}, existing)
            time.sleep(0.5)
            self.assertFalse(marker.exists(), "work continued after timeout")

    def test_transport_never_silently_normalizes_unsupported_types(self) -> None:
        result = rp.run_parity("R1", "types", {},
            python_impl=lambda _: {"a": (1, 2)},
            rust_impl=lambda _: {"a": [1, 2]}, rust_artifact_id="art")
        self.assertFalse(result["matched"])
        self.assertEqual(result["result_code"], rp.CODE_PARITY_RUN_INCOMPLETE)

    def test_each_implementation_has_its_own_payload(self) -> None:
        payload = {"items": []}
        def mutates(value):
            value["items"].append("one")
            return {"count": len(value["items"])}
        result = rp.run_parity("R1", "isolated", payload, python_impl=mutates,
            rust_impl=mutates, rust_artifact_id="art")
        self.assertTrue(result["matched"])
        self.assertEqual(payload, {"items": []})

    def test_large_pipe_output_does_not_deadlock(self) -> None:
        result = rp.run_parity("R1", "large", {},
            python_impl=lambda _: {"a": "x" * 200000},
            rust_impl=lambda _: {"a": "x" * 200000}, rust_artifact_id="art",
            timeout_seconds=3)
        self.assertTrue(result["matched"])

    def test_oversized_or_invalid_budget_fails_closed(self) -> None:
        for budget in (0, -1, float("inf"), float("nan")):
            result = rp.run_parity("R1", "invalid", {}, python_impl=_match_impl,
                rust_impl=_match_impl, rust_artifact_id="art", timeout_seconds=budget)
            self.assertEqual(result["result_code"], rp.CODE_PARITY_RUN_INCOMPLETE)
        result = rp.run_parity("R1", "oversized", {},
            python_impl=lambda _: {"a": "x" * rp._MAX_OUTPUT_BYTES},
            rust_impl=_match_impl, rust_artifact_id="art")
        self.assertEqual(result["result_code"], rp.CODE_PARITY_RUN_INCOMPLETE)

    def test_abnormal_termination_yields_incomplete(self) -> None:
        def _boom(payload):
            raise RuntimeError("provider diagnostic that must not leak")

        result = rp.run_parity(
            "R1-validators",
            "input-4",
            {},
            python_impl=lambda p: {"a": 1},
            rust_impl=_boom,
            rust_artifact_id="art-1",
        )
        self.assertFalse(result["matched"])
        self.assertEqual(result["result_code"], rp.CODE_PARITY_RUN_INCOMPLETE)
        # No free-form error text anywhere in the bounded result.
        self.assertNotIn("provider diagnostic", repr(result))


class ArtifactIdTests(unittest.TestCase):
    def test_artifact_id_from_bytes(self) -> None:
        art = rp.compute_artifact_id("tzudong_validators", module_bytes=b"abc")
        expected = hashlib.sha256(b"abc").hexdigest()
        self.assertEqual(art, f"tzudong_validators@sha256:{expected}")

    def test_missing_source_raises(self) -> None:
        with self.assertRaises(ValueError):
            rp.compute_artifact_id("crate")

    def test_package_init_resolves_the_single_extension_artifact(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            package = Path(raw)
            init = package / "__init__.py"
            init.write_bytes(b"python shim")
            extension = package / (
                "tzudong_validators" + importlib.machinery.EXTENSION_SUFFIXES[0]
            )
            extension.write_bytes(b"compiled extension")
            expected = hashlib.sha256(extension.read_bytes()).hexdigest()
            self.assertEqual(
                rp.compute_artifact_id("tzudong-validators", module_path=init),
                f"tzudong-validators@sha256:{expected}",
            )

    def test_package_init_rejects_ambiguous_extension_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            package = Path(raw)
            init = package / "__init__.py"
            init.write_bytes(b"python shim")
            suffix = importlib.machinery.EXTENSION_SUFFIXES[0]
            (package / f"one{suffix}").write_bytes(b"one")
            (package / f"two{suffix}").write_bytes(b"two")
            with self.assertRaises(ValueError):
                rp.compute_artifact_id("tzudong-validators", module_path=init)


def _matched(input_id, artifact="art-1", fields=("a",)):
    return {
        "input_id": input_id,
        "rust_artifact_id": artifact,
        "matched": True,
        "compared_fields": list(fields),
    }


def _unmatched(input_id, artifact="art-1"):
    return {
        "input_id": input_id,
        "rust_artifact_id": artifact,
        "matched": False,
        "compared_fields": ["a"],
    }


class GateTests(unittest.TestCase):
    def test_three_synthetic_matches_cannot_allow_switch(self) -> None:
        results = [_matched("i1"), _matched("i2"), _matched("i3")]
        decision = rp.evaluate_default_switch("R1", results, "art-1")
        self.assertFalse(decision["allowed"])
        self.assertEqual(decision["defaultImplementation"], rp.IMPL_PYTHON)

    def test_fewer_than_three_is_insufficient(self) -> None:
        results = [_matched("i1"), _matched("i2")]
        decision = rp.evaluate_default_switch("R1", results, "art-1")
        self.assertFalse(decision["allowed"])
        self.assertEqual(decision["code"], rp.CODE_PARITY_EVIDENCE_INSUFFICIENT)
        self.assertEqual(decision["defaultImplementation"], rp.IMPL_PYTHON)

    def test_empty_comparison_excluded_from_count(self) -> None:
        results = [
            _matched("i1"),
            _matched("iEmpty", fields=()),  # excluded, does not count/break
            _matched("i2"),
            _matched("i3"),
        ]
        self.assertEqual(rp.consecutive_matched_count(results, "art-1"), 3)

    def test_matched_false_breaks_streak(self) -> None:
        results = [_matched("i1"), _unmatched("i2"), _matched("i3"), _matched("i4")]
        # Only i3, i4 after the break -> 2.
        self.assertEqual(rp.consecutive_matched_count(results, "art-1"), 2)

    def test_distinct_input_required(self) -> None:
        results = [_matched("i1"), _matched("i1"), _matched("i1")]
        self.assertEqual(rp.consecutive_matched_count(results, "art-1"), 1)

    def test_other_artifact_ignored(self) -> None:
        results = [
            _matched("i1", artifact="other"),
            _matched("i2"),
            _matched("i3"),
            _matched("i4"),
        ]
        self.assertEqual(rp.consecutive_matched_count(results, "art-1"), 3)


class ArtifactChangeTests(unittest.TestCase):
    def test_change_resets_and_reverts_python(self) -> None:
        entry = {
            "rustArtifactId": "old",
            "consecutiveMatchedCount": 3,
            "activeImplementation": "rust",
        }
        updated = rp.apply_artifact_change(entry, "new")
        self.assertEqual(updated["consecutiveMatchedCount"], 0)
        self.assertEqual(updated["activeImplementation"], rp.IMPL_PYTHON)
        self.assertEqual(updated["rustArtifactId"], "new")
        # Input not mutated.
        self.assertEqual(entry["consecutiveMatchedCount"], 3)

    def test_same_artifact_unchanged(self) -> None:
        entry = {
            "rustArtifactId": "same",
            "consecutiveMatchedCount": 3,
            "activeImplementation": "rust",
        }
        updated = rp.apply_artifact_change(entry, "same")
        self.assertEqual(updated["consecutiveMatchedCount"], 3)
        self.assertEqual(updated["activeImplementation"], "rust")


class ReadbackTests(unittest.TestCase):
    def test_matching_unretained_objects_cannot_claim_an_applied_switch(self) -> None:
        evidence = {
            "inputIds": ["i1", "i2", "i3"],
            "rustArtifactId": "art-1",
            "activeImplementation": "rust",
        }
        decision = rp.verify_switch_readback(evidence, dict(evidence))
        self.assertFalse(decision["verified"])
        self.assertEqual(decision["defaultImplementation"], rp.IMPL_PYTHON)

    def test_divergent_readback_reverts_python(self) -> None:
        evidence = {
            "inputIds": ["i1", "i2", "i3"],
            "rustArtifactId": "art-1",
            "activeImplementation": "rust",
        }
        readback = dict(evidence, inputIds=["i1", "i2", "iX"])
        decision = rp.verify_switch_readback(evidence, readback)
        self.assertFalse(decision["verified"])
        self.assertEqual(decision["defaultImplementation"], rp.IMPL_PYTHON)


class PythonRemovalTests(unittest.TestCase):
    def test_separate_with_unverified_ledger_ref_rejected(self) -> None:
        result = rp.check_python_removal_candidate(
            {"separateExplicitCandidate": True, "ledgerParityRef": "R1#n3"}
        )
        self.assertFalse(result["admitted"])

    def test_not_separate_rejected(self) -> None:
        result = rp.check_python_removal_candidate(
            {"separateExplicitCandidate": False, "ledgerParityRef": "R1#n3"}
        )
        self.assertFalse(result["admitted"])
        self.assertEqual(result["code"], rp.CODE_PYTHON_REMOVAL_NOT_SEPARATE)

    def test_no_reference_rejected(self) -> None:
        result = rp.check_python_removal_candidate(
            {"separateExplicitCandidate": True}
        )
        self.assertFalse(result["admitted"])
        self.assertEqual(result["code"], rp.CODE_PYTHON_REMOVAL_EVIDENCE_MISSING)


class RecordingTests(unittest.TestCase):
    def test_injected_recorder_receives_names_only(self) -> None:
        captured = []
        result = {
            "slice_id": "R1",
            "input_id": "i1",
            "rust_artifact_id": "art-1",
            "normalization_rule_id": "v1",
            "matched": False,
            "compared_fields": ["a", "b"],
            "mismatch_fields": ["b"],
            "mismatch_field_count": 1,
            "result_code": None,
        }
        envelope = rp.record_parity_result(result, recorder=captured.append)
        self.assertTrue(envelope["recorded"])
        row = captured[0]
        self.assertEqual(row["mismatch_fields"], ["b"])
        self.assertEqual(row["mismatch_field_count"], 1)
        # The row carries no value fields.
        self.assertNotIn("compared_values", row)

    def test_missing_recorder_fails_closed(self) -> None:
        result = {
            "slice_id": "R1",
            "input_id": "i1",
            "rust_artifact_id": "art-1",
            "normalization_rule_id": "v1",
            "matched": True,
            "compared_fields": ["a"],
            "mismatch_fields": [],
            "mismatch_field_count": 0,
            "result_code": None,
        }
        envelope = rp.record_parity_result(result, recorder=None)
        self.assertFalse(envelope["recorded"])
        self.assertIn("row", envelope)

    def test_row_bounds_mismatch_names_to_50(self) -> None:
        names = [f"f{i}" for i in range(80)]
        row = rp.build_parity_row(
            {
                "slice_id": "R1",
                "input_id": "i1",
                "rust_artifact_id": "art-1",
                "normalization_rule_id": "v1",
                "matched": False,
                "compared_fields": names,
                "mismatch_fields": names,
                "mismatch_field_count": 80,
            }
        )
        self.assertEqual(len(row["mismatch_fields"]), 50)
        self.assertEqual(row["mismatch_field_count"], 80)


if __name__ == "__main__":
    unittest.main()
