"""Execute the retained audit loops with bounded, local tool doubles."""
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github/workflows/security-audit.yml"


def audit_job(name):
    source = WORKFLOW.read_text()
    match = re.search(rf"^  {name}:\n(.*?)(?=^  [\w-]+:|\Z)", source, re.M | re.S)
    if not match:
        raise AssertionError("audit job missing")
    job = match[1]
    budget = int(re.search(r"timeout-minutes: (\d+)", job)[1])
    label = "Audit npm dependencies" if name == "npm-audit" else "Audit Python requirements"
    run = re.search(rf"      - name: {label}\n        run: \|\n((?:          .*\n)+)", job)[1]
    return budget, "".join(line[10:] for line in run.splitlines(keepends=True))


class AuditBudgetTests(unittest.TestCase):
    def run_loop(self, name, first_status):
        budget, script = audit_job(name)
        count = 2 if name == "npm-audit" else 5
        self.assertGreaterEqual(budget, count * 20.5 + 5)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            for project in ("apps/web", "backend"):
                (root / project).mkdir(parents=True)
            bin_dir = root / "bin"
            bin_dir.mkdir()
            log = root / "calls.jsonl"
            timeout = bin_dir / "timeout"
            timeout.write_text(
                "#!/usr/bin/env python3\n"
                "import json, os, pathlib, sys\n"
                "args = sys.argv[1:]\n"
                "if args[:3] != ['--signal=TERM', '--kill-after=30s', '20m']:\n"
                "    sys.exit(98)\n"
                "path = pathlib.Path(os.environ['CI_AUDIT_TEST_LOG'])\n"
                "first = not path.exists()\n"
                "with path.open('a') as out:\n"
                "    out.write(json.dumps({'cwd': os.getcwd(), 'args': args[3:]}) + '\\n')\n"
                "sys.exit(int(os.environ['CI_AUDIT_FIRST_STATUS']) if first else 0)\n"
            )
            timeout.chmod(0o700)
            env = dict(os.environ, PATH=str(bin_dir) + os.pathsep + os.environ["PATH"],
                       CI_AUDIT_TEST_LOG=str(log), CI_AUDIT_FIRST_STATUS=str(first_status))
            result = subprocess.run(["bash", "-c", script], cwd=root, env=env,
                                    capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, int(first_status != 0), result.stderr)
            calls = [json.loads(line) for line in log.read_text().splitlines()]
            self.assertEqual(len(calls), count)
            if name == "npm-audit":
                self.assertEqual([Path(call["cwd"]).relative_to(root).as_posix() for call in calls],
                                 ["apps/web", "backend"])
                self.assertTrue(all(call["args"] == ["npm", "audit", "--audit-level=moderate"] for call in calls))
            else:
                expected = ["backend/test-requirements.txt", "backend/pipeline/requirements.txt",
                            "backend/restaurant-crawling/scripts/requirements.txt",
                            "backend/supabase/scripts/g037-hosted-closure-requirements.txt",
                            "backend/pipeline-control/requirements.txt"]
                self.assertEqual([call["args"] for call in calls],
                                 [["python", "-m", "pip_audit", "-r", target, "--strict"] for target in expected])

    def test_npm_success_preserves_both_projects(self):
        self.run_loop("npm-audit", 0)

    def test_npm_timeout_continues_then_fails(self):
        self.run_loop("npm-audit", 124)

    def test_pip_success_preserves_all_requirements(self):
        self.run_loop("pip-audit", 0)

    def test_pip_failure_continues_then_fails(self):
        self.run_loop("pip-audit", 1)


if __name__ == "__main__":
    unittest.main()
