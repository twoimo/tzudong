"""Unit tests for the committed Tooling_Selection_Record artifact.

Covers task 28 (Requirements 11.1, 11.2, 11.3, 11.4, 11.6, 11.7, 11.10): assert
the committed ``backend/deploy/tooling-selection.v1.json`` parses and holds the
Requirement 11 invariants:

  * exactly 12 categories = the 11 categories of Requirement 11.1 + local
    kubernetes (Requirement 11.1, plus the design C7 added category);
  * every category enumerates 2..6 candidates, each with a globally unique
    candidate id (Requirement 11.1);
  * every candidate records exactly one pinned image tag / package version with
    no ``latest``, floating alias, or version-range notation (Requirement 11.3);
  * the design-confirmed adopted pins are present verbatim
    (Zot v2.1.20, Argo CD v3.5.2, Loki 3.7.7, kafbat kafka-ui v1.5.0, Helm
    4.2.4, OpenTofu 1.12.6, k3d 5.9.0, and the pinned otel 0.120.0 /
    grafana 11.5.2 assets);
  * the three empirical measurement fields (``macosLocalInstallSucceeded``,
    ``installVerifyObservation``, ``residentMemoryMiBAt300s``) are left null and
    not estimated (Requirement 11.2, task 28);
  * every category operator approval is unresolved with a null approver name
    (Requirement 11.4, task 28);
  * every not-adopted candidate cites a measured evaluation item and its value
    (Requirement 11.7);
  * the current-asset keep/replace/retire decisions and rollback procedures are
    recorded for the enumerated existing assets (Requirement 11.6); and
  * the record contains no credential / token / registry-secret /
    Forbidden_Log_Field substrings (Requirement 11.10).

Runnable via ``python -m unittest``.
"""

from __future__ import annotations

import json
import os
import re
import unittest

_LEDGER_PATH = os.path.normpath(
    os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "..",
        "deploy",
        "tooling-selection.v1.json",
    )
)

# The 11 Requirement 11.1 categories + the design C7 "local kubernetes" category.
_EXPECTED_CATEGORIES = {
    "container_registry",
    "image_registry_address_scheme",
    "deploy_tool",
    "dashboard_tool",
    "message_broker",
    "broker_management_ui",
    "service_mesh",
    "search_log_store",
    "log_collector",
    "package_manager_chart",
    "iac",
    "local_kubernetes",
}

# Design C7 confirmed adopted pins that must appear verbatim.
_CONFIRMED_ADOPTED_PINS = {
    "registry.zot": "ghcr.io/project-zot/zot-linux-arm64:v2.1.20",
    "deploy.argocd": "quay.io/argoproj/argocd:v3.5.2",
    "store.loki": "grafana/loki:3.7.7",
    "broker_ui.kafbat": "ghcr.io/kafbat/kafka-ui:v1.5.0",
    "chart.helm": "4.2.4",
    "iac.opentofu": "1.12.6",
    "k8s.k3d": "5.9.0",
    "collector.otel": "otel/opentelemetry-collector:0.120.0",
    "dashboard.grafana": "grafana/grafana:11.5.2",
}

# The three empirical fields that must stay null (never estimated).
_NULL_MEASUREMENT_FIELDS = (
    "macosLocalInstallSucceeded",
    "installVerifyObservation",
    "residentMemoryMiBAt300s",
)

# Clause-2 measured evaluation items a not-adopted reason may cite.
_MEASURED_ITEMS = {
    "replacedTreeFileCount",
    "alwaysOnProcessCount",
    "versionUpdateCadence",
    "manualRecoverySteps",
    "residentMemoryMiBAt300s",
    "macosLocalInstallSucceeded",
    "installVerifyObservation",
    "paidMigrationTargetForm",
    "unresolvedItems",
}

# Substrings that would signal a leaked credential / token / secret (11.10).
_FORBIDDEN_SUBSTRINGS = (
    "password",
    "passwd",
    "secret",
    "token",
    "credential",
    "private key",
    "-----begin",
    "bearer ",
    "apikey",
    "api_key",
    "access_key",
    "authorization:",
)

# Floating / range notation forbidden by 11.3 for pinned reference strings.
_RANGE_TOKENS = ("^", "~", ">=", "<=", "||", ">", "<", " - ")


