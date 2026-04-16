import json
import subprocess
import textwrap
import unittest
from pathlib import Path


FILTER = textwrap.dedent(
    r"""
    .restaurants as $rests |
    .evaluation_target as $targets |
    .evaluation_results.location_match_TF as $loc_evals |
    $rests | map(
        .origin_name as $origin_name |
        select(($origin_name | type) == "string" and ($origin_name | length) > 0 and ($targets[$origin_name] == true)) |
        . as $r |
        ($loc_evals | map(select(.origin_name == $origin_name)) | first // null) as $loc |
        del(.origin_name) |
        . + {name: (if $loc and $loc.naver_name then $loc.naver_name else $origin_name end)}
    )
    """
).strip()


class LaajTargetFilterRegressionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        project_root = Path(__file__).resolve().parents[4]
        candidate = project_root / "backend" / "bin" / "jq.exe"
        if candidate.exists():
            cls.jq_exe = str(candidate)
        else:
            cls.jq_exe = None

    def setUp(self):
        if not self.jq_exe:
            self.skipTest("backend/bin/jq.exe is required for this regression test")

    def run_filter(self, payload: dict):
        return subprocess.run(
            [self.jq_exe, "-c", FILTER],
            input=json.dumps(payload, ensure_ascii=False),
            capture_output=True,
            text=True,
            check=False,
        )

    def test_null_origin_name_is_ignored_instead_of_crashing(self):
        payload = {
            "restaurants": [
                {"origin_name": "풍년식당", "address": "x"},
                {"origin_name": None, "address": None},
            ],
            "evaluation_target": {"풍년식당": True, "맥도날드": False},
            "evaluation_results": {
                "location_match_TF": [
                    {"origin_name": "풍년식당", "naver_name": "풍년식당"}
                ]
            },
        }

        result = self.run_filter(payload)

        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual(
            [{"address": "x", "name": "풍년식당"}],
            json.loads(result.stdout),
        )

    def test_all_null_origin_names_return_empty_list(self):
        payload = {
            "restaurants": [
                {"origin_name": None, "address": "x"},
                {"origin_name": None, "address": "y"},
            ],
            "evaluation_target": {"어딘가": True},
            "evaluation_results": {"location_match_TF": []},
        }

        result = self.run_filter(payload)

        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual([], json.loads(result.stdout))


if __name__ == "__main__":
    unittest.main()
