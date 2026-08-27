"""Property-based tests for the fail-closed Supabase pipeline boundary.

Feature: crawler-pipeline-orchestration (design Properties 7-11, Requirement 3).

Targets:
  backend/utils/supabase_rest.py
    admit_pipeline_supabase_boundary  - fail-closed sink classifier
    SupabaseRestConfigurationError    - fixed, credential-safe error
    _production_url                   - canonical hosted-URL normaliser
    PIPELINE_HOSTED_APPLY_ENABLED     - compile-time False enablement latch
  backend/pipeline_control/manifest.py
    map_hosted_gate_rejection_code    - rejection -> single bounded code
    HOSTED_GATE_REJECTION_CODES       - closed rejection-code enumeration
    validate_hosted_gate_rejection_code

These tests treat the boundary as a black box. Environments are always passed as
explicit dicts (os.environ is never mutated), every call runs inside a guard that
fails on any socket use (no network access), and assertions confirm that no
service-role key value is ever returned or leaked into an error/code.

Runnable via ``python -m unittest`` (hypothesis integrates with unittest.TestCase).
"""
from __future__ import annotations

import contextlib
import socket
import unittest
from urllib.parse import urlsplit

from hypothesis import assume, given, settings
from hypothesis import strategies as st

from backend.utils import supabase_rest
from backend.utils.supabase_rest import (
    PIPELINE_DATA_SINK_ENV,
    PIPELINE_EXECUTION_MODE_ENV,
    PIPELINE_COMPUTE_PROFILE_ENV,
    PIPELINE_HOSTED_APPLY_APPROVED_ENV,
    PIPELINE_HOSTED_APPLY_ENABLED,
    PIPELINE_HOSTED_PROJECT_REF_ENV,
    PIPELINE_DATA_SINKS,
    PipelineSupabaseBoundary,
    SupabaseRestConfigurationError,
    _parse_url,
    _production_url,
    admit_pipeline_supabase_boundary,
)
from backend.pipeline_control.manifest import (
    HOSTED_GATE_REJECTION_CODES,
    map_hosted_gate_rejection_code,
    validate_hosted_gate_rejection_code,
)

# A distinctive, non-secret sentinel placed where a service-role key would live.
# No return value or error/code is ever allowed to echo it back.
SENTINEL_KEY = "SENTINEL_SERVICE_ROLE_KEY_MUST_NEVER_LEAK_0123456789"

_REF_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789"


@contextlib.contextmanager
def no_network():
    """Fail if the code under test attempts to open any socket."""

    def _blocked(*_args, **_kwargs):  # pragma: no cover - only fires on failure
        raise AssertionError("network access attempted by the boundary")

    saved_socket = socket.socket
    saved_create = socket.create_connection
    socket.socket = _blocked  # type: ignore[assignment]
    socket.create_connection = _blocked  # type: ignore[assignment]
    try:
        yield
    finally:
        socket.socket = saved_socket  # type: ignore[assignment]
        socket.create_connection = saved_create  # type: ignore[assignment]


def assert_no_key_leak(text: str) -> None:
    assert SENTINEL_KEY not in text
    assert "SERVICE_ROLE" not in text.upper() or text == "SUPABASE_REST_CONFIGURATION_INVALID"


def project_refs() -> st.SearchStrategy[str]:
    return st.text(alphabet=_REF_ALPHABET, min_size=20, max_size=20)


# Optional-value helper: draw a value or omit the key entirely.
def _maybe(strategy: st.SearchStrategy) -> st.SearchStrategy:
    return st.one_of(st.none(), strategy)


