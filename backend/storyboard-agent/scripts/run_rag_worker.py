#!/usr/bin/env python3
"""Run the local storyboard FastAPI RAG worker."""

from __future__ import annotations

import os
import sys
from pathlib import Path

import uvicorn


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

if __name__ == "__main__":
    host = os.environ.get("STORYBOARD_RAG_WORKER_HOST", "127.0.0.1")
    port = int(os.environ.get("STORYBOARD_RAG_WORKER_PORT", "8765"))
    uvicorn.run(
        "src.rag_worker:app",
        host=host,
        port=port,
        reload=os.environ.get("STORYBOARD_RAG_WORKER_RELOAD") == "1",
        log_level=os.environ.get("STORYBOARD_RAG_WORKER_LOG_LEVEL", "info"),
        app_dir=str(ROOT),
    )
