"""Property-based test for the local data boundary.

Feature: platform-modernization, Property 16: 로컬 데이터 경계.

This test targets the pure run-summary and step-composition policy built in
Tasks 4 and 5 (``backend/pipeline_control/profiles.py:build_run_summary`` and
``compose_step_plan``). The ``step_plans()`` generator composes pipeline step
plans that include the mutating (Local_Database-writing) steps and injects
Hosted_Database write attempts as a non-negative hosted-write request count.

For every generated plan it asserts the invariant behind Property 16 under a
``local_db`` data sink:

- a clean run (zero injected hosted writes) keeps the whole run's
  Hosted_Database write request counter at ``0``, and the summary records the
  hosted read/write request counts as ``0``-or-greater integers (R8.2, R8.4);
- any injected Hosted_Database write attempt (a non-zero hosted-write count
  under ``local_db``) is a boundary breach and terminates with the fixed code
  ``supabase_data_boundary_rejected`` — no provider diagnostic or database
  error string is exposed (R8.11); and
- the run summary is built from a fixed non-sensitive key set and routes the
  free-form run id through the shared redaction boundary, so a
  Forbidden_Log_Field value can never appear in the artifact (R8.4).

It reuses the Hypothesis strategy vocabulary from ``test_profiles_pbt.py``
(``_CAP_TOKENS``) and the outcome tokens from ``test_step_composition_pbt.py``,
uses Python ``hypothesis`` with ``max_examples=100``, and runs under
``python -m unittest``.

Validates: Requirements 8.2, 8.4, 8.11
"""

from __future__ import annotations

import unittest

from hypothesis import given, settings
from hypothesis import strategies as st

from backend.pipeline_control.graph import (
    MUTATING_CAPABILITY,
    STEP_BY_ID,
    STEP_SPECS,
)
from backend.pipeline_control.profiles import (
    LOCAL_SINK,
    STEP_STATUS_FAILED,
    STEP_STATUS_SKIPPED,
    STEP_STATUS_SUCCEEDED,
    ProfileError,
    build_run_summary,
    compose_step_plan,
)
from backend.utils.privacy_log import redact_log_text

# Reuse the capability-token vocabulary and outcome tokens defined for the
# existing Property 4/5/6 and Property 15 coverage so the generated capability
# sets and step outcomes stay in lockstep with the sibling PBTs.
from backend.pipeline_control.test_profiles_pbt import _CAP_TOKENS
from backend.pipeline_control.test_step_composition_pbt import _OUTCOME_TOKENS

# Every step id and the mutating (Local_Database-writing) subset. The generator
# targets plans that include these mutating steps.
_ALL_STEP_IDS = frozenset(spec.id for spec in STEP_SPECS)
_MUTATING_STEP_IDS = frozenset(
    spec.id for spec in STEP_SPECS if MUTATING_CAPABILITY in spec.capabilities
)

# Both admitted compute profiles. hosted_apply is never generated here because
# the whole property is scoped to the local_db sink.
_COMPUTE_PROFILES = ("heavy_local", "lite_gha")

# The exact non-sensitive key set the run summary is allowed to carry (design
# C4 shape). Anything outside this set would be a channel for a
# Forbidden_Log_Field value, so the key set is asserted structurally.
_ALLOWED_SUMMARY_KEYS = frozenset(
    {
        "schemaVersion",
        "runId",
        "computeProfile",
        "dataSink",
        "hostedReadRequestCount",
        "hostedWriteRequestCount",
        "succeededSteps",
        "failedSteps",
        "skippedSteps",
        "confirmedWriteSteps",
        "finalStatus",
    }
)

# Run ids that embed a recognizable Forbidden_Log_Field-shaped value alongside
# ordinary ids. The redaction boundary must strip the sensitive substring so it
# never reaches the summary artifact. Each entry pairs the raw run id with the
# secret substring that must be absent from the redacted output.
_FORBIDDEN_RUN_IDS = (
    ("token=supersecretvalue1234567890", "supersecretvalue1234567890"),
    ("run for user@example.com", "user@example.com"),
    ("AKIAABCDEFGHIJKLMNOP", "AKIAABCDEFGHIJKLMNOP"),
    ("api_key=deadbeefdeadbeef1234", "deadbeefdeadbeef1234"),
)

# Capability sets that still admit the mutating steps: either unconstrained
# (None) or an explicit set that includes the "insert" capability so the
# insertion steps are not capability-skipped and remain genuine run candidates.
_capabilities_strategy = st.one_of(
    st.none(),
    st.sets(st.sampled_from(_CAP_TOKENS)).map(lambda caps: caps | {"insert"}),
)

_outcomes_strategy = st.dictionaries(
    keys=st.sampled_from(sorted(_ALL_STEP_IDS)),
    values=st.sampled_from(_OUTCOME_TOKENS),
)


