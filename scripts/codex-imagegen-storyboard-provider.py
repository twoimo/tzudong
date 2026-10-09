#!/usr/bin/env python3
"""Retired storyboard producer. Existing assets remain readable."""
import json
import sys


def main():
    print(json.dumps({"ok": False, "code": "storyboard_gemini_only", "command": "storyboard:gemini-worker"}))
    return 0 if '--help' in sys.argv or '-h' in sys.argv else 2


if __name__ == '__main__':
    raise SystemExit(main())
