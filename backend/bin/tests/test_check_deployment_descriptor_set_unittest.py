#!/usr/bin/env python3
"""Unit tests for ``backend/bin/check_deployment_descriptor_set.py`` (Task 49).

These verify the aggregate checker's observable branches: the real committed
Deployment_Descriptor_Set (JSON catalog + Helm chart + OpenTofu configs) passes
every dimension, a descriptor file carrying a secret literal fails with
``secret_value_in_descriptor`` and produces zero render artifacts, and a render
that requests a remote target is refused with ``remote_apply_not_admitted``.
Following the ``backend/bin`` convention (no ``__init__.py``), the checker is
loaded by path.
"""

from __future__ import annotations

import importlib.util
import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[3]
_CHECKER_PATH = _ROOT / "backend" / "bin" / "check_deployment_descriptor_set.py"
_CATALOG_PATH = _ROOT / "backend" / "deploy" / "deployment-descriptor-set.v1.json"
_HELM_DIR = _ROOT / "backend" / "deploy" / "helm"
_OPENTOFU_DIR = _ROOT / "backend" / "deploy" / "opentofu"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


check = _load("check_deployment_descriptor_set", _CHECKER_PATH)


class RealTreeTests(unittest.TestCase):
    def test_committed_descriptor_set_passes(self):
        result = check.run_check()
        self.assertTrue(result["ok"], result)
        self.assertIsNone(result["errorCode"])
        self.assertEqual(result["componentCount"], 5)
        self.assertEqual(result["remoteApplyAttemptCount"], 0)
        self.assertTrue(result["secretScan"]["ok"])
        self.assertTrue(result["render"]["ok"])
        self.assertTrue(
            set(result["render"]["differingFields"]).issubset(
                {"namespace", "releaseName", "clusterLabel", "fullname"}
            )
        )

    def test_remote_render_refused(self):
        result = check.run_check(render_options={"apply": True})
        self.assertFalse(result["ok"])
        self.assertEqual(result["errorCode"], "remote_apply_not_admitted")
        self.assertEqual(result["remoteApplyAttemptCount"], 0)
        self.assertEqual(result["render"]["renders"], {})


class SecretLiteralGatesRenderTests(unittest.TestCase):
    def test_leaky_helm_file_fails_and_skips_render(self):
        with tempfile.TemporaryDirectory() as tmp:
            helm_dir = Path(tmp) / "helm"
            helm_dir.mkdir()
            (helm_dir / "leaky.yaml").write_text(
                "env:\n  - name: TOKEN\n    token: "
                + "ghp"
                + "_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789\n",
                encoding="utf-8",
            )
            result = check.run_check(
                catalog_path=_CATALOG_PATH,
                helm_dir=helm_dir,
                opentofu_dir=Path(tmp) / "none",
            )
            self.assertFalse(result["ok"])
            self.assertEqual(result["errorCode"], "secret_value_in_descriptor")
            # No render artifact is produced when a literal is detected.
            self.assertEqual(result["render"]["renders"], {})
            self.assertEqual(result["remoteApplyAttemptCount"], 0)


class CliTests(unittest.TestCase):
    def test_main_returns_zero_on_real_tree(self):
        output = io.StringIO()
        with redirect_stdout(output):
            self.assertEqual(check.main(["--json"]), 0)
        payload = json.loads(output.getvalue())
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["secretScan"]["scannedFileCount"], 8)

    def test_helm_names_are_normalized_for_kubernetes(self):
        helpers = (
            _HELM_DIR / "tzudong-platform" / "templates" / "_helpers.tpl"
        ).read_text(encoding="utf-8")
        deployments = (
            _HELM_DIR / "tzudong-platform" / "templates" / "deployments.yaml"
        ).read_text(encoding="utf-8")
        self.assertIn('define "tzudong.componentName"', helpers)
        self.assertIn('lower | replace "_" "-"', helpers)
        self.assertEqual(deployments.count('include "tzudong.componentName"'), 4)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
