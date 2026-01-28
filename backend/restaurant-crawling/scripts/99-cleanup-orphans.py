#!/usr/bin/env python3
"""
Orphan Transcript Cleanup Script
- Scans `data/{channel}/transcript`
- Checks if corresponding `data/{channel}/meta` file exists
- Deletes transcript if meta is missing
"""

import os
import glob
import argparse
import sys
from pathlib import Path

def main():
    parser = argparse.ArgumentParser(description="Clean up orphan transcript files")
    parser.add_argument("--channel", default="tzuyang", help="Channel name (folder name)")
    args = parser.parse_args()

    SCRIPT_DIR = Path(__file__).parent.resolve()
    # Path resolution: script -> restaurant-crawling -> backend -> ... -> data/{channel}
    # Current structure: backend/restaurant-crawling/scripts/99...py
    # Data is at: backend/restaurant-crawling/data/
    DATA_ROOT = (SCRIPT_DIR / "../data").resolve()
    DATA_DIR = DATA_ROOT / args.channel
    
    TRANSCRIPT_DIR = DATA_DIR / "transcript"
    META_DIR = DATA_DIR / "meta"

    if not TRANSCRIPT_DIR.exists():
        print(f"❌ Transcript directory not found: {TRANSCRIPT_DIR}", file=sys.stderr)
        return

    transcript_files = glob.glob(str(TRANSCRIPT_DIR / "*.jsonl"))
    print(f"🔍 Scanning {len(transcript_files)} transcript files in '{args.channel}'...", file=sys.stderr)

    orphans = []
    for t_path in transcript_files:
        video_id = os.path.basename(t_path)
        meta_path = META_DIR / video_id
        
        if not meta_path.exists():
            orphans.append(t_path)

    if not orphans:
        print("✅ No orphan files found.", file=sys.stderr)
        return

    print(f"⚠️ Found {len(orphans)} orphan files.", file=sys.stderr)
    
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