class SinkClassificationProperty(unittest.TestCase):
    # Feature: crawler-pipeline-orchestration, Property 7: Sink is classified as
    # exactly one of local_db/artifact_only/hosted_apply before any client, or
    # the fixed configuration error is raised; no network, no key returned. (R3.1)
    @settings(max_examples=200)
    @given(
        data_sink=_maybe(
            st.sampled_from(["local_db", "artifact_only", "hosted_apply", "bogus", ""])
        ),
        mode=_maybe(st.sampled_from(["live", "dry_run", "bogus", ""])),
        profile=_maybe(st.sampled_from(["lite_gha", "heavy_local", "bogus", ""])),
        url=_maybe(
            st.sampled_from(
                [
                    "",
                    "http://127.0.0.1",
                    "http://127.0.0.1:54321",
                    "http://[::1]:8000",
                    "https://aqlcofblfxdrjhhdmarwxxxx.supabase.co",
                    "https://evil.example.com",
                    "not a url",
                    "https://host.example.com?x=1",
                ]
            )
        ),
        include_context=st.booleans(),
    )
    def test_sink_is_single_valid_target_or_fixed_error(
        self, data_sink, mode, profile, url, include_context
    ):
        env: dict[str, object] = {"SUPABASE_SERVICE_ROLE_KEY": SENTINEL_KEY}
        if data_sink is not None:
            env[PIPELINE_DATA_SINK_ENV] = data_sink
        if mode is not None:
            env[PIPELINE_EXECUTION_MODE_ENV] = mode
        if profile is not None:
            env[PIPELINE_COMPUTE_PROFILE_ENV] = profile
        if url is not None:
            env["SUPABASE_URL"] = url
        if include_context:
            env["TZUDONG_PIPELINE_LIVE"] = "1"

        try:
            with no_network():
                result = admit_pipeline_supabase_boundary(env)
        except SupabaseRestConfigurationError as error:
            # The only permitted failure is the fixed, credential-safe error.
            self.assertEqual(str(error), "SUPABASE_REST_CONFIGURATION_INVALID")
            assert_no_key_leak(str(error))
            return

        # If it returned, it must be a boundary whose classification is exactly a
        # valid sink (or an unclassified None), never an arbitrary value, and the
        # returned object exposes no key field at all.
        self.assertIsInstance(result, PipelineSupabaseBoundary)
        self.assertIn(result.data_sink, PIPELINE_DATA_SINKS | {None})
        self.assertFalse(hasattr(result, "service_role_key"))
        self.assertFalse(hasattr(result, "key"))
        assert_no_key_leak(repr(result))


class HostedFourConditionProperty(unittest.TestCase):
    # Feature: crawler-pipeline-orchestration, Property 8: A hosted write requires
    # ALL of (live mode, hosted-apply enablement, approved-env == "1", byte-exact
    # project-ref URL match). Because PIPELINE_HOSTED_APPLY_ENABLED is a
    # compile-time False, hosted_apply is never admitted: the gate always rejects
    # and no network-capable client is instantiated. (R3.2)
    @settings(max_examples=150)
    @given(
        ref=project_refs(),
        mode=_maybe(st.sampled_from(["live", "dry_run"])),
        approved=_maybe(st.sampled_from(["1", "0", "true", ""])),
        provide_matching_ref=st.booleans(),
        url_choice=st.sampled_from(["match", "empty", "absent", "loopback", "other"]),
    )
    def test_hosted_apply_never_admitted_all_conditions(
        self, ref, mode, approved, provide_matching_ref, url_choice
    ):
        # The enablement latch is a compile-time False constant.
        self.assertFalse(PIPELINE_HOSTED_APPLY_ENABLED)

        expected_url = f"https://{ref}.supabase.co"
        env: dict[str, object] = {
            PIPELINE_DATA_SINK_ENV: "hosted_apply",
            "SUPABASE_SERVICE_ROLE_KEY": SENTINEL_KEY,
        }
        if mode is not None:
            env[PIPELINE_EXECUTION_MODE_ENV] = mode
        if approved is not None:
            env[PIPELINE_HOSTED_APPLY_APPROVED_ENV] = approved
        if provide_matching_ref:
            env[PIPELINE_HOSTED_PROJECT_REF_ENV] = ref

        if url_choice == "match":
            env["SUPABASE_URL"] = expected_url
        elif url_choice == "empty":
            env["SUPABASE_URL"] = ""
        elif url_choice == "loopback":
            env["SUPABASE_URL"] = "http://127.0.0.1:54321"
        elif url_choice == "other":
            env["SUPABASE_URL"] = "https://evil.example.com"
        # "absent" leaves SUPABASE_URL unset.

        # Even the fully-satisfied case (live + approved "1" + matching ref +
        # byte-exact URL) must reject, because enablement is False.
        with no_network():
            with self.assertRaises(SupabaseRestConfigurationError) as caught:
                admit_pipeline_supabase_boundary(env)
        self.assertEqual(str(caught.exception), "SUPABASE_REST_CONFIGURATION_INVALID")
        assert_no_key_leak(str(caught.exception))


