"""Exercise the collector's local URL contract without provider imports/calls."""

from __future__ import annotations

import ast
from contextlib import nullcontext
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any, Dict, List, Set
import unittest

from backend.utils.stage_cache import atomic_write


COLLECTOR = Path(__file__).resolve().parents[1] / "01-collect-urls.py"


class _Logger:
    def info(self, _message):
        pass

    def warning(self, _message):
        pass

    def add_statistic(self, _name, _value):
        pass

    def timer(self, _name):
        return nullcontext()


def _local_collector_functions() -> dict:
    # The full module loads provider/config packages that are unavailable in
    # this isolated unit runtime. Compile the actual local functions instead.
    tree = ast.parse(COLLECTOR.read_text(encoding="utf-8"), filename=str(COLLECTOR))
    names = {"load_existing_urls", "save_urls", "save_deleted_urls", "collect_channel_urls"}
    selected = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
    assert {node.name for node in selected} == names
    scope = {
        "Any": Any, "Dict": Dict, "List": List, "Set": Set,
        "Path": Path, "PipelineLogger": _Logger, "atomic_write": atomic_write,
        "datetime": datetime, "KST": timezone.utc,
    }
    exec(compile(ast.Module(body=selected, type_ignores=[]), str(COLLECTOR), "exec"), scope)
    return scope


class CollectUrlsOrderingTests(unittest.TestCase):
    def test_explicit_latest_first_preserves_playlist_order_and_default_append(self) -> None:
        scope = _local_collector_functions()
        with TemporaryDirectory() as folder:
            target = Path(folder) / "urls.txt"
            old, retry, newest = "old", "retry", "newest"
            target.write_text(f"{old}\n{retry}\n", encoding="utf-8")
            urls = [newest, retry, old]
            self.assertEqual(scope["save_urls"](urls, target, {old, retry}, _Logger()), 1)
            self.assertEqual(target.read_text(encoding="utf-8").splitlines(), [old, retry, newest])
            self.assertEqual(scope["save_urls"](urls, target, set(urls), _Logger(), latest_first=True), 0)
            self.assertEqual(target.read_text(encoding="utf-8").splitlines(), urls)
            scope["save_urls"](["later", *urls], target, set(urls), _Logger(), dry_run=True, latest_first=True)
            self.assertEqual(target.read_text(encoding="utf-8").splitlines(), urls)

    def test_latest_first_keeps_deleted_reconciliation(self) -> None:
        scope = _local_collector_functions()
        with TemporaryDirectory() as folder:
            root = Path(folder)
            old = "https://www.youtube.com/watch?v=ooooooooooo"
            deleted = "https://www.youtube.com/watch?v=ddddddddddd"
            newest = "https://www.youtube.com/watch?v=nnnnnnnnnnn"
            (root / "urls.txt").write_text(f"{old}\n{deleted}\n", encoding="utf-8")
            scope.update({
                "get_channel_info": lambda _channel: {"channel_id": "channel"},
                "get_channel_data_path": lambda _channel: root,
                "fetch_all_video_urls": lambda _key, _channel, _logger: [newest, old],
            })
            result = scope["collect_channel_urls"]("tzuyang", "unused", _Logger(), latest_first=True)
            self.assertEqual((result["new_saved"], result["deleted_count"]), (1, 1))
            self.assertEqual((root / "urls.txt").read_text(encoding="utf-8").splitlines(), [newest, old])
            self.assertIn(deleted, (root / "deleted_urls.txt").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
