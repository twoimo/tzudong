"""Property-based tests for the environment-contract check (Env_Contract_Check).

Feature: crawler-pipeline-orchestration (design Properties 28-32, Requirement 7).

Target module: backend/bin/check_env_contract.py
  API exercised: validate(profile, env), _present(env, name), _is_placeholder(value),
  PROFILES, FORBIDDEN_ENV_NAMES, PLACEHOLDER_MARKERS, allowed_aliases, main(--json).

These tests treat the check as a black box: they only ever assert on names and
presence/status booleans, never on secret values, matching the contract's own
name-and-presence-only reporting guarantee.

Runnable via ``python -m unittest`` (hypothesis integrates with unittest.TestCase).
"""
from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import os
import string
import unittest
from pathlib import Path
from unittest import mock

from hypothesis import assume, given, settings
from hypothesis import strategies as st

BACKEND_ROOT = Path(__file__).resolve().parents[2]
ENV_CONTRACT_SOURCE = BACKEND_ROOT / "bin" / "check_env_contract.py"


def _load_env_contract():
    spec = importlib.util.spec_from_file_location(
        "check_env_contract_pbt_target", ENV_CONTRACT_SOURCE
    )
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


env_contract = _load_env_contract()

PROFILE_NAMES = sorted(env_contract.PROFILES)
PROFILES_WITH_ALIASES = sorted(
    name for name, spec in env_contract.PROFILES.items() if spec["allowed_aliases"]
)

# A value that is non-blank, not a known placeholder marker, and not a templated
# ``<...>``/``${...}`` shape, so ``_present`` treats it as a real secret binding.
valid_secret_values = st.text(
    alphabet=string.ascii_letters + string.digits + "-_.",
    min_size=1,
    max_size=48,
).map(lambda tail: "val-" + tail)

# A value carrying a unique sentinel so an absence assertion against the serialized
# report is meaningful (the token is not a substring of any name, boolean, or key).
secret_value_tokens = st.text(
    alphabet=string.ascii_letters + string.digits,
    min_size=6,
    max_size=40,
).map(lambda tail: "ZZSECRETZZ" + tail)


def _decorate_marker(marker: str, pad_left: int, pad_right: int, upper: bool) -> str:
    rendered = marker.upper() if upper else marker
    return (" " * pad_left) + rendered + (" " * pad_right)


_placeholder_markers = st.sampled_from(sorted(env_contract.PLACEHOLDER_MARKERS))
_decorated_markers = st.builds(
    _decorate_marker,
    _placeholder_markers,
    st.integers(min_value=0, max_value=3),
    st.integers(min_value=0, max_value=3),
    st.booleans(),
)
_templated_inner = st.text(
    alphabet=string.ascii_letters + string.digits + "-_", min_size=0, max_size=20
)
_templated_values = st.one_of(
    _templated_inner.map(lambda inner: "<" + inner + ">"),
    _templated_inner.map(lambda inner: "${" + inner + "}"),
)
placeholder_values = st.one_of(_decorated_markers, _templated_values)


