#!/usr/bin/env python3
"""Review-only rule entrypoint: never spend a second Gemini/CLI operation."""
import importlib.util
from pathlib import Path

RULE_SCRIPT = Path(__file__).resolve().parents[1] / 'restaurant-evaluation/scripts/10-rule-evaluation.py'


def load_review_rules():
    spec = importlib.util.spec_from_file_location('restaurant_review_rules', RULE_SCRIPT)
    rule = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(rule)
    # The shared rule pipeline has an optional foreign-location Gemini CLI
    # fallback. Review claims have one funded SDK allowance for LAAJ+judgment;
    # unresolved locations must stay pending, even if CLI OAuth is installed.
    rule._run_gemini_fallback_query = lambda *_args, **_kwargs: {
        'ok': False, 'pending_reason': rule.PENDING_REASON_INSUFFICIENT,
        'error': 'review_gemini_fallback_disabled',
    }
    return rule


def main():
    return load_review_rules().main()


if __name__ == '__main__':
    raise SystemExit(main())
