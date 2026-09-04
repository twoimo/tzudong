#!/usr/bin/env python3
"""Unit tests for ``backend/pipeline_control/deployment_descriptor.py`` (Task 49).

These verify the observable branches and error paths of the
Deployment_Descriptor_Set logic (platform-modernization Requirements 14.3-14.7,
14.9-14.11): secret-literal detection, local-only cluster render with a remote
refusal, derived-field-only difference across cluster renders, Vercel project
verification with readback, and the DNS scope guard. The committed catalog is
also validated against the shared ledger validator (Requirement 14.2) and
confirmed free of secret literals.
"""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from backend.pipeline_control import deployment_descriptor as dd
from backend.pipeline_control import ledger_validation

_ROOT = Path(__file__).resolve().parents[2]
_CATALOG_PATH = _ROOT / "backend" / "deploy" / "deployment-descriptor-set.v1.json"


class SecretLiteralDetectionTests(unittest.TestCase):
    def test_reference_names_are_not_literals(self):
        text = "\n".join(
            [
                "secretRefs:",
                "  - SUPABASE_URL_REF",
                "  - GEMINI_API_KEY_REF",
                "- name: SUPABASE_ANON_KEY",
                "  source: secretRef:SUPABASE_ANON_KEY_REF",
                'password: "${var.db_password_ref}"',
                "token: {{ .Values.secretRef }}",
                "api_key: PIPELINE_PG_DSN_REF",
            ]
        )
        self.assertEqual(dd.detect_secret_literals(text), [])

    def test_jwt_literal_detected(self):
        text = "token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdEFGH"
        findings = dd.detect_secret_literals(text)
        self.assertTrue(findings)
        self.assertTrue(any(f["kind"] == "jwt" for f in findings))
        # No offending value leaks into the finding.
        for f in findings:
            self.assertEqual(set(f.keys()), {"kind", "line"})

    def test_connection_string_userinfo_detected(self):
        text = "MANAGED_PG_DSN: postgresql://appuser:s3cr3tpw@db.internal:5432/tzudong"
        findings = dd.detect_secret_literals(text)
        self.assertTrue(
            any(f["kind"] == "connection_string_userinfo" for f in findings)
        )

    def test_secret_key_assigned_literal_detected(self):
        text = 'grafana_admin_password: "hunter2plaintext"'
        findings = dd.detect_secret_literals(text)
        self.assertTrue(any(f["kind"] == "secret_key_literal" for f in findings))

    def test_provider_key_prefixes_detected(self):
        for literal in (
            "key: sk-ABCDEFGHIJKLMNOPQRSTUVWX",
            "key: AIzaSyABCDEFGHIJKLMNOPQRSTUVWX0123456",
            "key: " + "ghp" + "_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
        ):
            self.assertTrue(dd.detect_secret_literals(literal), literal)

    def test_committed_catalog_has_no_literals(self):
        content = _CATALOG_PATH.read_text(encoding="utf-8")
        self.assertEqual(dd.detect_secret_literals(content), [])

    def test_scan_files_flags_and_reports_bounded(self):
        # A synthetic file with a literal fails the scan with the fixed code.
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            leaky = Path(tmp) / "leaky.yaml"
            leaky.write_text(
                'password: "plaintextsecretvalue"\n', encoding="utf-8"
            )
            result = dd.scan_descriptor_files([leaky])
            self.assertFalse(result["ok"])
            self.assertEqual(result["errorCode"], dd.SECRET_VALUE_IN_DESCRIPTOR)
            self.assertGreaterEqual(result["findingCount"], 1)


