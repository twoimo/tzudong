"""Source contracts for the fail-closed migration-readiness manifest."""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from backend.pipeline_control import deployment_descriptor, evidence_state


ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "backend/deploy/migration-readiness.v1.json"
DESCRIPTORS = ROOT / "backend/deploy/deployment-descriptor-set.v1.json"


class MigrationReadinessManifestTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
        cls.descriptors = json.loads(DESCRIPTORS.read_text(encoding="utf-8"))

    def test_closed_status_vocabulary_and_release_block(self) -> None:
        self.assertEqual(
            self.manifest["statusVocabulary"],
            ["unresolved", "external_evidence_confirmed"],
        )
        self.assertTrue(self.manifest["productionReleaseBlocked"]["blocked"])

    def test_component_set_and_external_reference_names_match_descriptors(self) -> None:
        components = self.manifest["components"]
        self.assertEqual(
            {item["componentId"] for item in components},
            set(deployment_descriptor.COMPONENT_IDS),
        )
        readiness_refs = {
            reference
            for item in components
            for reference in item["externalizationRefs"]
        }
        descriptor_refs = {
            reference
            for item in self.descriptors["components"]
            for reference in item["secretRefs"]
        }
        self.assertEqual(readiness_refs, descriptor_refs)
        self.assertTrue(all(reference.endswith("_REF") for reference in readiness_refs))
        for item in components:
            self.assertTrue(item["localRuntimeConfig"])
            self.assertTrue(item["migrationTargetConfig"])
            self.assertTrue(item["externalizationRefs"])

    def test_backup_and_pitr_evidence_remain_unresolved(self) -> None:
        evidence = self.manifest["hostedDatabaseEvidence"]
        self.assertEqual(
            {item["evidenceId"] for item in evidence},
            {"backup", "point_in_time_recovery"},
        )
        self._assert_unresolved(evidence)

    def test_all_eight_release_gates_remain_unresolved(self) -> None:
        gates = self.manifest["releaseGates"]
        self.assertEqual(len(gates), 8)
        self.assertEqual([item["gateNumber"] for item in gates], list(range(1, 9)))
        self.assertEqual(len({item["gateId"] for item in gates}), 8)
        self._assert_unresolved(gates)

    def _assert_unresolved(self, items: list[dict]) -> None:
        for item in items:
            self.assertEqual(item["status"], evidence_state.STATUS_UNRESOLVED)
            self.assertIsNone(item["evidenceReference"])
            self.assertIsNone(item["verifiedBy"])
            self.assertEqual(
                evidence_state.resolve_evidence_status(item),
                evidence_state.STATUS_UNRESOLVED,
            )


if __name__ == "__main__":
    unittest.main()
