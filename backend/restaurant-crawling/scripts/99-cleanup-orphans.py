#!/usr/bin/env python3
"""
Orphan Transcript Cleanup Script
- Scans `data/tzuyang/transcript`
- Checks if corresponding `data/tzuyang/meta` file exists
- Deletes transcript if meta is missing
"""

import os
import glob
from pathlib import Path

def main():
    SCRIPT_DIR = Path(__file__).parent.resolve()
    # 경로 수정: tzudong/backend/restaurant-crawling/scripts/ 이므로 ../data/tzuyang 가 맞음
    DATA_DIR = (SCRIPT_DIR / "../data/tzuyang").resolve()
    TRANSCRIPT_DIR = DATA_DIR / "transcript"
    META_DIR = DATA_DIR / "meta"

    if not TRANSCRIPT_DIR.exists():
        print(f"❌ Transcript directory not found: {TRANSCRIPT_DIR}")
        return

    transcript_files = glob.glob(str(TRANSCRIPT_DIR / "*.jsonl"))
    print(f"🔍 Scanning {len(transcript_files)} transcript files...")

    orphans = []
    for t_path in transcript_files:
        video_id = os.path.basename(t_path)
        meta_path = META_DIR / video_id
        
        if not meta_path.exists():
            orphans.append(t_path)

    if not orphans:
        print("✅ No orphan files found.")
        return

    print(f"⚠️ Found {len(orphans)} orphan files.")
    for path in orphans:
        print(f"  - Deleting: {os.path.basename(path)}")
        os.remove(path)

    print(f"\n🗑️ Deleted {len(orphans)} files.")

if __name__ == "__main__":
    main()