class ClusterRenderTests(unittest.TestCase):
    def setUp(self):
        self.catalog = json.loads(_CATALOG_PATH.read_text(encoding="utf-8"))

    def test_local_render_ok_zero_remote_attempts(self):
        result = dd.render_descriptor(self.catalog, "local-a")
        self.assertTrue(result["ok"])
        self.assertEqual(result["artifactCount"], 5)
        self.assertEqual(result["remoteApplyAttemptCount"], 0)
        for artifact in result["artifacts"]:
            fullname = artifact["derived"]["fullname"]
            self.assertRegex(fullname, r"^[a-z0-9]([-a-z0-9]*[a-z0-9])?$")
            self.assertNotIn("_", fullname)
            self.assertLessEqual(len(fullname), 63)

    def test_remote_request_refused_no_artifacts(self):
        for options in (
            {"apply": True},
            {"remote": True},
            {"credentials": {"token": "x"}},
            {"kubeContext": "remote-prod"},
        ):
            result = dd.render_descriptor(self.catalog, "local-a", render_options=options)
            self.assertFalse(result["ok"])
            self.assertEqual(result["errorCode"], dd.REMOTE_APPLY_NOT_ADMITTED)
            self.assertEqual(result["artifactCount"], 0)
            self.assertEqual(result["remoteApplyAttemptCount"], 0)

    def test_multi_cluster_differs_only_in_derived_fields(self):
        result = dd.render_multi_cluster(self.catalog, ("local-a", "local-b"))
        self.assertTrue(result["ok"])
        self.assertEqual(result["remoteApplyAttemptCount"], 0)
        self.assertTrue(set(result["differingFields"]).issubset(set(dd.DERIVED_FIELDS)))
        # base (image, resources, env names, secret refs) is identical.
        self.assertNotIn("base", result["differingFields"])

    def test_multi_cluster_remote_refused(self):
        result = dd.render_multi_cluster(
            self.catalog, ("local-a", "local-b"), render_options={"apply": True}
        )
        self.assertFalse(result["ok"])
        self.assertEqual(result["errorCode"], dd.REMOTE_APPLY_NOT_ADMITTED)
        self.assertEqual(result["renders"], {})

    def test_single_cluster_id_is_insufficient(self):
        result = dd.render_multi_cluster(self.catalog, ("local-a", "local-a"))
        self.assertFalse(result["ok"])
        self.assertEqual(result.get("reason"), "need_two_cluster_ids")


class VercelVerificationTests(unittest.TestCase):
    def test_tzudong_with_repo_verifies_and_reads_back(self):
        result = dd.verify_vercel_project(
            "tzudong", "github.com/twoimo/tzudong", action="deploy"
        )
        self.assertTrue(result["ok"])
        self.assertIsNone(result["errorCode"])
        self.assertEqual(result["readback"]["projectIdentifier"], "tzudong")
        self.assertTrue(result["readback"]["gitIntegrated"])

    def test_unrelated_and_lookalike_repositories_fail_closed(self):
        for repo in ("org/tzudong", "twoimo/other", "github.com/org/tzudong",
                     "https://github.com.evil/twoimo/tzudong",
                     "https://github.com/twoimo/tzudong/extra", " ", {}, None):
            with self.subTest(repo=repo):
                result = dd.verify_vercel_project("tzudong", repo)
                self.assertFalse(result["ok"])
                self.assertIsNone(result["readback"])

    def test_web_project_rejected(self):
        result = dd.verify_vercel_project("web", "github.com/twoimo/tzudong")
        self.assertFalse(result["ok"])
        self.assertEqual(result["errorCode"], dd.VERCEL_PROJECT_NOT_VERIFIED)
        self.assertIsNone(result["readback"])

    def test_unknown_project_rejected(self):
        self.assertEqual(
            dd.verify_vercel_project("some-other", "github.com/twoimo/tzudong")["errorCode"],
            dd.VERCEL_PROJECT_NOT_VERIFIED,
        )

    def test_missing_linked_repo_rejected(self):
        self.assertEqual(
            dd.verify_vercel_project("tzudong", None)["errorCode"],
            dd.VERCEL_PROJECT_NOT_VERIFIED,
        )


class DnsScopeGuardTests(unittest.TestCase):
    def test_dns_change_always_out_of_scope(self):
        result = dd.request_dns_change({"type": "A", "name": "tzudong.app"})
        self.assertFalse(result["ok"])
        self.assertEqual(result["errorCode"], dd.DNS_CHANGE_OUT_OF_SCOPE)
        self.assertFalse(result["performed"])


class CatalogStructureTests(unittest.TestCase):
    def test_committed_catalog_is_structurally_complete(self):
        catalog = json.loads(_CATALOG_PATH.read_text(encoding="utf-8"))
        result = ledger_validation.validate_ledger("deployment_descriptor_set", catalog)
        self.assertTrue(result["ok"], result)
        self.assertEqual(len(catalog["components"]), 5)
        ids = {c["componentId"] for c in catalog["components"]}
        self.assertEqual(ids, set(dd.COMPONENT_IDS))


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
