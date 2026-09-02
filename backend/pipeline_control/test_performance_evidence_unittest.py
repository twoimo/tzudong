"""Unit tests for performance evidence path separation and claim discipline.

Feature: platform-modernization, Task 45 (Requirement 3; design C1, D3).

Covers the pure-logic discipline in
``backend/pipeline_control/performance_evidence.py``:

  * two-directional evidence path separation — Rust_Component raw artifacts only
    under ``backend/performance/`` and never under ``apps/web/performance/*``,
    canonical budget input only under ``apps/web/performance/*`` and never under
    the backend tree; either-direction violation returns
    ``performance_evidence_path_violation`` (Requirements 3.6, 3.9);
  * Performance_Evidence_Set structure — required fields, three budgets, a
    repetition count at/above the metric minimum, and the ``p75`` summary
    statistic (Requirement 3.2, design D3);
  * noise judgment — an observed improvement whose absolute value is at or below
    the metric noise budget is a valid ``no_admitted_slice`` result, never a
    failure or rerun (Requirement 3.4);
  * frozen tree — start/end commit equality plus both-clean flags
    (Requirements 3.5, 3.8);
  * artifact-map retrieval / hash match, failing closed with no resolver
    (Requirement 3.3);
  * claim establishment and the merge-candidate gate (Requirements 3.1, 3.7);
  * the three canonical backend metric budgets mirror
    ``apps/web/performance/performance-budgets.v1.json`` (design D3 table).

Runnable via ``python -m unittest``.
"""

from __future__ import annotations

import json
import os
import unittest

from backend.pipeline_control import performance_evidence as pe

_BUDGETS_PATH = os.path.normpath(
    os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "..",
        "..",
        "apps",
        "web",
        "performance",
        "performance-budgets.v1.json",
    )
)


def _valid_frozen_tree() -> dict:
    return {
        "startCommit": "abc123",
        "startClean": True,
        "endCommit": "abc123",
        "endClean": True,
    }


def _valid_evidence_set(**overrides) -> dict:
    base = {
        "evidenceSetId": "R1-validators.2026.001",
        "sliceId": "R1-validators",
        "metricKey": "backend.delta_total_p75_ms",
        "absoluteBudget": {"value": 3_600_000, "unit": "ms"},
        "relativeBudget": {"thresholdBasisPoints": 1000, "unit": "basis_points"},
        "noiseBudget": {"value": 30_000, "unit": "ms"},
        "baselineMeasurementId": "python.R1-validators.2026.001",
        "repetitionCount": 7,
        "summaryStatistic": "p75",
        "environmentProfileId": "macos-arm64-local",
        "frozenTree": _valid_frozen_tree(),
        "rawArtifactPaths": ["backend/performance/raw/R1-validators/run-1.ndjson"],
        "canonicalBudgetInputRef": pe.CANONICAL_BUDGET_INPUT_REF,
        "artifactMapSha256": "deadbeef",
    }
    base.update(overrides)
    return base


class PathSeparationTests(unittest.TestCase):
    def test_valid_separation_passes(self):
        result = pe.check_evidence_path_separation(
            ["backend/performance/raw/x.ndjson"],
            ["apps/web/performance/performance-budgets.v1.json"],
        )
        self.assertTrue(result["ok"])
        self.assertIsNone(result["code"])

    def test_raw_artifact_under_web_tree_violates(self):
        result = pe.check_evidence_path_separation(
            ["apps/web/performance/raw/x.ndjson"], []
        )
        self.assertFalse(result["ok"])
        self.assertEqual(result["code"], pe.CODE_PATH_VIOLATION)

    def test_raw_artifact_outside_backend_tree_violates(self):
        result = pe.check_evidence_path_separation(["backend/other/x.ndjson"], [])
        self.assertFalse(result["ok"])
        self.assertEqual(result["code"], pe.CODE_PATH_VIOLATION)

    def test_budget_input_under_backend_tree_violates(self):
        result = pe.check_evidence_path_separation(
            [], ["backend/performance/performance-budgets.v1.json"]
        )
        self.assertFalse(result["ok"])
        self.assertEqual(result["code"], pe.CODE_PATH_VIOLATION)

    def test_budget_input_outside_web_tree_violates(self):
        result = pe.check_evidence_path_separation([], ["backend/deploy/budgets.json"])
        self.assertFalse(result["ok"])
        self.assertEqual(result["code"], pe.CODE_PATH_VIOLATION)

    def test_leading_dot_slash_is_normalized(self):
        result = pe.check_evidence_path_separation(
            ["./backend/performance/raw/x.ndjson"],
            ["./apps/web/performance/performance-budgets.v1.json"],
        )
        self.assertTrue(result["ok"])

    def test_backslash_paths_are_normalized(self):
        self.assertTrue(pe.is_backend_performance_path("backend\\performance\\raw\\x"))
        self.assertTrue(pe.is_web_performance_path("apps\\web\\performance\\x"))


