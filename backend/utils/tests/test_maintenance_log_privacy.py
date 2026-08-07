from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import sys
import types
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch


REPO_ROOT = Path(__file__).resolve().parents[3]
BACKEND_ROOT = REPO_ROOT / "backend"
SCRIPTS = {
    "migrate_rule_format": (
        BACKEND_ROOT / "restaurant-evaluation" / "scripts" / "migrate_rule_format.py",
        "rule_results",
        "rule_format_migration_file_failed",
        "RULE_FORMAT_FILE_MIGRATION_FAILED",
    ),
    "reorder_keys": (
        BACKEND_ROOT / "restaurant-evaluation" / "scripts" / "reorder_keys.py",
        "laaj_results",
        "laaj_key_reordering_file_failed",
        "LAAJ_RESULTS_FILE_REORDER_FAILED",
    ),
    "reorder_name_source": (
        BACKEND_ROOT / "restaurant-evaluation" / "scripts" / "reorder_name_source.py",
        "rule_results",
        "evaluation_name_source_reordering_file_failed",
        "EVALUATION_NAME_SOURCE_FILE_REORDER_FAILED",
    ),
    "reorder_rule_keys": (
        BACKEND_ROOT / "restaurant-evaluation" / "scripts" / "reorder_rule_keys.py",
        "rule_results",
        "rule_key_reordering_file_failed",
        "RULE_RESULTS_FILE_REORDER_FAILED",
    ),
}
SENSITIVE_VALUES = (
    "Bearer provider-token-123456",
    ".".join(("eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxIn0", "signaturevalue")),
    "person@example.test",
    "010-1234-5678",
    "37.566500, 126.978000",
    r"C:\private\customers\record.json",
)
SENSITIVE_ERROR = " | ".join(SENSITIVE_VALUES)


