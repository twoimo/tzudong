#!/usr/bin/env python3
"""
Orphan Transcript Cleanup Script (Deep Validation)
- Scans `data/{channel}/transcript`
- Checks if corresponding `data/{channel}/meta` file exists
- [Deep Check] Checks if `recollect_id` in transcript matches any entry in meta
- Deletes transcript if meta is missing OR version mismatch
"""

import os
import glob
import json
import argparse
import sys
from pathlib import Path
from typing import Optional, Dict, List, Any


def read_jsonl(data_path: str) -> Optional[Dict[str, Any]]:
    """
    JSONL 파일에서 가장 마지막(최신) 라인 읽기

    Args:
        data_path: JSONL 파일 경로

    Returns:
        파싱된 JSON 딕셔너리 또는 None (실패 시)
    """
    try:
        with open(data_path, "r", encoding="utf-8") as f:
            lines = f.readlines()
            if lines:
                return json.loads(lines[-1])
    except Exception:
        # 파일 읽기 실패 시 None 반환 (손상된 파일일 가능성)
        return None
    return None


def has_matching_metadata(meta_path: str, recollect_id: int) -> bool:
    """
    메타데이터 파일에서 recollect_id가 일치하는 것이 있는지 확인 (Deep Validation)

    Args:
        meta_path: 메타데이터 JSONL 파일 경로
        recollect_id: 트랜스크립트 파일의 recollect_id

    Returns:
        True if match found, else False
    """
    if not os.path.exists(meta_path):
        return False
        
    try:
        with open(meta_path, "r", encoding="utf-8") as f:
            lines = f.readlines()
            # 최신부터 역순 검색 (Optimized search)
            for line in reversed(lines):
                if line.strip():
                    try:
                        meta = json.loads(line)
                        if meta.get("recollect_id") == recollect_id:
                            return True
                    except json.JSONDecodeError:
                        continue
    except Exception:
        return False
    return False


def main() -> None:
    parser = argparse.ArgumentParser(description="Clean up orphan transcript files (Deep Check)")
    parser.add_argument("--channel", default="tzuyang", help="Channel name (folder name)")
    args = parser.parse_args()

    # 경로 설정
    SCRIPT_DIR = Path(__file__).parent.resolve()
    DATA_ROOT = (SCRIPT_DIR / "../data").resolve()
    DATA_DIR = DATA_ROOT / args.channel
    
    TRANSCRIPT_DIR = DATA_DIR / "transcript"
    META_DIR = DATA_DIR / "meta"

    if not TRANSCRIPT_DIR.exists():
        print(f"❌ Transcript directory not found: {TRANSCRIPT_DIR}", file=sys.stderr)
        return

    transcript_files = glob.glob(str(TRANSCRIPT_DIR / "*.jsonl"))
    print(f"🔍 Scanning {len(transcript_files)} transcript files in '{args.channel}' (Deep Validation)...", file=sys.stderr)

    orphans: List[str] = []
    
    # [Deep Validation]
    # 03.1 스크립트와 동일한 정합성 검사 로직 적용
    for t_path in transcript_files:
        video_id = os.path.basename(t_path)
        meta_path = META_DIR / video_id
        
        # 1. 메타 파일 존재 여부 확인
        if not meta_path.exists():
            orphans.append(t_path)
            continue
            
        # 2. 내용 정합성 확인 (recollect_id 매칭)
        t_data = read_jsonl(t_path)
        if not t_data:
            # 트랜스크립트 파일이 비었거나 깨짐 -> 삭제 대상
            orphans.append(t_path)
            continue
            
        t_recollect_id = t_data.get("recollect_id", 0)
        
        # 메타 파일은 있지만, 해당 버전(recollect_id)과 일치하는 메타가 없음 -> 불일치(Orphan)
        if not has_matching_metadata(str(meta_path), t_recollect_id):
            orphans.append(t_path)

    if not orphans:
        print("✅ No orphan files found.", file=sys.stderr)
        return

    print(f"⚠️ Found {len(orphans)} orphan/mismatched files.", file=sys.stderr)
    
    deleted_count = 0
    failed_count = 0

    for path in orphans:
        try:
            filename = os.path.basename(path)
            os.remove(path)
            print(f"  - 🗑️ Deleted: {filename}")
            deleted_count += 1
        except OSError as e:
            print(f"  - ❌ Failed to delete {filename}: {e}", file=sys.stderr)
            failed_count += 1

    print(f"\n✅ Cleanup Complete: Deleted {deleted_count} files, Failed {failed_count}.", file=sys.stderr)


if __name__ == "__main__":
    main()
