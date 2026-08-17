import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "08-chunk-multimodal-crawling.sh"


class ChunkDownloadRetryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.source = SCRIPT.read_text(encoding="utf-8")

    def test_android_player_client_retry_exists(self) -> None:
        self.assertIn('youtube:player_client=web,android', self.source)
        self.assertIn('첫 다운로드 실패 → android player client로 재시도', self.source)
        self.assertIn('youtube:player_client=android', self.source)
        self.assertIn('YTDLP_COOKIES_FROM_BROWSER', self.source)
        self.assertNotIn('log_warn ', self.source)
    def test_always_uploads_encoded_segment(self) -> None:
        self.assertIn('local segment_file="$segments_dir/chunk_${i}.mp4"', self.source)
        self.assertNotIn('segment_file="$video_path"', self.source)
    def test_watchdog_kills_sleep_child_before_bash(self) -> None:
        self.assertIn('pgrep -P "$watchdog_pid" -x sleep', self.source)
        sleep_idx = self.source.index('kill -9 "$sleep_pid"')
        bash_idx = self.source.index('kill -9 "$watchdog_pid"')
        self.assertLess(sleep_idx, bash_idx)
    def test_rejected_api_key_falls_back_to_web(self) -> None:
        self.assertIn("[ $exit_code -eq 44 ]", self.source)
        self.assertIn("API_KEY_REJECTED", self.source)
        self.assertIn('run_chunk_web_fallback', self.source)
    def test_web_fallback_prefers_explicit_python_cmd(self) -> None:
        self.assertIn('elif [ -n "${PYTHON_CMD:-}" ] && command -v "${PYTHON_CMD}" >/dev/null 2>&1; then', self.source)
        fallback_fn = self.source.split("get_web_fallback_python()", 1)[1].split("get_local_python_cmd()", 1)[0]
        self.assertLess(fallback_fn.index("${PYTHON_CMD:-}"), fallback_fn.index("command -v python3"))


if __name__ == "__main__":
    unittest.main()
