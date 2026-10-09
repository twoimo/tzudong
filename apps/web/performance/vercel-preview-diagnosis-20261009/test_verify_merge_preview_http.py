import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("verify-merge-preview-http.py")


def valid_fixture():
    public = ["/one", "/two"]
    admin = ["/api/admin/example"]
    records = [
        {"path": path, "cliExit": 0, "httpStatus": 200, "platformProtectionPage": False}
        for path in public
    ]
    records.append({
        "path": admin[0],
        "cliExit": 0,
        "httpStatus": 401,
        "platformProtectionPage": False,
        "boundedErrorCode": "UNAUTHORIZED",
    })
    return {"publicPaths": public, "adminPaths": admin, "records": records}


class PreviewVerifierTests(unittest.TestCase):
    def run_fixture(self, fixture):
        with tempfile.TemporaryDirectory() as temporary:
            fixture_path = Path(temporary) / "fixture.json"
            output_path = Path(temporary) / "result.json"
            fixture_path.write_text(json.dumps(fixture))
            run = subprocess.run(
                [sys.executable, str(SCRIPT), "--evaluate-fixture", str(fixture_path), "--output", str(output_path)],
                capture_output=True,
                text=True,
                timeout=30,
            )
            report = json.loads(output_path.read_text())
        return run, report

    def test_complete_matrix_is_the_only_exit_zero_case(self):
        run, report = self.run_fixture(valid_fixture())
        self.assertEqual(run.returncode, 0)
        self.assertEqual(report["verification"]["status"], "passed")
        self.assertTrue(all(report["verification"]["checks"].values()))

    def test_public_500_is_nonzero_with_partial_evidence(self):
        fixture = valid_fixture()
        fixture["records"][0]["httpStatus"] = 500
        run, report = self.run_fixture(fixture)
        self.assertEqual(run.returncode, 1)
        self.assertEqual(report["verification"]["code"], "PUBLIC_STATUS_UNACCEPTABLE")
        self.assertEqual(len(report["records"]), 3)

    def test_cli_failure_is_nonzero(self):
        fixture = valid_fixture()
        fixture["records"][1]["cliExit"] = 7
        run, report = self.run_fixture(fixture)
        self.assertEqual(run.returncode, 1)
        self.assertEqual(report["verification"]["code"], "CLI_EXIT_NONZERO")

    def test_incomplete_early_break_is_nonzero(self):
        fixture = valid_fixture()
        fixture["records"] = fixture["records"][:-1]
        run, report = self.run_fixture(fixture)
        self.assertEqual(run.returncode, 1)
        self.assertEqual(report["verification"]["code"], "RECORD_SET_INCOMPLETE")
        self.assertEqual(report["verification"]["checks"]["observedRecordCount"], 2)

    def test_anonymous_admin_must_be_401_or_403(self):
        fixture = copy.deepcopy(valid_fixture())
        fixture["records"][-1]["httpStatus"] = 200
        run, report = self.run_fixture(fixture)
        self.assertEqual(run.returncode, 1)
        self.assertEqual(report["verification"]["code"], "ADMIN_ANONYMOUS_STATUS_INVALID")


if __name__ == "__main__":
    unittest.main()
