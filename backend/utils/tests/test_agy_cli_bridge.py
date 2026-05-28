import json
import os
import shutil
import stat
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[3]
AGY_BRIDGE = PROJECT_ROOT / "backend" / "bin" / "run_agy_prompt.py"
LAAJ_SCRIPT = PROJECT_ROOT / "backend" / "restaurant-evaluation" / "scripts" / "11-laaj-evaluation.sh"


class AgyCliBridgeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="tzudong-agy-test-"))
        self.fakebin = self.tmp / "bin"
        self.fakebin.mkdir()
        self.fake_agy = self.fakebin / "agy"
        self.fake_agy.write_text(
            textwrap.dedent(
                """\
                #!/usr/bin/env python3
                import os
                import sys

                os.write(1, b"\\x1b[6n")
                prompt = sys.argv[sys.argv.index("--print") + 1]
                if "1+1" in prompt or "Reply with only" in prompt:
                    print("2")
                elif "AGY_AUTH_REQUIRED" in prompt:
                    print("Authentication required. Please visit the URL to log in:")
                    print("  https://accounts.google.com/o/oauth2/auth?client_id=fake")
                elif "AGY_ALWAYS_BAD_JSON" in prompt:
                    state_path = os.environ.get("AGY_FAKE_STATE")
                    count = 0
                    if state_path and os.path.exists(state_path):
                        count = int(open(state_path, encoding="utf-8").read().strip() or "0")
                    if state_path:
                        with open(state_path, "w", encoding="utf-8") as fh:
                            fh.write(str(count + 1))
                    print("평가 결과는 아래와 같습니다. JSON이 아닙니다.")
                elif "AGY_RETRY_BAD_JSON" in prompt:
                    state_path = os.environ.get("AGY_FAKE_STATE")
                    count = 0
                    if state_path and os.path.exists(state_path):
                        count = int(open(state_path, encoding="utf-8").read().strip() or "0")
                    if state_path:
                        with open(state_path, "w", encoding="utf-8") as fh:
                            fh.write(str(count + 1))
                    if count == 0:
                        print("평가 결과는 아래와 같습니다. JSON이 아닙니다.")
                    else:
                        print('{"visit_authenticity":{"values":[]},"rb_inference_score":{"values":[]},"rb_grounding_TF":{"values":[]},"review_faithfulness_score":{"values":[]},"category_TF":{"values":[]}}')
                else:
                    print('{"visit_authenticity":{"values":[]},"rb_inference_score":{"values":[]},"rb_grounding_TF":{"values":[]},"review_faithfulness_score":{"values":[]},"category_TF":{"values":[]}}')
                """
            ),
            encoding="utf-8",
        )
        self.fake_agy.chmod(self.fake_agy.stat().st_mode | stat.S_IEXEC)
        self.fake_gemini = self.fakebin / "gemini"
        self.fake_gemini.write_text(
            textwrap.dedent(
                """\
                #!/usr/bin/env python3
                import os
                import sys

                state_path = os.environ.get("GEMINI_FAKE_STATE")
                if state_path:
                    count = 0
                    if os.path.exists(state_path):
                        count = int(open(state_path, encoding="utf-8").read().strip() or "0")
                    with open(state_path, "w", encoding="utf-8") as fh:
                        fh.write(str(count + 1))
                print('{"visit_authenticity":{"values":[]},"rb_inference_score":{"values":[]},"rb_grounding_TF":{"values":[]},"review_faithfulness_score":{"values":[]},"category_TF":{"values":[]}}')
                """
            ),
            encoding="utf-8",
        )
        self.fake_gemini.chmod(self.fake_gemini.stat().st_mode | stat.S_IEXEC)

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_bridge_answers_terminal_cursor_query_and_captures_print_output(self) -> None:
        prompt_file = self.tmp / "prompt.txt"
        output_file = self.tmp / "response.txt"
        err_file = self.tmp / "response.err"
        prompt_file.write_text("Reply with only: ok", encoding="utf-8")

        env = os.environ.copy()
        env["PATH"] = f"{self.fakebin}{os.pathsep}{env.get('PATH', '')}"
        result = subprocess.run(
            [
                "python3",
                str(AGY_BRIDGE),
                "--prompt-file",
                str(prompt_file),
                "--output",
                str(output_file),
                "--stderr-file",
                str(err_file),
                "--print-timeout",
                "30s",
                "--timeout-sec",
                "45",
            ],
            capture_output=True,
            text=True,
            env=env,
            check=False,
        )

        self.assertEqual(0, result.returncode, result.stderr + result.stdout)
        self.assertEqual("2", output_file.read_text(encoding="utf-8").strip())
        self.assertNotIn("\x1b", output_file.read_text(encoding="utf-8"))

    def test_bridge_treats_auth_prompt_as_failure(self) -> None:
        prompt_file = self.tmp / "prompt.txt"
        output_file = self.tmp / "response.txt"
        err_file = self.tmp / "response.err"
        prompt_file.write_text("AGY_AUTH_REQUIRED", encoding="utf-8")

        env = os.environ.copy()
        env["PATH"] = f"{self.fakebin}{os.pathsep}{env.get('PATH', '')}"
        result = subprocess.run(
            [
                "python3",
                str(AGY_BRIDGE),
                "--prompt-file",
                str(prompt_file),
                "--output",
                str(output_file),
                "--stderr-file",
                str(err_file),
                "--print-timeout",
                "30s",
                "--timeout-sec",
                "45",
            ],
            capture_output=True,
            text=True,
            env=env,
            check=False,
        )

        self.assertNotEqual(0, result.returncode)
        self.assertIn("Authentication required", output_file.read_text(encoding="utf-8"))

    def test_laaj_uses_agy_oauth_before_gemini_cli_when_api_key_is_absent(self) -> None:
        rel_root = Path("backend") / "restaurant-evaluation" / "tmp" / f"agy-{os.getpid()}"
        abs_root = PROJECT_ROOT / rel_root
        crawling = abs_root / "crawl"
        evaluation = abs_root / "eval"
        rule_dir = evaluation / "evaluation" / "rule_results"
        transcript_dir = crawling / "transcript"
        meta_dir = crawling / "meta"
        rule_dir.mkdir(parents=True)
        transcript_dir.mkdir(parents=True)
        meta_dir.mkdir(parents=True)

        video_id = "agy_test_video"
        rule_payload = {
            "youtube_link": "https://youtu.be/agy",
            "channel_name": "tzuyang",
            "evaluation_target": {"테스트식당": True},
            "restaurants": [{"origin_name": "테스트식당"}],
            "evaluation_results": {
                "location_match_TF": [
                    {"origin_name": "테스트식당", "naver_name": "테스트식당"}
                ]
            },
            "recollect_version": {"meta": 0},
        }
        transcript_payload = {
            "language": "ko",
            "transcript": [{"start": 0, "text": "테스트식당을 방문했습니다."}],
        }
        (rule_dir / f"{video_id}.jsonl").write_text(
            json.dumps(rule_payload, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        (transcript_dir / f"{video_id}.jsonl").write_text(
            json.dumps(transcript_payload, ensure_ascii=False) + "\n", encoding="utf-8"
        )

        env = os.environ.copy()
        env["PATH"] = f"{self.fakebin}{os.pathsep}/usr/bin:/bin"
        env.pop("GEMINI_API_KEY", None)
        env.pop("GEMINI_API_KEY_BYEON", None)
        env["AGY_BRIDGE_TIMEOUT_SEC"] = "45"
        env["AGY_PRINT_TIMEOUT"] = "30s"

        try:
            result = subprocess.run(
                [
                    "bash",
                    str(LAAJ_SCRIPT),
                    "--channel",
                    "tzuyang",
                    "--crawling-path",
                    str(rel_root / "crawl"),
                    "--evaluation-path",
                    str(rel_root / "eval"),
                ],
                cwd=PROJECT_ROOT,
                capture_output=True,
                text=True,
                env=env,
                check=False,
                timeout=90,
            )

            self.assertEqual(0, result.returncode, result.stdout + result.stderr)
            self.assertIn("Antigravity CLI", result.stdout + result.stderr)
            output_file = evaluation / "evaluation" / "laaj_results" / f"{video_id}.jsonl"
            self.assertTrue(output_file.exists())
            payload = json.loads(output_file.read_text(encoding="utf-8").strip())
            self.assertIn("visit_authenticity", payload["evaluation_results"])
        finally:
            shutil.rmtree(abs_root, ignore_errors=True)

    def test_laaj_retries_agy_with_strict_json_prompt_after_parse_failure(self) -> None:
        rel_root = Path("backend") / "restaurant-evaluation" / "tmp" / f"agy-retry-{os.getpid()}"
        abs_root = PROJECT_ROOT / rel_root
        crawling = abs_root / "crawl"
        evaluation = abs_root / "eval"
        rule_dir = evaluation / "evaluation" / "rule_results"
        transcript_dir = crawling / "transcript"
        rule_dir.mkdir(parents=True)
        transcript_dir.mkdir(parents=True)

        video_id = "agy_retry_video"
        rule_payload = {
            "youtube_link": "https://youtu.be/agy-retry",
            "channel_name": "tzuyang",
            "evaluation_target": {"재시도식당": True},
            "restaurants": [{"origin_name": "재시도식당"}],
            "evaluation_results": {
                "location_match_TF": [
                    {"origin_name": "재시도식당", "naver_name": "재시도식당"}
                ]
            },
            "recollect_version": {"meta": 0},
        }
        transcript_payload = {
            "language": "ko",
            "transcript": [{"start": 0, "text": "AGY_RETRY_BAD_JSON 재시도식당을 방문했습니다."}],
        }
        (rule_dir / f"{video_id}.jsonl").write_text(
            json.dumps(rule_payload, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        (transcript_dir / f"{video_id}.jsonl").write_text(
            json.dumps(transcript_payload, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        state_file = self.tmp / "agy-state.txt"

        env = os.environ.copy()
        env["PATH"] = f"{self.fakebin}{os.pathsep}/usr/bin:/bin"
        env.pop("GEMINI_API_KEY", None)
        env.pop("GEMINI_API_KEY_BYEON", None)
        env["AGY_BRIDGE_TIMEOUT_SEC"] = "45"
        env["AGY_PRINT_TIMEOUT"] = "30s"
        env["LAAJ_PARSE_RETRY_SLEEP_SEC"] = "0"
        env["AGY_FAKE_STATE"] = str(state_file)

        try:
            result = subprocess.run(
                [
                    "bash",
                    str(LAAJ_SCRIPT),
                    "--channel",
                    "tzuyang",
                    "--crawling-path",
                    str(rel_root / "crawl"),
                    "--evaluation-path",
                    str(rel_root / "eval"),
                ],
                cwd=PROJECT_ROOT,
                capture_output=True,
                text=True,
                env=env,
                check=False,
                timeout=90,
            )

            combined = result.stdout + result.stderr
            self.assertEqual(0, result.returncode, combined)
            self.assertIn("Antigravity CLI JSON 전용 재요청", combined)
            self.assertEqual("2", state_file.read_text(encoding="utf-8").strip())
            output_file = evaluation / "evaluation" / "laaj_results" / f"{video_id}.jsonl"
            self.assertTrue(output_file.exists())
            payload = json.loads(output_file.read_text(encoding="utf-8").strip())
            self.assertIn("visit_authenticity", payload["evaluation_results"])
        finally:
            shutil.rmtree(abs_root, ignore_errors=True)

    def test_laaj_falls_back_to_gemini_cli_when_agy_json_retry_still_fails(self) -> None:
        rel_root = Path("backend") / "restaurant-evaluation" / "tmp" / f"agy-gemini-fallback-{os.getpid()}"
        abs_root = PROJECT_ROOT / rel_root
        crawling = abs_root / "crawl"
        evaluation = abs_root / "eval"
        rule_dir = evaluation / "evaluation" / "rule_results"
        transcript_dir = crawling / "transcript"
        rule_dir.mkdir(parents=True)
        transcript_dir.mkdir(parents=True)

        video_id = "agy_gemini_fallback_video"
        rule_payload = {
            "youtube_link": "https://youtu.be/agy-gemini-fallback",
            "channel_name": "tzuyang",
            "evaluation_target": {"폴백식당": True},
            "restaurants": [{"origin_name": "폴백식당"}],
            "evaluation_results": {
                "location_match_TF": [
                    {"origin_name": "폴백식당", "naver_name": "폴백식당"}
                ]
            },
            "recollect_version": {"meta": 0},
        }
        transcript_payload = {
            "language": "ko",
            "transcript": [{"start": 0, "text": "AGY_ALWAYS_BAD_JSON 폴백식당을 방문했습니다."}],
        }
        (rule_dir / f"{video_id}.jsonl").write_text(
            json.dumps(rule_payload, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        (transcript_dir / f"{video_id}.jsonl").write_text(
            json.dumps(transcript_payload, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        agy_state = self.tmp / "agy-always-bad-state.txt"
        gemini_state = self.tmp / "gemini-fallback-state.txt"

        env = os.environ.copy()
        env["PATH"] = f"{self.fakebin}{os.pathsep}/usr/bin:/bin"
        env.pop("GEMINI_API_KEY", None)
        env.pop("GEMINI_API_KEY_BYEON", None)
        env["HOME"] = str(self.tmp)
        (self.tmp / ".gemini").mkdir(exist_ok=True)
        (self.tmp / ".gemini" / "oauth_creds.json").write_text("{}", encoding="utf-8")
        env["AGY_BRIDGE_TIMEOUT_SEC"] = "45"
        env["AGY_PRINT_TIMEOUT"] = "30s"
        env["LAAJ_PARSE_RETRY_SLEEP_SEC"] = "0"
        env["AGY_FAKE_STATE"] = str(agy_state)
        env["GEMINI_FAKE_STATE"] = str(gemini_state)

        try:
            result = subprocess.run(
                [
                    "bash",
                    str(LAAJ_SCRIPT),
                    "--channel",
                    "tzuyang",
                    "--crawling-path",
                    str(rel_root / "crawl"),
                    "--evaluation-path",
                    str(rel_root / "eval"),
                ],
                cwd=PROJECT_ROOT,
                capture_output=True,
                text=True,
                env=env,
                check=False,
                timeout=90,
            )

            combined = result.stdout + result.stderr
            self.assertEqual(0, result.returncode, combined)
            self.assertIn("Antigravity CLI JSON 재요청도 파싱 실패 -> Gemini CLI OAuth로 전환", combined)
            self.assertIn("Gemini CLI JSON 전용 재요청", combined)
            self.assertEqual("2", agy_state.read_text(encoding="utf-8").strip())
            self.assertEqual("1", gemini_state.read_text(encoding="utf-8").strip())
            output_file = evaluation / "evaluation" / "laaj_results" / f"{video_id}.jsonl"
            self.assertTrue(output_file.exists())
            payload = json.loads(output_file.read_text(encoding="utf-8").strip())
            self.assertIn("visit_authenticity", payload["evaluation_results"])
        finally:
            shutil.rmtree(abs_root, ignore_errors=True)

    def test_laaj_falls_back_to_gemini_cli_when_agy_requires_auth(self) -> None:
        rel_root = Path("backend") / "restaurant-evaluation" / "tmp" / f"agy-auth-fallback-{os.getpid()}"
        abs_root = PROJECT_ROOT / rel_root
        crawling = abs_root / "crawl"
        evaluation = abs_root / "eval"
        rule_dir = evaluation / "evaluation" / "rule_results"
        transcript_dir = crawling / "transcript"
        rule_dir.mkdir(parents=True)
        transcript_dir.mkdir(parents=True)

        video_id = "agy_auth_fallback_video"
        rule_payload = {
            "youtube_link": "https://youtu.be/agy-auth-fallback",
            "channel_name": "tzuyang",
            "evaluation_target": {"인증폴백식당": True},
            "restaurants": [{"origin_name": "인증폴백식당"}],
            "evaluation_results": {
                "location_match_TF": [
                    {"origin_name": "인증폴백식당", "naver_name": "인증폴백식당"}
                ]
            },
            "recollect_version": {"meta": 0},
        }
        transcript_payload = {
            "language": "ko",
            "transcript": [{"start": 0, "text": "AGY_AUTH_REQUIRED 인증폴백식당을 방문했습니다."}],
        }
        (rule_dir / f"{video_id}.jsonl").write_text(
            json.dumps(rule_payload, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        (transcript_dir / f"{video_id}.jsonl").write_text(
            json.dumps(transcript_payload, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        gemini_state = self.tmp / "gemini-auth-fallback-state.txt"

        env = os.environ.copy()
        env["PATH"] = f"{self.fakebin}{os.pathsep}/usr/bin:/bin"
        env.pop("GEMINI_API_KEY", None)
        env.pop("GEMINI_API_KEY_BYEON", None)
        env["HOME"] = str(self.tmp)
        (self.tmp / ".gemini").mkdir(exist_ok=True)
        (self.tmp / ".gemini" / "oauth_creds.json").write_text("{}", encoding="utf-8")
        env["AGY_BRIDGE_TIMEOUT_SEC"] = "45"
        env["AGY_PRINT_TIMEOUT"] = "30s"
        env["LAAJ_PARSE_RETRY_SLEEP_SEC"] = "0"
        env["GEMINI_FAKE_STATE"] = str(gemini_state)

        try:
            result = subprocess.run(
                [
                    "bash",
                    str(LAAJ_SCRIPT),
                    "--channel",
                    "tzuyang",
                    "--crawling-path",
                    str(rel_root / "crawl"),
                    "--evaluation-path",
                    str(rel_root / "eval"),
                ],
                cwd=PROJECT_ROOT,
                capture_output=True,
                text=True,
                env=env,
                check=False,
                timeout=90,
            )

            combined = result.stdout + result.stderr
            self.assertEqual(0, result.returncode, combined)
            self.assertIn("Authentication required", combined)
            self.assertIn("Gemini CLI 호출", combined)
            self.assertEqual("1", gemini_state.read_text(encoding="utf-8").strip())
            output_file = evaluation / "evaluation" / "laaj_results" / f"{video_id}.jsonl"
            self.assertTrue(output_file.exists())
            payload = json.loads(output_file.read_text(encoding="utf-8").strip())
            self.assertIn("visit_authenticity", payload["evaluation_results"])
        finally:
            shutil.rmtree(abs_root, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