class NoiseJudgmentTests(unittest.TestCase):
    def test_improvement_within_noise_is_no_admitted_slice(self):
        result = pe.judge_improvement(100, 120, 30)
        self.assertEqual(result["judgment"], pe.RESULT_NO_ADMITTED_SLICE)
        self.assertTrue(result["isValidResult"])
        self.assertFalse(result["isFailure"])

    def test_improvement_exactly_at_noise_is_no_admitted_slice(self):
        result = pe.judge_improvement(100, 130, 30)
        self.assertEqual(result["judgment"], pe.RESULT_NO_ADMITTED_SLICE)

    def test_improvement_beyond_noise_is_admitted_slice(self):
        result = pe.judge_improvement(100, 131, 30)
        self.assertEqual(result["judgment"], pe.RESULT_ADMITTED_SLICE)
        self.assertTrue(result["isValidResult"])
        self.assertFalse(result["isFailure"])

    def test_regression_within_noise_is_still_no_admitted_slice(self):
        # A negative improvement (regression) whose magnitude is within noise is
        # still a valid no_admitted_slice result.
        result = pe.judge_improvement(120, 100, 30)
        self.assertEqual(result["improvement"], -20)
        self.assertEqual(result["judgment"], pe.RESULT_NO_ADMITTED_SLICE)


class FrozenTreeTests(unittest.TestCase):
    def test_valid_tree(self):
        self.assertTrue(pe.is_frozen_tree_valid(_valid_frozen_tree()))

    def test_commit_mismatch_invalid(self):
        tree = _valid_frozen_tree()
        tree["endCommit"] = "different"
        self.assertFalse(pe.is_frozen_tree_valid(tree))

    def test_not_clean_invalid(self):
        tree = _valid_frozen_tree()
        tree["endClean"] = False
        self.assertFalse(pe.is_frozen_tree_valid(tree))

    def test_blank_commit_invalid(self):
        tree = _valid_frozen_tree()
        tree["startCommit"] = ""
        self.assertFalse(pe.is_frozen_tree_valid(tree))

    def test_non_mapping_invalid(self):
        self.assertFalse(pe.is_frozen_tree_valid(None))


class EvidenceSetStructureTests(unittest.TestCase):
    def test_valid_structure(self):
        self.assertTrue(pe.validate_evidence_set_structure(_valid_evidence_set())["ok"])

    def test_missing_required_field_rejected(self):
        s = _valid_evidence_set()
        del s["baselineMeasurementId"]
        result = pe.validate_evidence_set_structure(s)
        self.assertFalse(result["ok"])
        self.assertEqual(result["code"], pe.CODE_CLAIM_NOT_ESTABLISHED)

    def test_missing_budget_rejected(self):
        s = _valid_evidence_set(relativeBudget={})
        self.assertFalse(pe.validate_evidence_set_structure(s)["ok"])

    def test_repetition_below_minimum_rejected(self):
        s = _valid_evidence_set(repetitionCount=6)
        self.assertFalse(pe.validate_evidence_set_structure(s)["ok"])

    def test_boolean_repetition_rejected(self):
        s = _valid_evidence_set(repetitionCount=True)
        self.assertFalse(pe.validate_evidence_set_structure(s)["ok"])

    def test_wrong_summary_statistic_rejected(self):
        s = _valid_evidence_set(summaryStatistic="mean")
        self.assertFalse(pe.validate_evidence_set_structure(s)["ok"])

    def test_non_mapping_rejected(self):
        self.assertFalse(pe.validate_evidence_set_structure("nope")["ok"])


class ArtifactMapTests(unittest.TestCase):
    def test_no_resolver_fails_closed(self):
        result = pe.check_artifact_map(_valid_evidence_set(), artifact_resolver=None)
        self.assertFalse(result["ok"])
        self.assertEqual(result["code"], pe.CODE_CLAIM_NOT_ESTABLISHED)

    def test_blank_recorded_hash_fails_closed(self):
        s = _valid_evidence_set(artifactMapSha256=None)
        result = pe.check_artifact_map(
            s, artifact_resolver=lambda _s: {"retrieved": True, "artifactMapSha256": "x"}
        )
        self.assertFalse(result["ok"])

    def test_not_retrieved_rejected(self):
        result = pe.check_artifact_map(
            _valid_evidence_set(),
            artifact_resolver=lambda _s: {"retrieved": False, "artifactMapSha256": "deadbeef"},
        )
        self.assertFalse(result["ok"])

    def test_hash_mismatch_rejected(self):
        result = pe.check_artifact_map(
            _valid_evidence_set(),
            artifact_resolver=lambda _s: {"retrieved": True, "artifactMapSha256": "mismatch"},
        )
        self.assertFalse(result["ok"])

    def test_retrieved_and_matching_passes(self):
        result = pe.check_artifact_map(
            _valid_evidence_set(),
            artifact_resolver=lambda _s: {"retrieved": True, "artifactMapSha256": "deadbeef"},
        )
        self.assertTrue(result["ok"])


