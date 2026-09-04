#!/usr/bin/env python3
"""Evaluate the current P5 layout/naming gate."""

try:
    from backend.bin.phase_gate import cli_for_phase, run_configured_phase
except ModuleNotFoundError:  # direct script execution
    from phase_gate import cli_for_phase, run_configured_phase

PHASE_ID = "P5-layout-naming"


def run_p5_gate(**kwargs):
    return run_configured_phase(PHASE_ID, **kwargs)


if __name__ == "__main__":
    raise SystemExit(cli_for_phase(PHASE_ID))