@st.composite
def _mutated_hosted_url(draw):
    ref = draw(project_refs())
    expected = f"https://{ref}.supabase.co"
    kind = draw(
        st.sampled_from(
            [
                "scheme",
                "case",
                "subdomain_prefix",
                "subdomain_suffix",
                "path",
                "query",
                "fragment",
                "single_char",
                "tld",
                "trailing_dot",
                "port",
            ]
        )
    )
    if kind == "scheme":
        mutated = f"http://{ref}.supabase.co"
    elif kind == "case":
        mutated = f"https://{ref}.Supabase.co"
    elif kind == "subdomain_prefix":
        mutated = f"https://api.{ref}.supabase.co"
    elif kind == "subdomain_suffix":
        mutated = f"https://{ref}.supabase.co.attacker.test"
    elif kind == "path":
        mutated = f"https://{ref}.supabase.co/rest/v1"
    elif kind == "query":
        mutated = f"https://{ref}.supabase.co?apikey=x"
    elif kind == "fragment":
        mutated = f"https://{ref}.supabase.co#frag"
    elif kind == "tld":
        mutated = f"https://{ref}.supabase.io"
    elif kind == "trailing_dot":
        mutated = f"https://{ref}.supabase.co."
    elif kind == "port":
        mutated = f"https://{ref}.supabase.co:443"
    else:  # single_char
        index = draw(st.integers(min_value=0, max_value=19))
        replacement = draw(
            st.sampled_from(_REF_ALPHABET).filter(lambda c: c != ref[index])
        )
        new_ref = ref[:index] + replacement + ref[index + 1 :]
        mutated = f"https://{new_ref}.supabase.co"
    return ref, expected, mutated


class ProjectRefMismatchProperty(unittest.TestCase):
    # Feature: crawler-pipeline-orchestration, Property 9: Any single-character,
    # scheme, letter-case, subdomain, path, or query mutation of the expected
    # https://<ref>.supabase.co value is treated as a mismatch and rejected. (R3.3)
    @settings(max_examples=200)
    @given(_mutated_hosted_url())
    def test_any_mutation_is_a_mismatch(self, sample):
        ref, expected, mutated = sample
        self.assertNotEqual(mutated, expected)

        # Sanity: the un-mutated expected value canonicalises back to itself, so a
        # mismatch below is meaningful rather than a broken baseline.
        self.assertEqual(_production_url(_parse_url(expected)), expected)

        # The mutation is a mismatch either because it fails to parse as a clean
        # URL at all, or because its canonical form is not the expected value.
        try:
            parsed = _parse_url(mutated)
        except SupabaseRestConfigurationError:
            parsed = None
        if parsed is not None:
            self.assertNotEqual(_production_url(parsed), expected)

        # Defense in depth: the gate itself rejects a hosted_apply run whose URL
        # is any such mutation of the expected project-reference value.
        env = {
            PIPELINE_DATA_SINK_ENV: "hosted_apply",
            PIPELINE_EXECUTION_MODE_ENV: "live",
            PIPELINE_HOSTED_APPLY_APPROVED_ENV: "1",
            PIPELINE_HOSTED_PROJECT_REF_ENV: ref,
            "SUPABASE_URL": mutated,
            "SUPABASE_SERVICE_ROLE_KEY": SENTINEL_KEY,
        }
        with no_network():
            with self.assertRaises(SupabaseRestConfigurationError):
                admit_pipeline_supabase_boundary(env)


class RestrictedProfileProperty(unittest.TestCase):
    # Feature: crawler-pipeline-orchestration, Property 10: lite_gha / local_db /
    # artifact_only profiles restrict the admitted sink to loopback/artifact and
    # never admit hosted_apply under any condition. (R3.4)
    @settings(max_examples=200)
    @given(
        profile=st.sampled_from(["lite_gha", None]),
        sink=st.sampled_from(["local_db", "artifact_only", None]),
        profile_via_kwarg=st.booleans(),
        url=st.sampled_from(
            [
                None,
                "",
                "http://127.0.0.1",
                "http://127.0.0.1:54321",
                "https://aqlcofblfxdrjhhdmarwxxxx.supabase.co",
                "https://evil.example.com",
            ]
        ),
        mode=_maybe(st.sampled_from(["live", "dry_run"])),
    )
    def test_restricted_profiles_never_admit_hosted(
        self, profile, sink, profile_via_kwarg, url, mode
    ):
        # Only exercise environments actually constrained by lite/local/artifact.
        assume(profile == "lite_gha" or sink in {"local_db", "artifact_only"})

        env: dict[str, object] = {"SUPABASE_SERVICE_ROLE_KEY": SENTINEL_KEY}
        kwargs: dict[str, object] = {}
        if profile is not None:
            if profile_via_kwarg:
                kwargs["profile"] = profile
            else:
                env[PIPELINE_COMPUTE_PROFILE_ENV] = profile
        if sink is not None:
            env[PIPELINE_DATA_SINK_ENV] = sink
        if url is not None:
            env["SUPABASE_URL"] = url
        if mode is not None:
            env[PIPELINE_EXECUTION_MODE_ENV] = mode

        try:
            with no_network():
                result = admit_pipeline_supabase_boundary(env, **kwargs)
        except SupabaseRestConfigurationError as error:
            self.assertEqual(str(error), "SUPABASE_REST_CONFIGURATION_INVALID")
            return

        # A restricted profile can only ever land on a loopback/artifact target.
        self.assertNotEqual(result.data_sink, "hosted_apply")
        self.assertIn(result.data_sink, {None, "local_db", "artifact_only"})
        assert_no_key_leak(repr(result))


