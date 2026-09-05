#!/usr/bin/env python3
"""Local tool preflight for the platform-modernization spec (Requirements 8.7, 8.9).

This is the ``heavy_local`` runtime preflight described in design section C4
("로컬 도구 프리플라이트"). Before any pipeline step runs, it documents and
checks each tool required by the ``heavy_local`` compute profile with the three
fields Requirement 8.7 mandates:

  * the tool name,
  * a verification command that runs with no human input, and
  * an absence criterion for that command.

Design C4 tool table (this module is the source of record for it):

  | Tool           | Verify command                             | Absence criterion                          |
  | -------------- | ------------------------------------------ | ------------------------------------------ |
  | Python         | ``python3 --version``                      | exit != 0 or output not ``Python 3.``      |
  | Node           | ``node --version``                         | exit != 0 or output not starting with ``v``|
  | ffmpeg         | ``ffmpeg -hide_banner -version``           | exit != 0                                  |
  | Docker         | ``docker version --format {{.Server.Version}}`` | exit != 0 or empty output             |
  | Docker Compose | ``docker compose version --short``         | exit != 0 or empty output                  |
  | psycopg2       | ``python3 -c "import psycopg2"``           | exit != 0                                  |
  | Hypothesis     | ``python3 -c "import hypothesis"``         | exit != 0                                  |
  | Rust toolchain | ``cargo --version``                        | exit != 0  (required only from phase 6)    |

If any required tool is judged absent, the preflight halts before the first
step with the fixed code ``heavy_local_runtime_missing`` (Requirement 8.9) and
reports only the absent tool NAMES. It never records captured stdout/stderr,
provider diagnostics, or any free-form error text.

``backend/bin`` scripts are standalone (no ``__init__.py``); this module is
loaded by path by its callers/tests. Command execution is injectable via a
``runner`` parameter so the preflight is unit-testable without depending on
which tools happen to be installed on the host, and performs no network I/O.
"""

from __future__ import annotations

import json
import subprocess
from typing import Callable, NamedTuple, Sequence

# ---------------------------------------------------------------------------
# Fixed constants (design C4).
# ---------------------------------------------------------------------------

# The fixed code returned before the first step when any required local tool is
# judged absent (Requirement 8.9).
HEAVY_LOCAL_RUNTIME_MISSING = "heavy_local_runtime_missing"

# The earliest phase (design section "단계 순서") that runs the heavy_local
# pipeline. Tools required for that pipeline carry this as their
# ``required_from_phase``. The Rust toolchain is not needed until P6.
DEFAULT_PHASE = 1
RUST_TOOLCHAIN_PHASE = 6

# A command runner takes an argv sequence and returns ``(returncode, stdout)``.
# Only the numeric exit code and captured stdout text reach the absence
# predicates; stderr is discarded by the default runner so provider diagnostics
# never enter the bounded result.
CommandRunner = Callable[[Sequence[str]], "tuple[int, str]"]

# An absence predicate takes ``(returncode, stdout)`` and returns True when the
# tool is judged ABSENT for that command's result.
AbsencePredicate = Callable[[int, str], bool]


# ---------------------------------------------------------------------------
# Absence predicates (design C4 "부재 판정 기준" column).
# ---------------------------------------------------------------------------


def _absent_if_nonzero(returncode: int, stdout: str) -> bool:
    """Absent when the command exits non-zero. Output is not inspected."""

    return returncode != 0


def _absent_if_nonzero_or_empty(returncode: int, stdout: str) -> bool:
    """Absent when the command exits non-zero or produces empty output."""

    return returncode != 0 or not stdout.strip()


def _absent_unless_python3(returncode: int, stdout: str) -> bool:
    """Absent unless the command succeeds and output starts with ``Python 3.``."""

    return returncode != 0 or not stdout.strip().startswith("Python 3.")


def _absent_unless_node_prefix(returncode: int, stdout: str) -> bool:
    """Absent unless the command succeeds and output starts with ``v``."""

    return returncode != 0 or not stdout.strip().startswith("v")