class EnvContractPropertyTests(unittest.TestCase):
    # Feature: crawler-pipeline-orchestration, Property 28: Missing required secret halts before any work — when a required secret for a profile is absent, validate reports not-satisfied and the CLI exits non-zero.
    @settings(max_examples=100)
    @given(data=st.data())
    def test_property_28_missing_required_secret_halts(self, data):
        profile = data.draw(st.sampled_from(PROFILE_NAMES))
        required = list(env_contract.PROFILES[profile]["required"])
        omitted = data.draw(
            st.lists(st.sampled_from(required), min_size=1, unique=True)
        )

        env = {
            name: data.draw(valid_secret_values)
            for name in required
            if name not in omitted
        }

        with mock.patch.dict(os.environ, env, clear=True):
            result = env_contract.validate(profile, dict(os.environ))
            with contextlib.redirect_stdout(io.StringIO()):
                exit_code = env_contract.main(["--profile", profile, "--json"])

        self.assertFalse(result["ok"])
        self.assertNotEqual(exit_code, 0)
        # Each omitted required secret is reported missing by its canonical name.
        for name in omitted:
            self.assertIn(name, result["missingRequired"])
        # No partial results: missingRequired holds only canonical required names.
        self.assertTrue(set(result["missingRequired"]).issubset(set(required)))

    # Feature: crawler-pipeline-orchestration, Property 29: Placeholder values do not satisfy a required secret — a required secret bound to any placeholder/templated marker is treated as absent/not-satisfied.
    @settings(max_examples=100)
    @given(data=st.data())
    def test_property_29_placeholder_does_not_satisfy(self, data):
        profile = data.draw(st.sampled_from(PROFILE_NAMES))
        required = list(env_contract.PROFILES[profile]["required"])
        target = data.draw(st.sampled_from(required))
        placeholder = data.draw(placeholder_values)
        assume(env_contract._is_placeholder(placeholder))

        env = {name: data.draw(valid_secret_values) for name in required}
        env[target] = placeholder  # bind the target only to a placeholder marker

        result = env_contract.validate(profile, dict(env))

        self.assertFalse(env_contract._present(env, target))
        self.assertFalse(result["required"][target])
        self.assertIn(target, result["missingRequired"])
        self.assertFalse(result["ok"])

    # Feature: crawler-pipeline-orchestration, Property 30: Forbidden legacy names fail the contract — presence of any FORBIDDEN_ENV_NAMES makes the contract not-satisfied and the CLI exits non-zero.
    @settings(max_examples=100)
    @given(data=st.data())
    def test_property_30_forbidden_names_fail_contract(self, data):
        profile = data.draw(st.sampled_from(PROFILE_NAMES))
        required = list(env_contract.PROFILES[profile]["required"])
        forbidden = data.draw(
            st.lists(
                st.sampled_from(env_contract.FORBIDDEN_ENV_NAMES),
                min_size=1,
                unique=True,
            )
        )

        # All required secrets satisfied, so only the forbidden names can fail it.
        env = {name: data.draw(valid_secret_values) for name in required}
        for name in forbidden:
            env[name] = data.draw(valid_secret_values)

        with mock.patch.dict(os.environ, env, clear=True):
            result = env_contract.validate(profile, dict(os.environ))
            with contextlib.redirect_stdout(io.StringIO()):
                exit_code = env_contract.main(["--profile", profile, "--json"])

        self.assertFalse(result["ok"])
        self.assertNotEqual(exit_code, 0)
        for name in forbidden:
            self.assertIn(name, result["forbiddenPresent"])

    # Feature: crawler-pipeline-orchestration, Property 31: Env-contract report never emits a secret value — the machine-readable report contains only names and presence booleans, never the value.
    @settings(max_examples=100)
    @given(data=st.data())
    def test_property_31_report_never_emits_secret_value(self, data):
        profile = data.draw(st.sampled_from(PROFILE_NAMES))
        spec = env_contract.PROFILES[profile]
        names = (
            list(spec["required"])
            + list(spec["optional"])
            + list(spec["allowed_aliases"])
        )

        env = {}
        secret_values = []
        for name in names:
            value = data.draw(secret_value_tokens)
            env[name] = value
            secret_values.append(value)

        result = env_contract.validate(profile, dict(env))
        serialized = json.dumps(result, ensure_ascii=False, sort_keys=True)

        with mock.patch.dict(os.environ, env, clear=True):
            buffer = io.StringIO()
            with contextlib.redirect_stdout(buffer):
                env_contract.main(["--profile", profile, "--json"])
            cli_output = buffer.getvalue()

        # No secret value string leaks into the structured report or CLI output.
        for value in secret_values:
            self.assertNotIn(value, serialized)
            self.assertNotIn(value, cli_output)

        # Names and presence booleans are still reported.
        for name in spec["required"]:
            self.assertIn(name, result["required"])
            self.assertIsInstance(result["required"][name], bool)

    # Feature: crawler-pipeline-orchestration, Property 32: An allowed alias satisfies its required secret — an allowed alias bound to a non-empty non-placeholder value is recognized as present even when the canonical name is unset.
    @settings(max_examples=100)
    @given(data=st.data())
    def test_property_32_allowed_alias_recognized_present(self, data):
        profile = data.draw(st.sampled_from(PROFILES_WITH_ALIASES))
        aliases = list(env_contract.PROFILES[profile]["allowed_aliases"])
        chosen = data.draw(st.lists(st.sampled_from(aliases), min_size=1, unique=True))

        # Bind only the allowed aliases; every canonical required name stays unset.
        env = {alias: data.draw(valid_secret_values) for alias in chosen}

        result = env_contract.validate(profile, dict(env))

        for alias in chosen:
            self.assertTrue(env_contract._present(env, alias))
            self.assertIn(alias, result["runtimeAliasesPresent"])


if __name__ == "__main__":
    unittest.main()
