"""Property 7 — 파이썬 ↔ 러스트 오류 코드 동등성 (Migration_Slice R1-validators).

Feature: platform-modernization, Property 7: 파이썬 ↔ 러스트 오류 코드 동등성.

Task 46.4. This is the python half of the cross-language *error-code* parity
property. Where the sibling ``parity_pbt.py`` (Property 6, task 46.3) draws from
the *valid* input domain and asserts full output equality, this module draws
from *outside* the valid input domain with an ``invalid_inputs()`` generator and
asserts that the python reference implementation
(``backend/pipeline/validators.py``) and the Rust_Component (``tzudong_validators``
PyO3 extension built from ``backend/rust/tzudong-validators/``) reject the input
with the *same fixed error code* and produce *no partial result*.

**Validates: Requirements 2.8**

Invariant (design "Property 7"): for inputs drawn from *outside* the valid input
domain of the R1-validators slice, the python implementation and the
Rust_Component return the same fixed error code, and neither produces a partial
result. Operationally, each generated input trips exactly one early-return guard
in a validator, so a correct implementation returns a single ValidationError
whose ``rule`` (the fixed error code) is drawn from the closed guard-code set and
returns immediately without any further, partially-processed output. The
Parity_Harness (``backend/pipeline_control/rust_parity.py``, task 43) drives both
implementations under normalization rule ``v1`` and confirms the two outputs are
byte-identical on every compared field; this module additionally asserts the
shared output is that single fixed-code rejection.

Invalid-input discipline
------------------------
"Outside the valid input domain" here means the structurally-shaped-but-invalid
inputs that each validator rejects with a dedicated guard clause: a
``restaurants`` payload that is present but not a list, an ``evaluation_target``
that is present but not a dict, and a null / empty / falsy ``evaluation_results``
(the "type error" and "empty structure / null" invalid-input classes named in
the design generator).

The generators deliberately stay inside the sub-domain where *both*
implementations agree that the input is invalid. In particular the top-level
container types the python reference dereferences with ``.get(...)`` are kept
well-typed (``data`` stays a dict): a non-dict top-level ``data`` makes the
python reference raise ``AttributeError`` while the Rust port tolerates it, which
is an abnormal-termination concern owned by the Parity_Harness (Requirement 2.9),
not the fixed-error-code equivalence property (Requirement 2.8). The generators
also keep the single guard unambiguous — e.g. ``youtube_link`` is always truthy
in the gemini case so the ``restaurants`` type guard is the *only* error emitted,
which is what makes "no partial result" a well-defined assertion.

If the Rust extension module is unavailable (not built for this interpreter),
every test is skipped with a clear reason rather than fabricating a pass.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

# Make the repository root importable so ``backend.*`` resolves regardless of
# the working directory this test is launched from.
_REPO_ROOT = Path(__file__).resolve().parents[3]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from hypothesis import given, settings
from hypothesis import strategies as st

from backend.pipeline import validators as py_validators
from backend.pipeline_control.rust_parity import compute_artifact_id, run_parity

try:  # The Rust_Component is an optional, separately built PyO3 extension.
    import tzudong_validators as rs_validators  # type: ignore

    _RUST_IMPORT_ERROR: str | None = None
except Exception as exc:  # noqa: BLE001 - report, never fabricate a result.
    rs_validators = None  # type: ignore[assignment]
    _RUST_IMPORT_ERROR = type(exc).__name__

SLICE_ID = "R1-validators"
MAX_EXAMPLES = 100

# One artifact id for the whole run, derived from the built extension module's
# bytes (crate name + SHA-256), matching the Rust_Component identity contract
# (Requirement 2.10). Falls back to a stable placeholder when the module is
# unavailable so import never crashes at collection time.
if rs_validators is not None and getattr(rs_validators, "__file__", None):
    RUST_ARTIFACT_ID = compute_artifact_id(
        "tzudong-validators", module_path=rs_validators.__file__
    )
else:
    RUST_ARTIFACT_ID = "tzudong-validators@unavailable"

# The closed set of fixed error codes an out-of-domain input may be rejected
# with by the guard clauses this property exercises. A rejection carrying any
# other code (or more than one error) would mean a partial result leaked past
# the guard.
FIXED_ERROR_CODES = frozenset({"type_error", "missing_eval_results"})


# ---------------------------------------------------------------------------
# invalid_inputs() — building blocks for the out-of-domain sub-domain.
# ---------------------------------------------------------------------------
_LINKS = [
    "https://www.youtube.com/watch?v=abc",
    "https://youtu.be/def",
]
_video_id = st.text(min_size=1, max_size=12)

# A value that is present but is NOT a list. Covers the "type error" and "null"
# invalid-input classes for the ``restaurants`` field. A present ``None`` is
# invalid too: ``data.get("restaurants", [])`` returns it (the key exists) and
# ``isinstance(None, list)`` is False on both sides.
_non_list = st.one_of(
    st.none(),
    st.booleans(),
    st.integers(min_value=-5, max_value=5),
    st.sampled_from([0.0, 1.5, -2.0]),
    st.text(max_size=8),
    st.dictionaries(st.text(max_size=4), st.integers(min_value=-3, max_value=3), max_size=2),
)

# A value that is present but is NOT a dict, for the ``evaluation_target`` guard.
_non_dict = st.one_of(
    st.none(),
    st.booleans(),
    st.integers(min_value=-5, max_value=5),
    st.sampled_from([0.0, 1.5, -2.0]),
    st.text(max_size=8),
    st.lists(st.integers(min_value=-3, max_value=3), max_size=3),
)

# A value that is falsy on both sides, for the ``evaluation_results`` guard: the
# "empty structure" and "null" invalid-input classes.
_falsy = st.one_of(
    st.none(),
    st.just({}),
    st.just([]),
    st.just(""),
    st.just(0),
    st.just(0.0),
    st.just(False),
)


@st.composite
def _gemini_invalid(draw) -> dict:
    # ``youtube_link`` stays truthy so the ``restaurants`` type guard is the sole
    # emitted error (no partial result to trip over).
    return {
        "youtube_link": draw(st.sampled_from(_LINKS)),
        "restaurants": draw(_non_list),
    }


@st.composite
def _selection_invalid(draw) -> dict:
    # ``restaurants`` is never iterated before the ``evaluation_target`` guard
    # returns, so any well-typed list is fine; the guard is the only error.
    return {
        "restaurants": draw(
            st.lists(
                st.fixed_dictionaries({"origin_name": st.sampled_from(["식당A", "식당B"])}),
                max_size=3,
            )
        ),
        "evaluation_target": draw(_non_dict),
    }


@st.composite
def _missing_eval_invalid(draw) -> dict:
    # Either the key is absent (``.get`` yields None) or it is present but falsy;
    # both trip the ``missing_eval_results`` guard on the rule and laaj validators.
    if draw(st.booleans()):
        return {}
    return {"evaluation_results": draw(_falsy)}


@unittest.skipIf(rs_validators is None, f"Rust_Component unavailable ({_RUST_IMPORT_ERROR})")
class Property7ValidatorErrorCodeParity(unittest.TestCase):
    """Feature: platform-modernization, Property 7: 파이썬 ↔ 러스트 오류 코드 동등성."""

    def _assert_error_parity(
        self, input_id: str, payload, py_impl, rust_impl, expected_codes
    ) -> None:
        result = run_parity(
            SLICE_ID,
            input_id,
            payload,
            python_impl=py_impl,
            rust_impl=rust_impl,
            rust_artifact_id=RUST_ARTIFACT_ID,
        )
        # The harness ran both to completion (no abnormal termination): a
        # non-empty compared-field set and no run-incomplete code.
        self.assertTrue(
            result["compared_fields"],
            msg=f"empty compared-field set for {input_id}: {result}",
        )
        self.assertEqual(result["result_code"], None)
        # The python implementation and the Rust_Component returned identical
        # output on every compared field — i.e. the same fixed error code.
        self.assertTrue(
            result["matched"],
            msg=(
                f"error-code mismatch for {input_id}: "
                f"mismatch_fields={result['mismatch_fields']} "
                f"count={result['mismatch_field_count']}"
            ),
        )
        self.assertEqual(result["mismatch_field_count"], 0)

        # The shared rejection is a single fixed-code error and nothing else:
        # the guard fired and returned immediately, so no partial result leaked.
        py_errors = py_impl(payload)["errors"]
        rust_errors = rust_impl(payload)["errors"]
        self.assertEqual(
            len(py_errors), 1, msg=f"partial result for {input_id}: {py_errors}"
        )
        self.assertEqual(
            len(rust_errors), 1, msg=f"partial result for {input_id}: {rust_errors}"
        )
        py_code = py_errors[0].get("rule")
        rust_code = rust_errors[0].get("rule")
        self.assertEqual(
            py_code, rust_code, msg=f"fixed error code differs for {input_id}"
        )
        self.assertIn(py_code, FIXED_ERROR_CODES)
        self.assertIn(py_code, expected_codes)

    @settings(max_examples=MAX_EXAMPLES, deadline=None)
    @given(video_id=_video_id, data=_gemini_invalid())
    def test_gemini_output_error_parity(self, video_id: str, data: dict) -> None:
        self._assert_error_parity(
            "gemini",
            {"video_id": video_id, "data": data},
            lambda p: {"errors": py_validators.validate_gemini_output(p["video_id"], p["data"])},
            lambda p: {"errors": rs_validators.validate_gemini_output(p["video_id"], p["data"])},
            expected_codes={"type_error"},
        )

    @settings(max_examples=MAX_EXAMPLES, deadline=None)
    @given(video_id=_video_id, data=_selection_invalid())
    def test_selection_error_parity(self, video_id: str, data: dict) -> None:
        self._assert_error_parity(
            "selection",
            {"video_id": video_id, "data": data},
            lambda p: {"errors": py_validators.validate_selection(p["video_id"], p["data"])},
            lambda p: {"errors": rs_validators.validate_selection(p["video_id"], p["data"])},
            expected_codes={"type_error"},
        )

    @settings(max_examples=MAX_EXAMPLES, deadline=None)
    @given(video_id=_video_id, data=_missing_eval_invalid())
    def test_rule_results_error_parity(self, video_id: str, data: dict) -> None:
        self._assert_error_parity(
            "rule_results",
            {"video_id": video_id, "data": data},
            lambda p: {"errors": py_validators.validate_rule_results(p["video_id"], p["data"])},
            lambda p: {"errors": rs_validators.validate_rule_results(p["video_id"], p["data"])},
            expected_codes={"missing_eval_results"},
        )

    @settings(max_examples=MAX_EXAMPLES, deadline=None)
    @given(video_id=_video_id, data=_missing_eval_invalid())
    def test_laaj_results_error_parity(self, video_id: str, data: dict) -> None:
        self._assert_error_parity(
            "laaj_results",
            {"video_id": video_id, "data": data},
            lambda p: {"errors": py_validators.validate_laaj_results(p["video_id"], p["data"])},
            lambda p: {"errors": rs_validators.validate_laaj_results(p["video_id"], p["data"])},
            expected_codes={"missing_eval_results"},
        )


if __name__ == "__main__":
    unittest.main()
