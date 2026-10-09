#!/usr/bin/env python3
"""Absolute-path entrypoint for numbered shell stages."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from backend.utils.stage_cache import main

if __name__ == "__main__":
    raise SystemExit(main())
