import os
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory


BACKEND_ROOT = Path(__file__).resolve().parents[2]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from utils.runtime_paths import (
    get_backend_log_dir,
    load_backend_env,
    resolve_backend_root,
    resolve_env_path,
)


class RuntimePathsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_resolve_backend_root_prefers_strong_signal(self):
        backend = self.root / "project" / "backend"
        (backend / "config").mkdir(parents=True)
        (backend / "utils").mkdir(parents=True)
        (backend / "config" / "channels.yaml").write_text("channels: []\n", encoding="utf-8")

        anchor = backend / "restaurant-crawling" / "scripts" / "dummy.py"
        anchor.parent.mkdir(parents=True)
        anchor.write_text("", encoding="utf-8")

        self.assertEqual(resolve_backend_root(anchor), backend)

    def test_resolve_backend_root_uses_backend_name_fallback(self):
        backend = self.root / "sandbox" / "backend"
        anchor = backend / "scripts" / "dummy.py"
        anchor.parent.mkdir(parents=True)
        anchor.write_text("", encoding="utf-8")

        self.assertEqual(resolve_backend_root(anchor), backend)

    def test_resolve_backend_root_returns_base_when_no_signal(self):
        anchor = self.root / "x" / "y" / "z.py"
        anchor.parent.mkdir(parents=True)
        anchor.write_text("", encoding="utf-8")

        self.assertEqual(resolve_backend_root(anchor), anchor.parent)

    def test_resolve_env_path_respects_preference(self):
        backend = self.root / "backend"
        backend.mkdir()
        local_env = backend / ".env.local"
        default_env = backend / ".env"
        local_env.write_text("K=local\n", encoding="utf-8")
        default_env.write_text("K=default\n", encoding="utf-8")

        self.assertEqual(resolve_env_path(backend, prefer_local=True), local_env)
        self.assertEqual(resolve_env_path(backend, prefer_local=False), default_env)

    def test_load_backend_env_returns_loaded_path(self):
        backend = self.root / "backend"
        backend.mkdir()
        env_file = backend / ".env"
        env_file.write_text("UNIT_TEST_RUNTIME_PATHS=ok\n", encoding="utf-8")

        os.environ.pop("UNIT_TEST_RUNTIME_PATHS", None)
        loaded = load_backend_env(backend, prefer_local=False, override=True)

        self.assertEqual(loaded, env_file)
        # dotenv 미설치 환경이면 환경변수 주입이 없을 수 있으므로 경로 반환만 필수 검증
        if "UNIT_TEST_RUNTIME_PATHS" in os.environ:
            self.assertEqual(os.environ["UNIT_TEST_RUNTIME_PATHS"], "ok")

    def test_get_backend_log_dir(self):
        backend = self.root / "backend"
        self.assertEqual(get_backend_log_dir(backend, "restaurant-crawling"), backend / "log" / "restaurant-crawling")


if __name__ == "__main__":
    unittest.main()