# ---------------------------------------------------------------------------
# Tool registry (design C4 tool table). Each entry documents the three
# Requirement 8.7 fields plus the phase from which the tool becomes required.
# ---------------------------------------------------------------------------


class Tool(NamedTuple):
    """A single required local tool and how to check it.

    Attributes:
        name: The tool name reported in the bounded result.
        argv: The verification command, runnable with no human input.
        absence: Predicate over ``(returncode, stdout)`` — True when absent.
        absence_criterion: Human-readable absence criterion (Requirement 8.7).
        required_from_phase: The earliest phase in which this tool is required.
    """

    name: str
    argv: tuple[str, ...]
    absence: AbsencePredicate
    absence_criterion: str
    required_from_phase: int = DEFAULT_PHASE


TOOL_REGISTRY: tuple[Tool, ...] = (
    Tool(
        name="python",
        argv=("python3", "--version"),
        absence=_absent_unless_python3,
        absence_criterion="exit code != 0 or output does not start with 'Python 3.'",
    ),
    Tool(
        name="node",
        argv=("node", "--version"),
        absence=_absent_unless_node_prefix,
        absence_criterion="exit code != 0 or output does not start with 'v'",
    ),
    Tool(
        name="ffmpeg",
        argv=("ffmpeg", "-hide_banner", "-version"),
        absence=_absent_if_nonzero,
        absence_criterion="exit code != 0",
    ),
    Tool(
        name="docker",
        argv=("docker", "version", "--format", "{{.Server.Version}}"),
        absence=_absent_if_nonzero_or_empty,
        absence_criterion="exit code != 0 or empty output",
    ),
    Tool(
        name="docker_compose",
        argv=("docker", "compose", "version", "--short"),
        absence=_absent_if_nonzero_or_empty,
        absence_criterion="exit code != 0 or empty output",
    ),
    Tool(
        name="psycopg2",
        argv=("python3", "-c", "import psycopg2"),
        absence=_absent_if_nonzero,
        absence_criterion="exit code != 0",
    ),
    Tool(
        name="hypothesis",
        argv=("python3", "-c", "import hypothesis"),
        absence=_absent_if_nonzero,
        absence_criterion="exit code != 0",
    ),
    Tool(
        name="rust_toolchain",
        argv=("cargo", "--version"),
        absence=_absent_if_nonzero,
        absence_criterion="exit code != 0",
        required_from_phase=RUST_TOOLCHAIN_PHASE,
    ),
)


# ---------------------------------------------------------------------------
# Default command runner. Execution is injectable; this is used only when no
# ``runner`` is supplied.
# ---------------------------------------------------------------------------


def _default_command_runner(argv: Sequence[str]) -> tuple[int, str]:
    """Run a verification command and return ``(returncode, stdout)``.

    Captures stdout as text and discards stderr so that provider diagnostics
    and free-form error text never enter the bounded result. A command that
    cannot be spawned at all (e.g. binary missing) is reported as a non-zero
    exit with empty output, which every absence predicate treats as absent.
    """

    try:
        completed = subprocess.run(
            list(argv),
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            check=False,
            text=True,
        )
        return completed.returncode, completed.stdout or ""
    except Exception:  # noqa: BLE001 - a missing binary must read as absent
        return 127, ""


# ---------------------------------------------------------------------------
# Preflight (design C4; Requirements 8.7, 8.9).
# ---------------------------------------------------------------------------