class EstablishClaimTests(unittest.TestCase):
    def _resolver_ok(self, _s):
        return {"retrieved": True, "artifactMapSha256": "deadbeef"}

    def test_full_chain_establishes(self):
        claim = {"evidenceSetId": "R1-validators.2026.001"}
        result = pe.establish_claim(
            claim, _valid_evidence_set(), artifact_resolver=self._resolver_ok
        )
        self.assertTrue(result["ok"])
        self.assertIsNone(result["code"])

    def test_missing_claim_id_not_established(self):
        result = pe.establish_claim({}, _valid_evidence_set())
        self.assertEqual(result["code"], pe.CODE_CLAIM_NOT_ESTABLISHED)

    def test_no_evidence_set_not_established(self):
        result = pe.establish_claim({"evidenceSetId": "x"}, None)
        self.assertEqual(result["code"], pe.CODE_CLAIM_NOT_ESTABLISHED)

    def test_id_mismatch_not_established(self):
        claim = {"evidenceSetId": "different"}
        result = pe.establish_claim(claim, _valid_evidence_set())
        self.assertEqual(result["code"], pe.CODE_CLAIM_NOT_ESTABLISHED)

    def test_path_violation_reported_with_path_code(self):
        claim = {"evidenceSetId": "R1-validators.2026.001"}
        bad = _valid_evidence_set(
            rawArtifactPaths=["apps/web/performance/raw/leak.ndjson"]
        )
        result = pe.establish_claim(claim, bad, artifact_resolver=self._resolver_ok)
        self.assertEqual(result["code"], pe.CODE_PATH_VIOLATION)

    def test_frozen_tree_change_not_established(self):
        claim = {"evidenceSetId": "R1-validators.2026.001"}
        tree = _valid_frozen_tree()
        tree["endCommit"] = "moved"
        bad = _valid_evidence_set(frozenTree=tree)
        result = pe.establish_claim(claim, bad, artifact_resolver=self._resolver_ok)
        self.assertEqual(result["code"], pe.CODE_CLAIM_NOT_ESTABLISHED)

    def test_structure_defect_not_established(self):
        claim = {"evidenceSetId": "R1-validators.2026.001"}
        bad = _valid_evidence_set(repetitionCount=3)
        result = pe.establish_claim(claim, bad, artifact_resolver=self._resolver_ok)
        self.assertEqual(result["code"], pe.CODE_CLAIM_NOT_ESTABLISHED)

    def test_artifact_failure_not_established(self):
        claim = {"evidenceSetId": "R1-validators.2026.001"}
        result = pe.establish_claim(claim, _valid_evidence_set(), artifact_resolver=None)
        self.assertEqual(result["code"], pe.CODE_CLAIM_NOT_ESTABLISHED)


class MergeCandidateGateTests(unittest.TestCase):
    def test_all_established_passes(self):
        claims = [
            {"evidenceSetId": "a", "established": True},
            {"evidenceSetId": "b"},
        ]
        self.assertTrue(pe.check_merge_candidate_claims(claims)["ok"])

    def test_empty_claims_passes(self):
        self.assertTrue(pe.check_merge_candidate_claims([])["ok"])

    def test_missing_evidence_id_rejected(self):
        result = pe.check_merge_candidate_claims([{"value": "3x faster"}])
        self.assertFalse(result["ok"])
        self.assertEqual(result["code"], pe.CODE_CLAIM_NOT_ESTABLISHED)

    def test_unestablished_flag_rejected(self):
        result = pe.check_merge_candidate_claims(
            [{"evidenceSetId": "a", "established": False}]
        )
        self.assertFalse(result["ok"])

    def test_unestablished_result_code_rejected(self):
        result = pe.check_merge_candidate_claims(
            [{"evidenceSetId": "a", "resultCode": pe.CODE_CLAIM_NOT_ESTABLISHED}]
        )
        self.assertFalse(result["ok"])


class CanonicalBudgetParityTests(unittest.TestCase):
    """The three backend metric budgets must mirror the canonical input (D3)."""

    def test_backend_budgets_match_canonical_file(self):
        with open(_BUDGETS_PATH, encoding="utf-8") as handle:
            budgets = {b["key"]: b for b in json.load(handle)["budgets"]}

        for metric_key, expected in pe.BACKEND_METRIC_BUDGETS.items():
            self.assertIn(metric_key, budgets, metric_key)
            canonical = budgets[metric_key]
            self.assertEqual(
                expected["absoluteBudget"]["value"],
                canonical["absoluteBudget"],
                f"absolute budget mismatch for {metric_key}",
            )
            self.assertEqual(
                expected["noiseBudget"]["value"],
                canonical["absoluteNoiseFloor"],
                f"noise budget mismatch for {metric_key}",
            )
            self.assertEqual(
                expected["sampleMinimum"],
                canonical["sampleMinimum"],
                f"sample minimum mismatch for {metric_key}",
            )
            self.assertEqual(expected["absoluteBudget"]["unit"], canonical["unit"])
            self.assertEqual(expected["sampleMinimum"], pe.MIN_BACKEND_SAMPLE_COUNT)
            self.assertEqual(expected["summaryStatistic"], pe.BACKEND_SUMMARY_STATISTIC)


if __name__ == "__main__":
    unittest.main()
