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
import shutil
import subprocess
import unittest
from unittest import mock
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

    def test_missing_descriptor_directories_fail_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = check.run_check(helm_dir=Path(tmp)/'missing', opentofu_dir=Path(tmp)/'missing')
            self.assertFalse(result['ok'])
            self.assertEqual(result['errorCode'], 'descriptor_source_render_denied')
            self.assertEqual(result['render']['renders'], {})

    def test_actual_templates_and_tofu_sources_are_parsed_and_compared(self):
        mutations = [
            ('helm/tzudong-platform/templates/deployments.yaml', lambda s:s+'\n{{ invalid_function }}\n'),
            ('helm/tzudong-platform/templates/deployments.yaml', lambda s:s.replace('replicas: 1','replicas: 2')),
            ('helm/tzudong-platform/values.yaml', lambda s:s.replace('web-app:1.4.0','web-app:1.4.1')),
            ('tofu/main.tf', lambda s:s+'\nthis is invalid HCL'),
            ('tofu/main.tf', lambda s:s.replace('web-app:1.4.0','web-app:1.4.1')),
            ('tofu/outputs.tf', lambda s:s.replace('value       = local.namespace','value       = "unrelated-namespace"')),
        ]
        for relative, mutate in mutations:
            with self.subTest(relative=relative), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                shutil.copytree(_HELM_DIR, root/'helm')
                shutil.copytree(_OPENTOFU_DIR, root/'tofu')
                target = root/relative
                target.write_text(mutate(target.read_text()))
                result = check.run_check(helm_dir=root/'helm',opentofu_dir=root/'tofu')
                self.assertFalse(result['ok'])
                self.assertEqual(result['errorCode'], 'descriptor_source_render_denied')
                self.assertEqual(result['render']['renders'], {})
                self.assertEqual(result['remoteApplyAttemptCount'], 0)

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
    def test_both_cli_formats_exclude_untrusted_descriptor_details(self):
        sentinel = "untrusted descriptor content"
        raw = {"ok": False, "errorCode": sentinel, "componentCount": sentinel,
               "remoteApplyAttemptCount": sentinel,
               "structural": {"ok": False, "errorCode": sentinel, "detail": sentinel},
               "secretScan": {"ok": False, "errorCode": "secret_value_in_descriptor",
                              "findingCount": 1, "scannedFileCount": 1,
                              "findings": [{"path": sentinel, "value": sentinel}]},
               "render": {"ok": False, "errorCode": sentinel,
                          "renders": {sentinel: sentinel}, "differingFields": [sentinel]}}
        for arguments in ([], ["--json"]):
            output = io.StringIO()
            with mock.patch.object(check, "run_check", return_value=raw), redirect_stdout(output):
                self.assertEqual(check.main(arguments), 1)
            self.assertNotIn(sentinel, output.getvalue())
            self.assertIn("secret_value_in_descriptor", output.getvalue())

    def test_missing_catalog_is_bounded_in_both_cli_formats(self):
        with tempfile.TemporaryDirectory() as tmp:
            for arguments in ([], ["--json"]):
                output = io.StringIO()
                with redirect_stdout(output):
                    self.assertEqual(check.main(["--catalog", str(Path(tmp)/"missing.json"), *arguments]), 1)
                self.assertNotIn(tmp, output.getvalue())
                self.assertIn("ledger_shape_invalid", output.getvalue())

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

    def test_rendered_backend_environment_satisfies_the_actual_runtime_contract(self):
        import yaml
        from backend.bin.check_env_contract import validate
        from backend.pipeline_control.profiles import resolve_compute_profile
        docs = list(yaml.safe_load_all(subprocess.check_output([
            'helm', 'template', 'tzudong-platform', str(_HELM_DIR / 'tzudong-platform')
        ], stderr=subprocess.PIPE, text=True)))
        containers = [doc['spec']['template']['spec']['containers'][0] for doc in docs]
        backend = next(item for item in containers if item['name'] == 'backend-runtime')
        refs = {item['name']: item['valueFrom'] for item in backend['env']}
        self.assertEqual(refs['PIPELINE_CONTROL_DSN'],
                         {'secretKeyRef': {'name': 'pipeline-pg-dsn-ref', 'key': 'value'}})
        self.assertEqual(refs['TZUDONG_DATA_ENV'],
                         {'configMapKeyRef': {'name': 'backend-runtime-config', 'key': 'data_env'}})
        values = {'TZUDONG_DATA_ENV': 'local_db', 'TZUDONG_COMPUTE_PROFILE': 'lite_gha',
                  'PIPELINE_CONTROL_DSN': 'postgresql://postgres@db:5432/postgres'}
        self.assertTrue(set(values).issubset(refs))
        self.assertTrue(validate('pipeline-control', values)['ok'])
        with mock.patch.dict('os.environ', values, clear=True):
            self.assertEqual(resolve_compute_profile(), 'lite_gha')
        self.assertTrue(check.run_check()['ok'])

    def test_real_helm_secret_references_use_valid_object_names(self):
        import yaml
        output = subprocess.check_output([
            "helm", "template", "tzudong-platform", str(_HELM_DIR / "tzudong-platform")
        ], stderr=subprocess.PIPE, text=True)
        refs = []
        for document in yaml.safe_load_all(output):
            for container in document["spec"]["template"]["spec"]["containers"]:
                for entry in container["env"]:
                    ref = entry["valueFrom"].get("secretKeyRef")
                    if ref:
                        refs.append(ref["name"])
                        self.assertRegex(ref["name"], r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")
                        self.assertEqual(ref["key"], "value")
        self.assertIn("supabase-url-ref", refs)
        catalog = json.loads(_CATALOG_PATH.read_text())
        expected = {ref.lower().replace("_", "-") for component in catalog["components"] for ref in component["secretRefs"]}
        self.assertEqual(set(refs), expected)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
