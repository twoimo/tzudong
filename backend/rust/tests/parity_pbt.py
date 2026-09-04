"""Property 6 — 파이썬 ↔ 러스트 출력 동등성 (Migration_Slice R1-validators).

Feature: platform-modernization, Property 6: 파이썬 ↔ 러스트 출력 동등성.

Task 46.3. This is the python half of the cross-language parity property. It
drives the Parity_Harness (``backend/pipeline_control/rust_parity.py``, task 43)
with a per-slice ``valid_inputs()`` generator, feeds one identical input to the
python reference implementation (``backend/pipeline/validators.py``) and the
Rust_Component (``tzudong_validators`` PyO3 extension built from
``backend/rust/tzudong-validators/``), normalizes both outputs with
normalization rule ``v1``, and asserts that every compared field is identical.

**Validates: Requirements 2.1, 2.2, 2.3, 2.7**

Invariant (design "Property 6"): for inputs drawn from the valid input domain of
the R1-validators slice, the normalized python output equals the normalized Rust
output on every field of a *non-empty* compared-field set, and the produced
Parity_Result carries no mismatching field names.

Generator discipline
---------------------
The Rust port sorts several collections that the python reference iterates in
CPython ``set`` hash order (the name-diff in :func:`validate_selection`, the
missing-key set in :func:`validate_laaj_results`, the symmetric name-diff in
:func:`cross_validate`, and the required-field set in
:func:`validate_transform_output`). CPython ``set`` iteration order is hash-seed
dependent, so the reference itself is non-deterministic when more than one such
element is emitted. Normalization rule ``v1`` sorts field *names* and drops the
declared non-deterministic fields; it does not reorder list elements or the
characters inside a message string. The ``valid_inputs()`` generators below
therefore constrain to the sub-domain where the reference output is
order-deterministic (at most one set-difference element, at most one missing
required field, numeric score/visit values, string-or-None text fields) so that
exact equality is a well-defined property rather than a test of hash-seed
ordering.

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


# ---------------------------------------------------------------------------
# Shared value pools kept inside the deterministic sub-domain (see module note).
# ---------------------------------------------------------------------------
_NAMES = ["식당A", "식당B", "식당C", "식당D"]
_ADDRESSES = [
    "서울특별시 중구 세종대로 1",  # contains a province -> address_format passes
    "부산광역시 해운대구 우동",
    "Unknown City, Some Street 123",  # no province -> address_format warning
    "1600 Amphitheatre Pkwy",
]
_LINKS = [
    "https://www.youtube.com/watch?v=abc",
    "https://youtu.be/def",
]
# Clean numeric coordinates whose ``str(float)`` and Rust ``py_float_repr`` agree
# exactly, spanning in-range and out-of-range values.
_CLEAN_COORDS = [33.0, 35.5, 37.566, 38.9, 124.5, 126.978, 129.0, 131.5,
                 0.0, 10.0, 40.5, 45.0, 200.0, -5.5]
_CATEGORIES_CANONICAL = ["한식", "치킨", "분식", "야식", "도시락"]
_CATEGORIES_LEGACY = ["일식", "카페", "국밥"]
_CATEGORIES_INVALID = ["외계음식", "없는카테고리"]

# A coordinate is a clean float, a bounded int, None, or a non-numeric string
# that fails ``float()`` on both sides (never "nan"/"inf", which would make a
# recorded ``actual_value`` an unequal NaN).
_coord = st.one_of(
    st.sampled_from(_CLEAN_COORDS),
    st.integers(min_value=-200, max_value=200),
    st.none(),
    st.sampled_from(["abc", "N/A", "??"]),
)

# Category: a valid scalar, a canonical list, an invalid scalar, or a list that
# mixes canonical labels with a legacy label (invalid inside a list) or a dict.
_category = st.one_of(
    st.sampled_from(_CATEGORIES_CANONICAL + _CATEGORIES_LEGACY),
    st.lists(st.sampled_from(_CATEGORIES_CANONICAL), min_size=1, max_size=3),
    st.sampled_from(_CATEGORIES_INVALID),
    st.lists(
        st.one_of(
            st.sampled_from(_CATEGORIES_CANONICAL),
            st.sampled_from(_CATEGORIES_LEGACY),
            st.just({"name": "분식"}),
        ),
        min_size=1,
        max_size=3,
    ),
)

# Text fields stay string-or-None: the python reference calls ``len(...)`` /
# regex search that would diverge (or raise) on non-string truthy values, which
# the Rust port guards with ``is_str``. String-or-None is the valid domain.
_text = st.one_of(st.none(), st.text(max_size=40))
_video_id = st.text(min_size=1, max_size=12)


def _restaurant() -> st.SearchStrategy:
    return st.fixed_dictionaries(
        {
            "origin_name": st.one_of(st.none(), st.sampled_from(_NAMES), st.text(max_size=12)),
            "address": st.one_of(st.none(), st.sampled_from(_ADDRESSES), st.text(max_size=40)),
            "lat": _coord,
            "lng": _coord,
            "category": _category,
            "reasoning_basis": _text,
            "youtuber_review": _text,
        }
    )


def _gemini_data() -> st.SearchStrategy:
    return st.fixed_dictionaries(
        {
            "youtube_link": st.one_of(
                st.none(), st.just(""), st.sampled_from(_LINKS), st.text(max_size=25)
            ),
            "restaurants": st.one_of(
                st.just([]),
                st.lists(_restaurant(), min_size=1, max_size=3),
                st.just("not-a-list"),
            ),
        }
    )


@st.composite
def _selection_data(draw) -> dict:
    # ``evaluation_target`` is occasionally a non-dict to exercise the type_error
    # path (a single deterministic error).
    if draw(st.integers(min_value=0, max_value=9)) == 0:
        restaurants = [{"origin_name": n} for n in draw(
            st.lists(st.sampled_from(_NAMES), max_size=3, unique=True)
        )]
        return {"restaurants": restaurants, "evaluation_target": "not-a-dict"}

    names = draw(st.lists(st.sampled_from(_NAMES), min_size=0, max_size=4, unique=True))
    restaurant_names = set(names)
    target = set(restaurant_names)
    # Constrain the name-diff to <= 1 missing and <= 1 extra so the joined
    # message order is well-defined (a one-element join needs no sorting).
    if draw(st.booleans()) and target:
        target.discard(draw(st.sampled_from(sorted(target))))
    extra_pool = [n for n in _NAMES if n not in restaurant_names]
    if draw(st.booleans()) and extra_pool:
        target.add(draw(st.sampled_from(extra_pool)))

    restaurants = [{"origin_name": n} for n in names]
    # Occasionally push restaurant count past 20 to exercise restaurant_count.
    if draw(st.integers(min_value=0, max_value=9)) == 0:
        pad = "식당A"
        restaurants = [{"origin_name": pad} for _ in range(21)]
        restaurant_names = {pad}
        target = {pad}
    evaluation_target = {n: {"selected": draw(st.booleans())} for n in sorted(target)}
    return {"restaurants": restaurants, "evaluation_target": evaluation_target}


def _loc_item() -> st.SearchStrategy:
    base = {
        "origin_name": st.sampled_from(_NAMES),
        "eval_value": st.one_of(st.booleans(), st.none()),
        "matched_name": st.one_of(st.none(), st.sampled_from(_NAMES)),
        "naver_name": st.one_of(st.none(), st.sampled_from(_NAMES)),
        "google_name": st.one_of(st.none(), st.sampled_from(_NAMES)),
        "evidence_families": st.lists(
            st.sampled_from(["provider_candidate", "text_match", "map_pin"]),
            max_size=3,
        ),
        "falseMessage": st.one_of(st.none(), st.text(max_size=10)),
        "pending_reason": st.one_of(st.none(), st.sampled_from(["timeout", "rate_limited"])),
        "match_status": st.one_of(st.none(), st.sampled_from(["failed", "ok"])),
        "second_pass": st.one_of(
            st.none(),
            st.fixed_dictionaries(
                {
                    "timed_out": st.booleans(),
                    "rate_limited": st.booleans(),
                }
            ),
        ),
    }
    return st.fixed_dictionaries(base)


def _rule_data() -> st.SearchStrategy:
    return st.fixed_dictionaries(
        {
            "evaluation_results": st.one_of(
                st.none(),
                st.fixed_dictionaries(
                    {
                        "location_match_TF": st.one_of(
                            st.lists(_loc_item(), max_size=3),
                            st.just("not-a-list"),
                        ),
                        "category_validity_TF": st.one_of(
                            st.just([]),
                            st.lists(
                                st.fixed_dictionaries(
                                    {"name": st.sampled_from(_NAMES), "eval_value": st.booleans()}
                                ),
                                min_size=1,
                                max_size=2,
                            ),
                        ),
                    }
                ),
            )
        }
    )


def _score_item() -> st.SearchStrategy:
    return st.fixed_dictionaries(
        {
            "name": st.sampled_from(_NAMES),
            "eval_value": st.one_of(
                st.none(),
                st.integers(min_value=-2, max_value=4),
                st.sampled_from([0.0, 0.5, 1.0, 1.5, 2.0, 3.5]),
                st.sampled_from(["x", "N/A"]),
            ),
            "eval_basis": st.one_of(st.none(), st.text(max_size=10)),
        }
    )


def _bool_item() -> st.SearchStrategy:
    return st.fixed_dictionaries(
        {
            "name": st.sampled_from(_NAMES),
            "eval_value": st.one_of(
                st.none(),
                st.booleans(),
                st.integers(min_value=0, max_value=3),
                st.sampled_from(["true", "false"]),
            ),
        }
    )


_LAAJ_KEYS = [
    "visit_authenticity",
    "rb_inference_score",
    "rb_grounding_TF",
    "review_faithfulness_score",
    "category_TF",
]


@st.composite
def _laaj_data(draw) -> dict:
    # Drop at most one expected key so the joined missing-key message has <= 1
    # element (order-independent). The score keys carry score items; the *_TF
    # keys carry boolean items.
    drop = draw(st.one_of(st.none(), st.sampled_from(_LAAJ_KEYS)))
    eval_results: dict = {}
    for key in _LAAJ_KEYS:
        if key == drop:
            continue
        if key in ("rb_grounding_TF", "category_TF"):
            items = draw(st.lists(_bool_item(), max_size=3))
        else:
            items = draw(st.lists(_score_item(), max_size=3))
        # Either a bare list or the {"values": [...]} wrapper; both are accepted
        # identically by _iter_evaluation_items on both sides.
        if draw(st.booleans()):
            eval_results[key] = items
        else:
            eval_results[key] = {"values": items}
    return {"evaluation_results": eval_results}


@st.composite
def _cross_data(draw) -> tuple[dict, dict]:
    rest = draw(st.lists(st.sampled_from(_NAMES), max_size=3, unique=True))
    rule_set = set(rest)
    laaj_set = set(rule_set)
    # Keep the symmetric name-diff to <= 1 element so its joined message order is
    # well-defined; visit/category values stay numeric/boolean so the reference
    # ``>=`` comparison never raises on a non-numeric value.
    if draw(st.booleans()) and laaj_set:
        laaj_set.discard(draw(st.sampled_from(sorted(laaj_set))))

    rule_names = sorted(rule_set)
    laaj_names = sorted(laaj_set)
    rule_data = {
        "restaurants": [{"origin_name": n} for n in rule_names],
        "evaluation_results": {
            "location_match_TF": [
                {"origin_name": n, "eval_value": draw(st.booleans())} for n in rule_names
            ],
            "category_validity_TF": [
                {"name": n, "eval_value": draw(st.booleans())} for n in rule_names
            ],
        },
    }
    laaj_data = {
        "restaurants": [{"origin_name": n} for n in laaj_names],
        "evaluation_results": {
            "visit_authenticity": [
                {"name": n, "eval_value": draw(st.integers(min_value=0, max_value=2))}
                for n in laaj_names
            ],
            "category_TF": [
                {"name": n, "eval_value": draw(st.booleans())} for n in laaj_names
            ],
        },
    }
    return rule_data, laaj_data


_REQUIRED_TRANSFORM_FIELDS = [
    "trace_id",
    "youtube_link",
    "channel_name",
    "origin_name",
    "source_type",
    "lat",
    "lng",
]


@st.composite
def _transform_records(draw) -> list:
    count = draw(st.integers(min_value=0, max_value=3))
    records = []
    for i in range(count):
        # Both coordinates are always present and clean, so the only possible
        # required_field error is the single field optionally dropped below.
        lat = draw(st.sampled_from(_CLEAN_COORDS))
        lng = draw(st.sampled_from(_CLEAN_COORDS))
        rec = {
            "trace_id": draw(st.sampled_from(["t1", "t2"])),
            "youtube_link": f"https://youtu.be/{i}",
            "channel_name": "채널",
            "origin_name": draw(st.sampled_from(_NAMES)),
            "source_type": "manual",
            "lat": lat,
            "lng": lng,
            "evaluation_results": draw(st.sampled_from([{"dummy": True}, {}])),
        }
        if draw(st.booleans()):
            rec.pop(draw(st.sampled_from(_REQUIRED_TRANSFORM_FIELDS)), None)
        records.append(rec)
    return records


_error_list = st.lists(
    st.fixed_dictionaries(
        {
            "severity": st.sampled_from(["error", "warning", "info", "unknown"]),
            "rule": st.sampled_from(["r1", "r2"]),
        }
    ),
    max_size=6,
)


@unittest.skipIf(rs_validators is None, f"Rust_Component unavailable ({_RUST_IMPORT_ERROR})")
class Property6ValidatorParity(unittest.TestCase):
    """Feature: platform-modernization, Property 6: 파이썬 ↔ 러스트 출력 동등성."""

    def test_python_whitespace_boundaries_are_preserved(self) -> None:
        whitespace = [chr(code) for code in range(0x3100) if chr(code).isspace()]
        for char in whitespace:
            with self.subTest(codepoint=ord(char)):
                data = {'evaluation_results': {
                    key: {'values': [{'name': 'fixture', 'eval_value': None,
                                     'eval_basis': char + '0000' + char}]}
                    for key in ('visit_authenticity', 'rb_inference_score',
                                'rb_grounding_TF', 'review_faithfulness_score', 'category_TF')
                }}
                self._assert_parity('whitespace', {'data': data},
                    lambda p: {'errors': py_validators.validate_laaj_results('fixture', p['data'])},
                    lambda p: {'errors': rs_validators.validate_laaj_results('fixture', p['data'])})

    def _assert_parity(self, input_id: str, payload, py_impl, rust_impl) -> None:
        result = run_parity(
            SLICE_ID,
            input_id,
            payload,
            python_impl=py_impl,
            rust_impl=rust_impl,
            rust_artifact_id=RUST_ARTIFACT_ID,
        )
        # The compared-field set must be non-empty (Requirement 2.3) ...
        self.assertTrue(
            result["compared_fields"],
            msg=f"empty compared-field set for {input_id}: {result}",
        )
        # ... and every compared field must match (Requirements 2.1, 2.2, 2.7).
        self.assertTrue(
            result["matched"],
            msg=(
                f"parity mismatch for {input_id}: "
                f"mismatch_fields={result['mismatch_fields']} "
                f"count={result['mismatch_field_count']} "
                f"code={result['result_code']}"
            ),
        )
        self.assertEqual(result["mismatch_field_count"], 0)
        self.assertEqual(result["result_code"], None)
        # Mismatch field names are bounded to 50 (Requirement 2.3).
        self.assertLessEqual(len(result["mismatch_fields"]), 50)

    @settings(max_examples=MAX_EXAMPLES, deadline=None)
    @given(video_id=_video_id, data=_gemini_data())
    def test_gemini_output_parity(self, video_id: str, data: dict) -> None:
        self._assert_parity(
            "gemini",
            {"video_id": video_id, "data": data},
            lambda p: {"errors": py_validators.validate_gemini_output(p["video_id"], p["data"])},
            lambda p: {"errors": rs_validators.validate_gemini_output(p["video_id"], p["data"])},
        )

    @settings(max_examples=MAX_EXAMPLES, deadline=None)
    @given(video_id=_video_id, data=_selection_data())
    def test_selection_parity(self, video_id: str, data: dict) -> None:
        self._assert_parity(
            "selection",
            {"video_id": video_id, "data": data},
            lambda p: {"errors": py_validators.validate_selection(p["video_id"], p["data"])},
            lambda p: {"errors": rs_validators.validate_selection(p["video_id"], p["data"])},
        )

    @settings(max_examples=MAX_EXAMPLES, deadline=None)
    @given(video_id=_video_id, data=_rule_data())
    def test_rule_results_parity(self, video_id: str, data: dict) -> None:
        self._assert_parity(
            "rule_results",
            {"video_id": video_id, "data": data},
            lambda p: {"errors": py_validators.validate_rule_results(p["video_id"], p["data"])},
            lambda p: {"errors": rs_validators.validate_rule_results(p["video_id"], p["data"])},
        )

    @settings(max_examples=MAX_EXAMPLES, deadline=None)
    @given(video_id=_video_id, data=_laaj_data())
    def test_laaj_results_parity(self, video_id: str, data: dict) -> None:
        self._assert_parity(
            "laaj_results",
            {"video_id": video_id, "data": data},
            lambda p: {"errors": py_validators.validate_laaj_results(p["video_id"], p["data"])},
            lambda p: {"errors": rs_validators.validate_laaj_results(p["video_id"], p["data"])},
        )

    @settings(max_examples=MAX_EXAMPLES, deadline=None)
    @given(video_id=_video_id, pair=_cross_data())
    def test_cross_validate_parity(self, video_id: str, pair: tuple) -> None:
        rule_data, laaj_data = pair
        self._assert_parity(
            "cross_validate",
            {"video_id": video_id, "rule": rule_data, "laaj": laaj_data},
            lambda p: {"errors": py_validators.cross_validate(p["video_id"], p["rule"], p["laaj"])},
            lambda p: {"errors": rs_validators.cross_validate(p["video_id"], p["rule"], p["laaj"])},
        )

    @settings(max_examples=MAX_EXAMPLES, deadline=None)
    @given(video_id=_video_id, records=_transform_records())
    def test_transform_output_parity(self, video_id: str, records: list) -> None:
        self._assert_parity(
            "transform_output",
            {"video_id": video_id, "records": records},
            lambda p: {"errors": py_validators.validate_transform_output(p["video_id"], p["records"])},
            lambda p: {"errors": rs_validators.validate_transform_output(p["video_id"], p["records"])},
        )

    @settings(max_examples=MAX_EXAMPLES, deadline=None)
    @given(errors=_error_list)
    def test_has_blocking_errors_parity(self, errors: list) -> None:
        self._assert_parity(
            "has_blocking_errors",
            {"errors": errors},
            lambda p: {"blocking": py_validators.has_blocking_errors(p["errors"])},
            lambda p: {"blocking": rs_validators.has_blocking_errors(p["errors"])},
        )

    @settings(max_examples=MAX_EXAMPLES, deadline=None)
    @given(errors=_error_list)
    def test_error_summary_parity(self, errors: list) -> None:
        self._assert_parity(
            "error_summary",
            {"errors": errors},
            lambda p: {"summary": py_validators.error_summary(p["errors"])},
            lambda p: {"summary": rs_validators.error_summary(p["errors"])},
        )


if __name__ == "__main__":
    unittest.main()