@st.composite
def step_plans(draw):
    """Generate a local_db step plan with mutating steps + injected hosted writes.

    Returns a kwargs dict for ``build_run_summary`` fixed to the ``local_db``
    sink. ``hosted_write_request_count`` is the injected Hosted_Database write
    attempt count (frequently zero, sometimes positive), and ``run_id`` is
    drawn from ordinary ids plus Forbidden_Log_Field-shaped values so the
    redaction boundary is exercised.
    """

    compute_profile = draw(st.sampled_from(_COMPUTE_PROFILES))
    capabilities = draw(_capabilities_strategy)
    outcomes = draw(_outcomes_strategy)
    hosted_read = draw(st.integers(min_value=0, max_value=10_000))
    # Bias toward zero (a clean run) but frequently inject a hosted write
    # attempt so both boundary branches are covered.
    hosted_write = draw(
        st.one_of(st.just(0), st.integers(min_value=1, max_value=10_000))
    )
    run_id = draw(
        st.one_of(
            st.none(),
            st.text(
                alphabet="abcdefghijklmnopqrstuvwxyz0123456789-_",
                min_size=1,
                max_size=40,
            ),
            st.sampled_from([raw for raw, _secret in _FORBIDDEN_RUN_IDS]),
        )
    )
    return {
        "run_id": run_id,
        "compute_profile": compute_profile,
        "data_sink": LOCAL_SINK,
        "capabilities": capabilities,
        "outcomes": outcomes,
        "hosted_read_request_count": hosted_read,
        "hosted_write_request_count": hosted_write,
    }


class LocalDataBoundaryProperties(unittest.TestCase):
    # Feature: platform-modernization, Property 16: 로컬 데이터 경계.
    # For all pipeline step plans under a local_db data sink, the whole run's
    # Hosted_Database write request counter stays 0: a clean run records
    # hostedWriteRequestCount == 0 (with non-negative integer read/write
    # counts), while any injected Hosted_Database write attempt is rejected with
    # the fixed code supabase_data_boundary_rejected and no provider/database
    # error string. The summary carries only the fixed non-sensitive key set and
    # routes the run id through the redaction boundary, excluding
    # Forbidden_Log_Field.
    # Validates: Requirements 8.2, 8.4, 8.11
    @settings(max_examples=100)
    @given(plan_kwargs=step_plans())
    def test_local_db_keeps_hosted_write_counter_zero(self, plan_kwargs):
        # The generated plan genuinely includes the mutating (Local_Database
        # writing) steps: they are composed as run candidates rather than being
        # absent from the plan.
        composed = compose_step_plan(
            compute_profile=plan_kwargs["compute_profile"],
            data_sink=LOCAL_SINK,
            capabilities=plan_kwargs["capabilities"],
            outcomes=plan_kwargs["outcomes"],
        )
        composed_ids = {str(entry["id"]) for entry in composed["steps"]}
        self.assertTrue(
            _MUTATING_STEP_IDS <= composed_ids,
            "plan must include the mutating steps",
        )

        injected_hosted_writes = plan_kwargs["hosted_write_request_count"]

        if injected_hosted_writes != 0:
            # An injected Hosted_Database write attempt under local_db is a
            # boundary breach: the run terminates with exactly the fixed code
            # and exposes no provider diagnostic or database error string.
            with self.assertRaises(ProfileError) as ctx:
                build_run_summary(**plan_kwargs)
            self.assertEqual(ctx.exception.code, "supabase_data_boundary_rejected")
            # The only payload on the fixed-code error is the code itself.
            self.assertEqual(str(ctx.exception), "supabase_data_boundary_rejected")
            return

        # Clean run: zero injected hosted writes.
        summary = build_run_summary(**plan_kwargs)

        # R8.2: the whole run's Hosted_Database write request counter is 0.
        self.assertEqual(summary["hostedWriteRequestCount"], 0)

        # R8.4: hosted read/write request counts are 0-or-greater integers
        # (and not booleans, which are not valid counts).
        for key in ("hostedReadRequestCount", "hostedWriteRequestCount"):
            value = summary[key]
            self.assertIs(type(value), int)
            self.assertGreaterEqual(value, 0)
        self.assertEqual(
            summary["hostedReadRequestCount"],
            plan_kwargs["hosted_read_request_count"],
        )

        # R8.4: the summary carries only the fixed non-sensitive key set, so no
        # Forbidden_Log_Field can ride along as an extra key.
        self.assertEqual(set(summary), set(_ALLOWED_SUMMARY_KEYS))
        self.assertEqual(summary["dataSink"], LOCAL_SINK)

        # R8.4: the free-form run id is passed through the shared redaction
        # boundary rather than stored verbatim.
        run_id = plan_kwargs["run_id"]
        if run_id is None:
            self.assertIsNone(summary["runId"])
        else:
            self.assertEqual(summary["runId"], redact_log_text(run_id))
            # A Forbidden_Log_Field-shaped run id never leaks its secret.
            for raw, secret in _FORBIDDEN_RUN_IDS:
                if run_id == raw:
                    self.assertNotIn(secret, summary["runId"])

        # The step partition stays coherent: confirmed Local_Database writes are
        # exactly the succeeded mutating steps, so no hosted target is implied.
        succeeded = set(summary["succeededSteps"])
        for step_id in summary["confirmedWriteSteps"]:
            self.assertIn(step_id, succeeded)
            self.assertIn(
                MUTATING_CAPABILITY, STEP_BY_ID[step_id].capabilities, step_id
            )

        # finalStatus stays within the fixed terminal-status vocabulary.
        self.assertIn(
            summary["finalStatus"],
            {STEP_STATUS_SUCCEEDED, STEP_STATUS_FAILED, STEP_STATUS_SKIPPED},
        )


if __name__ == "__main__":
    unittest.main()