def load_script_module(name: str, path: Path) -> types.ModuleType:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise AssertionError(f"unable to load {path.name}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    try:
        spec.loader.exec_module(module)
    finally:
        sys.modules.pop(name, None)
    return module


class SensitiveFailure(Exception):
    def __init__(self) -> None:
        super().__init__(SENSITIVE_ERROR)


class MaintenanceLogPrivacyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.modules = {
            name: load_script_module(f"maintenance_log_privacy_{name}", details[0])
            for name, details in SCRIPTS.items()
        }

    def assert_sensitive_values_absent(self, output: str) -> None:
        for value in SENSITIVE_VALUES:
            self.assertNotIn(value, output)

    def test_sources_use_the_fixed_backend_privacy_logger(self) -> None:
        canonical_logger = (BACKEND_ROOT / "utils" / "privacy_log.py").resolve()
        for name, (script_path, _folder, _operation, _code) in SCRIPTS.items():
            with self.subTest(script=name):
                source = script_path.read_text(encoding="utf-8")
                module = self.modules[name]
                logger_module = sys.modules[module.safe_error_name.__module__]

                self.assertEqual(Path(logger_module.__file__).resolve(), canonical_logger)
                self.assertIn(
                    "BACKEND_ROOT = Path(__file__).resolve().parents[2]", source
                )
                self.assertIn("sys.path.insert(0, str(BACKEND_ROOT))", source)
                self.assertIn("from utils.privacy_log import safe_error_name", source)
                self.assertNotIn("{f.name}", source)
                self.assertNotIn("{rule_dir}", source)
                self.assertNotIn("{laaj_dir}", source)
                self.assertNotIn("{folder_path}", source)
                self.assertNotIn("str(error)", source)
                self.assertNotIn("str(e)", source)
                self.assertNotRegex(source, r"\{\s*(?:e|error)\s*\}")
                self.assertNotRegex(
                    source, r"sys\.path\.(?:append|insert)\([^\n]*data_path"
                )

    def test_file_failures_emit_only_fixed_codes_and_error_names(self) -> None:
        for name, (_script_path, folder, operation, code) in SCRIPTS.items():
            with self.subTest(script=name), TemporaryDirectory() as directory:
                data_path = Path(directory)
                sensitive_file = (
                    data_path
                    / "evaluation"
                    / folder
                    / "person@example.test-record.jsonl"
                )
                sensitive_file.parent.mkdir(parents=True)
                sensitive_file.write_text('{"ignored": true}\n', encoding="utf-8")
                if name == "reorder_name_source":
                    laaj_file = (
                        data_path
                        / "evaluation"
                        / "laaj_results"
                        / "person@example.test-laaj.jsonl"
                    )
                    laaj_file.parent.mkdir(parents=True)
                    laaj_file.write_text('{"ignored": true}\n', encoding="utf-8")

                output = io.StringIO()
                with contextlib.redirect_stdout(output), patch(
                    "builtins.open", side_effect=SensitiveFailure()
                ):
                    if name == "reorder_name_source":
                        with patch.object(
                            sys, "argv", ["reorder_name_source.py", str(data_path)]
                        ):
                            self.modules[name].main()
                    elif name == "reorder_keys":
                        self.modules[name].migrate_laaj_results(data_path)
                    else:
                        self.modules[name].migrate_rule_results(data_path)

                captured = output.getvalue()
                self.assert_sensitive_values_absent(captured)
                self.assertIn(f"operation={operation}", captured)
                self.assertIn(f"error={SensitiveFailure.__name__}", captured)
                self.assertIn(f"code={code}", captured)

    def test_successful_migrations_keep_count_summaries(self) -> None:
        with TemporaryDirectory() as directory:
            data_path = Path(directory)
            rule_file = data_path / "evaluation" / "rule_results" / "rule.jsonl"
            laaj_file = data_path / "evaluation" / "laaj_results" / "laaj.jsonl"
            rule_file.parent.mkdir(parents=True)
            laaj_file.parent.mkdir(parents=True)
            rule_file.write_text(
                json.dumps(
                    {
                        "evaluation_results": {
                            "location_match_TF": [
                                {
                                    "origin_name": "원본 식당",
                                    "naver_name": "네이버 식당",
                                    "eval_value": True,
                                }
                            ],
                            "category_validity_TF": [
                                {"origin_name": "원본 식당", "eval_value": True}
                            ],
                        }
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )
            laaj_file.write_text(
                json.dumps(
                    {
                        "evaluation_results": {
                            "rb_inference_score": [{"score": 1, "name": "식당"}],
                            "location_match_TF": [
                                {
                                    "eval_value": True,
                                    "naver_name": "네이버 식당",
                                    "origin_name": "원본 식당",
                                }
                            ],
                        }
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )

            migrate_output = io.StringIO()
            with contextlib.redirect_stdout(migrate_output):
                self.modules["migrate_rule_format"].migrate_rule_results(data_path)
            reorder_rule_output = io.StringIO()
            with contextlib.redirect_stdout(reorder_rule_output):
                self.modules["reorder_rule_keys"].migrate_rule_results(data_path)
            reorder_laaj_output = io.StringIO()
            with contextlib.redirect_stdout(reorder_laaj_output):
                self.modules["reorder_keys"].migrate_laaj_results(data_path)
            name_source_output = io.StringIO()
            with contextlib.redirect_stdout(name_source_output), patch.object(
                sys, "argv", ["reorder_name_source.py", str(data_path)]
            ):
                self.modules["reorder_name_source"].main()

            self.assertIn("마이그레이션 대상: 1개 파일", migrate_output.getvalue())
            self.assertIn("업데이트: 1개", migrate_output.getvalue())
            self.assertIn("키 순서 정리 대상: 1개 파일", reorder_rule_output.getvalue())
            self.assertIn("업데이트: 1개", reorder_rule_output.getvalue())
            self.assertIn("키 순서 정리 대상: 1개 파일", reorder_laaj_output.getvalue())
            self.assertIn("업데이트: 1개", reorder_laaj_output.getvalue())
            self.assertIn("rule_results: 1개 업데이트", name_source_output.getvalue())
            self.assertIn("laaj_results: 1개 업데이트", name_source_output.getvalue())
            self.assertIn("총 2개 파일 업데이트 완료", name_source_output.getvalue())

            rule_data = json.loads(rule_file.read_text(encoding="utf-8"))
            laaj_data = json.loads(laaj_file.read_text(encoding="utf-8"))
            self.assertEqual(
                list(rule_data["evaluation_results"])[0], "evaluation_name_source"
            )
            self.assertEqual(
                list(
                    rule_data["evaluation_results"]["category_validity_TF"][0]
                )[:3],
                ["name", "name_source", "eval_value"],
            )
            self.assertEqual(
                list(laaj_data["evaluation_results"])[0], "evaluation_name_source"
            )
            self.assertEqual(
                list(laaj_data["evaluation_results"]["rb_inference_score"][0])[0],
                "name",
            )


if __name__ == "__main__":
    unittest.main()
