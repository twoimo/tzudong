#!/usr/bin/env python3
"""Run `agy --print` through a PTY and write clean stdout to a file.

Antigravity CLI currently behaves like a TUI even in print mode: it can query
terminal cursor position and may not emit capturable output through plain pipes.
This bridge gives non-interactive scripts and GitHub Actions a small PTY shim.
"""
from __future__ import annotations

import argparse
import json
import os
import pty
import re
import select
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path


ANSI_RE = re.compile(
    r"\x1b\][^\x07]*(?:\x07|\x1b\\)"
    r"|\x1b\[[0-?]*[ -/]*[@-~]"
    r"|\x1b[@-_]"
)
AUTH_REQUIRED_RE = re.compile(
    r"Authentication required|Please visit the URL to log in|accounts\.google\.com/o/oauth2/auth",
    re.IGNORECASE,
)
QUOTA_RE = re.compile(
    r"429|quota|rate limit|RESOURCE_EXHAUSTED|Too Many Requests|exhausted",
    re.IGNORECASE,
)


def _is_wsl() -> bool:
    try:
        return "microsoft" in Path("/proc/version").read_text(encoding="utf-8").lower()
    except OSError:
        return False


def _windows_profile_from_wsl() -> Path | None:
    try:
        result = subprocess.run(
            ["cmd.exe", "/c", "echo %USERPROFILE%"],
            check=False,
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    profile = result.stdout.strip().replace("\\", "/")
    if not profile or profile == "%USERPROFILE%" or ":" not in profile:
        return None
    drive, rest = profile.split(":", 1)
    return Path(f"/mnt/{drive.lower()}{rest}")


def locate_agy() -> str | None:
    override = os.environ.get("AGY_CLI_PATH", "").strip()
    if override:
        return override

    found = shutil.which("agy")
    if found:
        return found

    if _is_wsl():
        profile = _windows_profile_from_wsl()
        if profile:
            candidate = profile / "AppData/Local/agy/bin/agy.exe"
            if candidate.exists():
                return str(candidate)
    return None


def settings_paths(agy_path: str | None) -> list[Path]:
    paths = [Path.home() / ".gemini/antigravity-cli/settings.json"]
    if _is_wsl():
        profile = _windows_profile_from_wsl()
        if profile:
            paths.append(profile / ".gemini/antigravity-cli/settings.json")
    if agy_path and agy_path.lower().endswith(".exe"):
        # C:\Users\<user>\AppData\Local\agy\bin\agy.exe -> C:\Users\<user>
        exe_path = Path(agy_path)
        try:
            user_profile = exe_path.parents[4]
            paths.append(user_profile / ".gemini/antigravity-cli/settings.json")
        except IndexError:
            pass
    return paths


def config_model(agy_path: str | None) -> str:
    for path in settings_paths(agy_path):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        model = str(data.get("model") or "").strip()
        if model:
            return model
    return "Antigravity default model"


def parse_duration_seconds(value: str) -> int:
    value = str(value or "").strip().lower()
    if not value:
        return 300
    match = re.fullmatch(r"(\d+)(ms|s|m|h)?", value)
    if not match:
        return 300
    amount = int(match.group(1))
    unit = match.group(2) or "s"
    if unit == "ms":
        return max(1, amount // 1000)
    if unit == "m":
        return amount * 60
    if unit == "h":
        return amount * 3600
    return amount


def strip_terminal_noise(raw: bytes) -> str:
    text = raw.decode("utf-8", errors="replace").replace("\r\n", "\n").replace("\r", "\n")
    text = ANSI_RE.sub("", text).replace("\x1b", "").replace("^[", "")
    # Remove terminal cursor-position replies if they were echoed.
    text = re.sub(r"\[\d+;\d+R", "", text)
    lines = [line.rstrip() for line in text.splitlines()]
    return "\n".join(line for line in lines if line.strip()).strip()


def classify_cli_failure(clean: str) -> int:
    """Return a non-zero shell status for textual agy failures that exit 0."""
    if AUTH_REQUIRED_RE.search(clean):
        return 125
    if QUOTA_RE.search(clean):
        return 75
    return 0


def compatible_cwd(agy_path: str) -> str:
    cwd = os.getcwd()
    if agy_path.lower().endswith(".exe") and cwd.startswith("/home/"):
        profile = _windows_profile_from_wsl()
        if profile and profile.exists():
            return str(profile)
    return cwd


def run_with_pty(cmd: list[str], timeout_sec: int, cwd: str) -> tuple[int, bytes]:
    master_fd, slave_fd = pty.openpty()
    process = subprocess.Popen(
        cmd,
        stdin=slave_fd,
        stdout=slave_fd,
        stderr=slave_fd,
        cwd=cwd,
        close_fds=True,
    )
    os.close(slave_fd)
    captured = bytearray()
    deadline = time.monotonic() + timeout_sec

    try:
        while True:
            if process.poll() is not None:
                while True:
                    readable, _, _ = select.select([master_fd], [], [], 0)
                    if not readable:
                        break
                    try:
                        chunk = os.read(master_fd, 65536)
                    except OSError:
                        break
                    if not chunk:
                        break
                    captured.extend(chunk)
                return process.returncode or 0, bytes(captured)

            if time.monotonic() > deadline:
                process.send_signal(signal.SIGTERM)
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                captured.extend(b"\nError: timed out waiting for agy response\n")
                return 124, bytes(captured)

            readable, _, _ = select.select([master_fd], [], [], 0.2)
            if not readable:
                continue
            try:
                chunk = os.read(master_fd, 65536)
            except OSError:
                continue
            if not chunk:
                continue
            captured.extend(chunk)
            if b"Authentication required" in captured or b"accounts.google.com/o/oauth2/auth" in captured:
                process.send_signal(signal.SIGTERM)
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                return 125, bytes(captured)
            if b"\x1b[6n" in chunk:
                os.write(master_fd, b"\x1b[1;1R")
    finally:
        try:
            os.close(master_fd)
        except OSError:
            pass


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--prompt-file")
    source.add_argument("--prompt-text")
    parser.add_argument("--output")
    parser.add_argument("--stderr-file")
    parser.add_argument("--agy-path")
    parser.add_argument("--print-timeout", default=os.environ.get("AGY_PRINT_TIMEOUT", "5m0s"))
    parser.add_argument("--timeout-sec", type=int, default=0)
    parser.add_argument("--locate-only", action="store_true")
    parser.add_argument("--print-config-model", action="store_true")
    args = parser.parse_args(argv)

    agy_path = args.agy_path or locate_agy()
    if args.locate_only:
        if agy_path:
            print(agy_path)
            return 0
        return 1
    if args.print_config_model:
        print(config_model(agy_path))
        return 0
    if not agy_path:
        message = "agy executable not found"
        if args.stderr_file:
            Path(args.stderr_file).write_text(message + "\n", encoding="utf-8")
        else:
            print(message, file=sys.stderr)
        return 127

    if agy_path.lower().endswith(".exe") and _is_wsl() and os.environ.get("AGY_ALLOW_WINDOWS_EXE_BRIDGE") != "true":
        message = (
            "Windows agy.exe is installed, but WSL cannot reliably capture its "
            "print-mode TUI output non-interactively; install native Linux agy "
            "or run this bridge with AGY_ALLOW_WINDOWS_EXE_BRIDGE=true for manual experiments"
        )
        if args.stderr_file:
            Path(args.stderr_file).write_text(message + "\n", encoding="utf-8")
        else:
            print(message, file=sys.stderr)
        return 126

    if args.prompt_file:
        prompt = Path(args.prompt_file).read_text(encoding="utf-8")
    else:
        prompt = args.prompt_text or ""
    if not prompt.strip():
        print("empty prompt", file=sys.stderr)
        return 2

    timeout_sec = args.timeout_sec or parse_duration_seconds(args.print_timeout) + 30
    cmd = [agy_path, "--print", prompt, "--print-timeout", args.print_timeout]
    code, raw = run_with_pty(cmd, timeout_sec=timeout_sec, cwd=compatible_cwd(agy_path))
    clean = strip_terminal_noise(raw)

    if args.output:
        Path(args.output).write_text(clean + ("\n" if clean else ""), encoding="utf-8")
    else:
        print(clean)
    if args.stderr_file:
        Path(args.stderr_file).write_text(clean + ("\n" if clean else ""), encoding="utf-8")
    classified_failure = classify_cli_failure(clean)
    if classified_failure:
        return classified_failure
    return code


if __name__ == "__main__":
    raise SystemExit(main())
