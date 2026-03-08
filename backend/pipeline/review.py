"""
Human-in-the-loop 리뷰 큐 시스템.

검증 실패 레코드를 파일 기반 큐에 저장하고,
관리자가 CLI로 approve/reject/modify 할 수 있도록 한다.
"""

from __future__ import annotations

import json
import shutil
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

from .state import ReviewStatus

KST = timezone(timedelta(hours=9))


class ReviewQueue:
    """
    파일 기반 리뷰 큐.

    구조:
      data/{channel}/review_queue/
        pending/   ← 검증 실패 항목 대기
        approved/  ← 관리자 승인
        rejected/  ← 관리자 거부
        modified/  ← 관리자 수정 후 재진입 대기
    """

    def __init__(self, base_path: str | Path, channel: str):
        self.base = Path(base_path) / channel / "review_queue"
        self.pending_dir = self.base / "pending"
        self.approved_dir = self.base / "approved"
        self.rejected_dir = self.base / "rejected"
        self.modified_dir = self.base / "modified"

        for d in (self.pending_dir, self.approved_dir, self.rejected_dir, self.modified_dir):
            d.mkdir(parents=True, exist_ok=True)

    # ─── 큐 쓰기 ──────────────────────────────────────────

    def enqueue(
        self,
        video_id: str,
        step: str,
        errors: list[dict],
        original_data: dict,
    ) -> Path:
        """검증 실패 항목을 pending 큐에 추가한다."""
        timestamp = datetime.now(KST).strftime("%Y%m%d_%H%M%S")
        filename = f"{video_id}__{step}__{timestamp}.json"
        filepath = self.pending_dir / filename

        item = {
            "video_id": video_id,
            "step": step,
            "errors": errors,
            "original_data": original_data,
            "status": ReviewStatus.PENDING.value,
            "created_at": datetime.now(KST).isoformat(),
            "admin_note": "",
            "modified_data": None,
        }

        filepath.write_text(json.dumps(item, ensure_ascii=False, indent=2), encoding="utf-8")
        return filepath

    # ─── 큐 읽기 ──────────────────────────────────────────

    def list_pending(self) -> list[dict]:
        """대기 중인 항목 목록을 반환한다."""
        return self._list_dir(self.pending_dir)

    def list_approved(self) -> list[dict]:
        return self._list_dir(self.approved_dir)

    def list_rejected(self) -> list[dict]:
        return self._list_dir(self.rejected_dir)

    def list_modified(self) -> list[dict]:
        return self._list_dir(self.modified_dir)

    def _list_dir(self, directory: Path) -> list[dict]:
        items = []
        for f in sorted(directory.glob("*.json")):
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
                data["_filepath"] = str(f)
                items.append(data)
            except (json.JSONDecodeError, OSError):
                continue
        return items

    # ─── 상태 전환 ─────────────────────────────────────────

    def approve(self, filename: str, admin_note: str = "") -> bool:
        """pending → approved로 이동"""
        return self._transition(filename, self.pending_dir, self.approved_dir,
                                ReviewStatus.APPROVED.value, admin_note)

    def reject(self, filename: str, admin_note: str = "") -> bool:
        """pending → rejected로 이동"""
        return self._transition(filename, self.pending_dir, self.rejected_dir,
                                ReviewStatus.REJECTED.value, admin_note)

    def modify(self, filename: str, modified_data: dict, admin_note: str = "") -> bool:
        """pending → modified로 이동 (수정된 데이터 포함)"""
        src = self.pending_dir / filename
        if not src.exists():
            return False

        item = json.loads(src.read_text(encoding="utf-8"))
        item["status"] = ReviewStatus.MODIFIED.value
        item["admin_note"] = admin_note
        item["modified_data"] = modified_data
        item["reviewed_at"] = datetime.now(KST).isoformat()

        dst = self.modified_dir / filename
        dst.write_text(json.dumps(item, ensure_ascii=False, indent=2), encoding="utf-8")
        src.unlink()
        return True

    def _transition(
        self, filename: str, src_dir: Path, dst_dir: Path,
        new_status: str, admin_note: str,
    ) -> bool:
        src = src_dir / filename
        if not src.exists():
            return False

        item = json.loads(src.read_text(encoding="utf-8"))
        item["status"] = new_status
        item["admin_note"] = admin_note
        item["reviewed_at"] = datetime.now(KST).isoformat()

        dst = dst_dir / filename
        dst.write_text(json.dumps(item, ensure_ascii=False, indent=2), encoding="utf-8")
        src.unlink()
        return True

    # ─── 통계 ──────────────────────────────────────────────

    def stats(self) -> dict:
        """큐 통계 반환"""
        return {
            "pending": len(list(self.pending_dir.glob("*.json"))),
            "approved": len(list(self.approved_dir.glob("*.json"))),
            "rejected": len(list(self.rejected_dir.glob("*.json"))),
            "modified": len(list(self.modified_dir.glob("*.json"))),
        }

    # ─── 재진입 ────────────────────────────────────────────

    def get_reentry_items(self) -> list[dict]:
        """
        modified/ 폴더의 항목을 재진입 데이터로 변환.
        재처리 후 해당 파일을 approved/로 이동.
        """
        items = self.list_modified()
        reentry = []
        for item in items:
            data = item.get("modified_data") or item.get("original_data")
            reentry.append({
                "video_id": item["video_id"],
                "step": item["step"],
                "data": data,
                "_filepath": item["_filepath"],
            })
        return reentry

    def mark_reentry_done(self, filepath: str) -> None:
        """재진입 완료된 modified 항목을 approved로 이동"""
        src = Path(filepath)
        if not src.exists():
            return
        dst = self.approved_dir / src.name
        shutil.move(str(src), str(dst))