class ToolingSelectionRecordTests(unittest.TestCase):
    def setUp(self) -> None:
        with open(_LEDGER_PATH, "r", encoding="utf-8") as handle:
            self.raw = handle.read()
        self.doc = json.loads(self.raw)
        self.categories = self.doc["categories"]

    def _all_candidates(self):
        for category in self.categories:
            for candidate in category["candidates"]:
                yield category, candidate

    def test_parses_as_json_object(self) -> None:
        self.assertIsInstance(self.doc, dict)
        self.assertEqual(self.doc.get("schemaVersion"), 1)
        self.assertEqual(self.doc.get("kind"), "tooling_selection_record")

    def test_exactly_twelve_categories(self) -> None:
        # Requirement 11.1: 11 categories + local kubernetes (design C7).
        names = [c["category"] for c in self.categories]
        self.assertEqual(len(names), 12)
        self.assertEqual(len(set(names)), 12, "category names must be unique")
        self.assertEqual(set(names), _EXPECTED_CATEGORIES)
        self.assertEqual(self.doc.get("categoryCount"), 12)

    def test_each_category_has_two_to_six_candidates(self) -> None:
        for category in self.categories:
            count = len(category["candidates"])
            self.assertGreaterEqual(count, 2, category["category"])
            self.assertLessEqual(count, 6, category["category"])

    def test_candidate_ids_globally_unique(self) -> None:
        ids = [cand["candidateId"] for _, cand in self._all_candidates()]
        self.assertEqual(len(ids), len(set(ids)), "candidate ids must be unique")

    def test_no_latest_floating_or_range_pins(self) -> None:
        # Requirement 11.3: exactly one pinned reference, no latest/floating/range.
        for _, cand in self._all_candidates():
            ref = cand["imageTag"]
            self.assertIsInstance(ref, str)
            self.assertTrue(ref.strip(), "pinned reference must be non-empty")
            lowered = ref.lower()
            self.assertNotIn("latest", lowered, ref)
            self.assertNotIn("*", ref, ref)
            for token in _RANGE_TOKENS:
                self.assertNotIn(token, ref, f"range token {token!r} in {ref!r}")
            # Wildcard version segments like 1.2.x / 1.x are forbidden.
            self.assertIsNone(re.search(r"\.x(\b|$)", ref), ref)
            kind = cand["referenceKind"]
            if kind == "image_tag":
                # An image reference must carry a concrete (non-empty) tag.
                self.assertIn(":", ref, f"image_tag must be tagged: {ref!r}")
                tag = ref.rsplit(":", 1)[1]
                self.assertTrue(tag, ref)
                self.assertNotEqual(tag.lower(), "latest", ref)
            elif kind == "package_version":
                self.assertIsNotNone(
                    re.search(r"\d+\.\d+", ref), f"version-like pin required: {ref!r}"
                )

    def test_confirmed_adopted_pins_present_verbatim(self) -> None:
        by_id = {cand["candidateId"]: cand for _, cand in self._all_candidates()}
        for candidate_id, expected in _CONFIRMED_ADOPTED_PINS.items():
            self.assertIn(candidate_id, by_id, candidate_id)
            self.assertTrue(by_id[candidate_id]["adopted"], candidate_id)
            self.assertEqual(by_id[candidate_id]["imageTag"], expected, candidate_id)

    def test_measurement_fields_are_null(self) -> None:
        # Requirement 11.2 + task 28: never estimate these three fields.
        for _, cand in self._all_candidates():
            for field in _NULL_MEASUREMENT_FIELDS:
                self.assertIn(field, cand, cand["candidateId"])
                self.assertIsNone(cand[field], f"{cand['candidateId']}.{field}")

    def test_operator_approval_unresolved_with_null_approver(self) -> None:
        # Requirement 11.4 + task 28: approval unresolved, approverName null.
        for category in self.categories:
            approval = category["operatorApproval"]
            self.assertIsNone(approval["approverName"], category["category"])
            self.assertIsNone(approval["approvedAt"], category["category"])
            self.assertEqual(approval["status"], "unresolved", category["category"])
            self.assertEqual(approval["category"], category["category"])

    def test_selected_candidate_exists_and_is_adopted(self) -> None:
        for category in self.categories:
            selected = category["operatorApproval"]["selectedCandidateId"]
            match = [
                c for c in category["candidates"] if c["candidateId"] == selected
            ]
            self.assertEqual(len(match), 1, f"selected id resolves once: {selected}")
            self.assertTrue(match[0]["adopted"], selected)

    def test_exactly_one_adopted_per_category(self) -> None:
        for category in self.categories:
            adopted = [c for c in category["candidates"] if c["adopted"]]
            self.assertEqual(len(adopted), 1, category["category"])

    def test_not_adopted_reason_cites_measured_item(self) -> None:
        # Requirement 11.7: a not-adopted reason must cite a measured item value.
        for _, cand in self._all_candidates():
            reason = cand["notAdoptedReason"]
            if cand["adopted"]:
                self.assertIsNone(reason, cand["candidateId"])
                continue
            self.assertIsNotNone(reason, cand["candidateId"])
            item = reason["citedMeasuredItem"]
            self.assertIn(item, _MEASURED_ITEMS, cand["candidateId"])
            self.assertIsNotNone(reason["citedMeasuredValue"], cand["candidateId"])
            self.assertTrue(reason["summary"].strip(), cand["candidateId"])
            # The cited value must equal the candidate's recorded measured value.
            self.assertEqual(
                reason["citedMeasuredValue"], cand[item], cand["candidateId"]
            )

    def test_current_asset_decisions_recorded(self) -> None:
        # Requirement 11.6: keep/replace/retire + rollback for existing assets.
        decisions = self.doc["currentAssetDecisions"]
        assets = {d["asset"] for d in decisions}
        required = {
            "otel/opentelemetry-collector:0.120.0",
            "prom/prometheus:v3.2.1",
            "grafana/grafana:11.5.2",
            "apache/kafka:3.9.0",
            "provectuslabs/kafka-ui:v0.7.2",
            "docker.elastic.co/elasticsearch/elasticsearch:8.17.0",
            "harbor.local/tzudong tag convention",
        }
        self.assertTrue(required.issubset(assets), assets)
        for decision in decisions:
            self.assertIn(decision["decision"], {"keep", "replace", "retire"})
            self.assertTrue(decision["rollbackProcedure"].strip())
            if decision["decision"] == "replace":
                self.assertIsNotNone(decision["replacementCandidateId"])
        replace = [d for d in decisions if d["decision"] == "replace"]
        self.assertEqual(len(replace), 1)
        self.assertEqual(replace[0]["asset"], "provectuslabs/kafka-ui:v0.7.2")
        self.assertEqual(replace[0]["replacementCandidateId"], "broker_ui.kafbat")

    def test_no_forbidden_secret_substrings(self) -> None:
        # Requirement 11.10: no credentials/tokens/registry secrets.
        lowered = self.raw.lower()
        for needle in _FORBIDDEN_SUBSTRINGS:
            self.assertNotIn(needle, lowered, f"forbidden substring present: {needle}")


if __name__ == "__main__":
    unittest.main()