def run_preflight(
    *,
    runner: CommandRunner | None = None,
    phase: int = DEFAULT_PHASE,
    tools: Sequence[Tool] = TOOL_REGISTRY,
) -> dict:
    """Run the local tool preflight and return a bounded result.

    Each tool whose ``required_from_phase`` is at or below ``phase`` is
    verified with its command via ``runner`` (default: real subprocess). A tool
    is judged absent when its absence predicate holds for the command's
    ``(returncode, stdout)``.

    Returns ``{"ok", "errorCode", "present", "absent", "checked", "deferred"}``:

      * ``ok`` — True when no required tool is absent.
      * ``errorCode`` — ``heavy_local_runtime_missing`` when a required tool is
        absent (Requirement 8.9), else ``None``.
      * ``present`` / ``absent`` — required tool NAMES only, sorted for a
        stable report. No stdout/stderr, exit codes, or diagnostics.
      * ``checked`` — names of the required tools that were checked.
      * ``deferred`` — names of tools not yet required at this phase (e.g. the
        Rust toolchain before P6), so they never block earlier phases.

    The runner is never asked to run a deferred tool's command.
    """

    run = runner or _default_command_runner

    present: list[str] = []
    absent: list[str] = []
    deferred: list[str] = []

    for tool in tools:
        if tool.required_from_phase > phase:
            deferred.append(tool.name)
            continue
        returncode, stdout = run(tool.argv)
        if tool.absence(returncode, stdout):
            absent.append(tool.name)
        else:
            present.append(tool.name)

    absent.sort()
    present.sort()
    deferred.sort()

    return {
        "ok": not absent,
        "errorCode": HEAVY_LOCAL_RUNTIME_MISSING if absent else None,
        "present": present,
        "absent": absent,
        "checked": sorted(present + absent),
        "deferred": deferred,
    }


def describe_tools(*, phase: int | None = None) -> list[dict]:
    """Return the documented tool table (Requirement 8.7), names/commands only.

    Each entry carries the three documented fields — ``name``, ``command`` (the
    argv joined for display), and ``absenceCriterion`` — plus
    ``requiredFromPhase``. When ``phase`` is given, only tools required at or
    below it are listed. This contains no runtime output or diagnostics.
    """

    entries: list[dict] = []
    for tool in TOOL_REGISTRY:
        if phase is not None and tool.required_from_phase > phase:
            continue
        entries.append(
            {
                "name": tool.name,
                "command": " ".join(tool.argv),
                "absenceCriterion": tool.absence_criterion,
                "requiredFromPhase": tool.required_from_phase,
            }
        )
    return entries


# ---------------------------------------------------------------------------
# CLI entrypoint.
# ---------------------------------------------------------------------------


def main(argv: Sequence[str] | None = None) -> int:
    """CLI: run the preflight and print a bounded summary; set the exit code.

    Exit code 0 when every required tool is present; 1 when the preflight
    returns ``heavy_local_runtime_missing``. Prints only bounded status — the
    fixed code and the absent tool names — never captured command output.
    """

    import argparse

    parser = argparse.ArgumentParser(
        description=(
            "Preflight the heavy_local runtime tools without printing command output"
        )
    )
    parser.add_argument(
        "--phase",
        type=int,
        default=DEFAULT_PHASE,
        help=(
            "phase number; tools become required at their phase "
            f"(Rust toolchain from phase {RUST_TOOLCHAIN_PHASE})"
        ),
    )
    parser.add_argument(
        "--describe",
        action="store_true",
        help="print the documented tool table (Requirement 8.7) and exit 0",
    )
    parser.add_argument(
        "--json", action="store_true", help="print only machine-readable JSON"
    )
    args = parser.parse_args(list(argv) if argv is not None else None)

    if args.describe:
        table = describe_tools(phase=args.phase)
        print(json.dumps(table, ensure_ascii=True, sort_keys=True))
        return 0

    result = run_preflight(phase=args.phase)
    if args.json:
        print(json.dumps(result, ensure_ascii=True, sort_keys=True))
    else:
        print(
            f"local-runtime phase={args.phase} ok={str(result['ok']).lower()}"
        )
        if result["absent"]:
            print(f"result code: {result['errorCode']}")
            print("absent tools: " + ", ".join(result["absent"]))
        if result["deferred"]:
            print("deferred (not required at this phase): " + ", ".join(result["deferred"]))
        print(json.dumps(result, ensure_ascii=True, sort_keys=True))

    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
