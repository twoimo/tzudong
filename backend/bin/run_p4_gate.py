#!/usr/bin/env python3
"""Evaluate the current P4 supply-chain gate."""

try:
    from backend.bin.phase_gate import cli_for_phase, run_configured_phase
except ModuleNotFoundError:  # direct script execution
    from phase_gate import cli_for_phase, run_configured_phase

PHASE_ID = "P4-supply-chain"


def run_p4_gate(**kwargs):
    return run_configured_phase(PHASE_ID, **kwargs)


if __name__ == "__main__":
    raise SystemExit(cli_for_phase(PHASE_ID))