@st.composite
def _rejection_scenario(draw):
    """Environments (plus kwargs) that the gate is guaranteed to reject."""
    scenario = draw(
        st.sampled_from(
            [
                "hosted_apply",
                "local_nonloopback",
                "artifact_nonloopback",
                "sink_not_admitted",
                "bad_sink",
                "bad_mode",
            ]
        )
    )
    env: dict[str, object] = {"SUPABASE_SERVICE_ROLE_KEY": SENTINEL_KEY}
    kwargs: dict[str, object] = {}
    if scenario == "hosted_apply":
        env[PIPELINE_DATA_SINK_ENV] = "hosted_apply"
        env["SUPABASE_URL"] = draw(
            st.sampled_from(
                [
                    "",
                    "https://aqlcofblfxdrjhhdmarwxxxx.supabase.co",
                    "https://evil.example.com",
                ]
            )
        )
    elif scenario == "local_nonloopback":
        env[PIPELINE_DATA_SINK_ENV] = "local_db"
        env["SUPABASE_URL"] = "https://aqlcofblfxdrjhhdmarwxxxx.supabase.co"
    elif scenario == "artifact_nonloopback":
        env[PIPELINE_DATA_SINK_ENV] = "artifact_only"
        env["SUPABASE_URL"] = "https://evil.example.com"
    elif scenario == "sink_not_admitted":
        # Pipeline context with an endpoint but no classified sink.
        env["SUPABASE_URL"] = "https://aqlcofblfxdrjhhdmarwxxxx.supabase.co"
        kwargs["execution_mode"] = "live"
    elif scenario == "bad_sink":
        env[PIPELINE_DATA_SINK_ENV] = "bogus_sink"
    else:  # bad_mode
        env[PIPELINE_DATA_SINK_ENV] = "local_db"
        env[PIPELINE_EXECUTION_MODE_ENV] = "bogus_mode"
        env["SUPABASE_URL"] = "http://127.0.0.1:54321"
    return env, kwargs


class BoundedRejectionCodeProperty(unittest.TestCase):
    # Feature: crawler-pipeline-orchestration, Property 11: A hosted-gate rejection
    # maps to exactly one bounded code from the closed HOSTED_GATE_REJECTION_CODES
    # set; the run halts with a bounded blocked status; no provider identifiers,
    # database error text, connection strings, or free-form diagnostics appear.
    # (R3.7, R9.4)
    @settings(max_examples=200)
    @given(_rejection_scenario())
    def test_rejection_maps_to_single_bounded_code(self, sample):
        env, kwargs = sample

        # The scenario must actually be a rejection for the property to apply.
        with no_network():
            with self.assertRaises(SupabaseRestConfigurationError):
                admit_pipeline_supabase_boundary(env, **kwargs)

            code = map_hosted_gate_rejection_code(env, **kwargs)

        # Exactly one member of the closed enumeration.
        self.assertIn(code, HOSTED_GATE_REJECTION_CODES)
        # The code is a bounded, lower-snake token: no URLs, whitespace, provider
        # identifiers, connection strings, or free-form diagnostics.
        self.assertRegex(code, r"^[a-z_]+$")
        self.assertNotIn("://", code)
        self.assertNotIn(" ", code)
        assert_no_key_leak(code)
        self.assertNotIn("supabase.co", code)

        # The bounded code is accepted by the manifest validator, round-tripping
        # to itself; a free-form value is refused so it can never reach a manifest.
        self.assertEqual(validate_hosted_gate_rejection_code(code), code)
        with self.assertRaises(ValueError):
            validate_hosted_gate_rejection_code(code + "_freeform_diagnostic")


if __name__ == "__main__":
    unittest.main()
