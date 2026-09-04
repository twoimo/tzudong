"""Property-based test for the Log_Pipeline Redaction_Boundary bounds (Property 30).

Feature: platform-modernization, Property 30: 로그 경계 값
Validates: Requirement 13.8

Property 30 (design section, requirement 13.8). For *every* log record input,
the value reaching a Log_Sink -- i.e. the output of
``log_redaction.redact_record`` (which routes the record through the shared
``privacy_log.sanitize_log_value`` boundary and then enforces the aggregate
serialized-size bound) -- must satisfy all four bounds simultaneously:

  * every string value is <= 4096 characters,
  * every container carries <= 100 entries,
  * the container nesting depth is <= 8, and
  * the serialized record is <= 65536 bytes,

AND any value produced by truncation carries the single fixed marker
``[TRUNCATED]`` with no length, hash, or other variation woven into it.

``redact_record`` is fail-closed: if it cannot produce a bounded, safe record it
does not forward anything and raises :class:`LogRedactionError` carrying only
the bounded fixed code ``log_redaction_unsafe``. Per the module contract that
outcome is acceptable (no output reaches a sink), so the property accepts it as
long as the surfaced code is exactly the fixed code and nothing else. Whenever a
record *is* returned, all four bounds and the fixed-marker rule must hold.

The generator deliberately builds records that breach each bound individually
(strings longer than 4096, containers wider than 100 entries, nesting deeper
than 8, and aggregate serializations larger than 65536 bytes) and in
combination, plus an arbitrary recursive mix, so the bounds are exercised at
their edges rather than on well-formed input. String content is drawn from a
bracket-free alphabet so a generated value can never counterfeit the
``[TRUNCATED]`` marker and cause a spurious pass/fail.

The bound measurements below are expressed directly from requirement 13.8 rather
than by re-calling the module under test, so each assertion is a genuine
cross-check. The serialized-size measurement mirrors the sink serialization
(``sort_keys`` + compact separators) so the measured size equals the payload a
Log_Sink would write.

Runnable via
``python -m unittest backend.pipeline_control.test_log_bounds_pbt``.
Requires ``hypothesis`` (the project ``.venv`` provides it).
"""

from __future__ import annotations

import json
import unittest
from typing import Any, Iterator

from hypothesis import given, settings
from hypothesis import strategies as st

from backend.pipeline_control.log_redaction import (
    CODE_REDACTION_UNSAFE,
    MAX_DEPTH,
    MAX_ENTRIES,
    MAX_SERIALIZED_BYTES,
    MAX_STRING_LENGTH,
    TRUNCATED,
    LogRedactionError,
    redact_record,
)

# --- Fixed marker literal, expressed from the spec (not an import echo) -----
# Requirement 13.8 mandates a *fixed* truncation marker with no length/hash
# variation. Pin the literal here so the property checks against the spec token
# rather than trusting whatever the module happens to export.
_FIXED_TRUNCATION_MARKER = "[TRUNCATED]"

# The four bounds, restated from requirement 13.8 so the assertions do not lean
# on the module constants they are meant to police.
_MAX_STRING = 4096
_MAX_ENTRIES = 100
_MAX_DEPTH = 8
_MAX_SERIALIZED = 65536


# --- Bound measurements over a redacted (JSON-safe) record ------------------
def _iter_strings(value: Any) -> Iterator[str]:
    """Yield every string in the structure, including mapping keys.

    Keys are serialized alongside values, so they count toward the per-string
    bound and the fixed-marker rule.
    """
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for key, item in value.items():
            if isinstance(key, str):
                yield key
            yield from _iter_strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from _iter_strings(item)


def _max_entry_count(value: Any) -> int:
    """Largest entry count of any single container in the structure."""
    if isinstance(value, dict):
        best = len(value)
        for item in value.values():
            best = max(best, _max_entry_count(item))
        return best
    if isinstance(value, list):
        best = len(value)
        for item in value:
            best = max(best, _max_entry_count(item))
        return best
    return 0


def _container_depth(value: Any) -> int:
    """Container nesting depth: a leaf is 0, an (even empty) container is >= 1."""
    if isinstance(value, dict):
        if not value:
            return 1
        return 1 + max(_container_depth(item) for item in value.values())
    if isinstance(value, list):
        if not value:
            return 1
        return 1 + max(_container_depth(item) for item in value)
    return 0


def _serialized_size(record: dict[str, Any]) -> int:
    """Byte size as the sink would serialize it (matches log_redaction)."""
    return len(
        json.dumps(record, sort_keys=True, separators=(",", ":")).encode("utf-8")
    )


def _truncation_markers_are_fixed(value: Any) -> bool:
    """True iff every ``[TRUNCATED`` occurrence is exactly the fixed marker.

    A length/hash-tagged marker such as ``[TRUNCATED:1234]`` or
    ``[TRUNCATED#abcd]`` would fail this check. Because generated string content
    never contains ``[``, the only way a ``[TRUNCATED`` prefix can appear in the
    output is via the redaction boundary's own marker.
    """
    for text in _iter_strings(value):
        index = 0
        prefix = "[TRUNCATED"
        while True:
            found = text.find(prefix, index)
            if found == -1:
                break
            segment = text[found : found + len(_FIXED_TRUNCATION_MARKER)]
            if segment != _FIXED_TRUNCATION_MARKER:
                return False
            index = found + len(_FIXED_TRUNCATION_MARKER)
    return True


# --- Generators that breach each bound, individually and together -----------
# Bracket-free alphabet so generated strings can never counterfeit a marker.
_SAFE_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -_.,"

_safe_text = st.text(alphabet=_SAFE_ALPHABET, max_size=24)


def _blob(length: int) -> str:
    """A bracket-free string of exactly ``length`` chars made of short tokens.

    Content is short whitespace-separated tokens rather than one unbroken run,
    which keeps the length/size bounds genuinely breached without steering the
    redaction boundary's regexes into pathological backtracking, and can never
    counterfeit the ``[TRUNCATED]`` / ``[REDACTED]`` markers (no brackets).
    """
    unit = "ab cd ef "
    return (unit * (length // len(unit) + 1))[:length]


# Strings that exceed the 4096-char bound.
_overlong_strings = st.integers(
    min_value=_MAX_STRING + 1, max_value=_MAX_STRING + 2048
).map(_blob)

_scalar_leaf = st.one_of(
    _safe_text,
    _overlong_strings,
    st.integers(min_value=-1_000_000, max_value=1_000_000),
    st.floats(allow_nan=False, allow_infinity=False, width=32),
    st.booleans(),
    st.none(),
)


@st.composite
def _wide_container(draw: st.DrawFn) -> Any:
    """A single container with more than 100 entries."""
    size = draw(st.integers(min_value=_MAX_ENTRIES + 1, max_value=_MAX_ENTRIES * 2))
    if draw(st.booleans()):
        return {f"key_{index}": index for index in range(size)}
    return list(range(size))


@st.composite
def _deep_container(draw: st.DrawFn) -> Any:
    """A chain nested deeper than 8 levels."""
    depth = draw(st.integers(min_value=_MAX_DEPTH + 1, max_value=_MAX_DEPTH * 2))
    value: Any = draw(st.one_of(_safe_text, st.integers(), st.none()))
    for _ in range(depth):
        if draw(st.booleans()):
            value = {"nested": value}
        else:
            value = [value]
    return value


@st.composite
def _big_aggregate(draw: st.DrawFn) -> Any:
    """A container whose serialized form exceeds 65536 bytes.

    Uses many moderate strings (each well under the 4096-char bound) so the
    aggregate byte size, not any single string, drives the serialized-size
    breach.
    """
    count = draw(st.integers(min_value=90, max_value=100))
    length = draw(st.integers(min_value=760, max_value=900))
    return {f"blob_{index}": _blob(length) for index in range(count)}


# A recursive mix of scalars and containers, seeded with the bound-breaching
# builders so overflow can appear at any depth.
_recursive_value = st.recursive(
    st.one_of(_scalar_leaf, _wide_container(), _deep_container(), _big_aggregate()),
    lambda children: st.one_of(
        st.lists(children, max_size=6),
        st.dictionaries(_safe_text, children, max_size=6),
    ),
    max_leaves=25,
)


@st.composite
def _records(draw: st.DrawFn) -> dict[str, Any]:
    """A top-level log record that breaches the bounds individually and jointly.

    Each record aggregates several overflow-prone fields so their combined
    serialization frequently exceeds the 65536-byte bound while any one field
    may independently breach the string/entry/depth bounds.
    """
    record: dict[str, Any] = {}
    field_count = draw(st.integers(min_value=1, max_value=6))
    field_source = st.one_of(
        _recursive_value,
        _wide_container(),
        _deep_container(),
        _overlong_strings,
        _big_aggregate(),
        _scalar_leaf,
    )
    for index in range(field_count):
        record[f"field_{index}"] = draw(field_source)
    return record


class LogBoundsPropertyTests(unittest.TestCase):
    def test_module_truncation_marker_is_the_fixed_token(self) -> None:
        # Anchor: the module's marker is exactly the fixed spec token, with no
        # length/hash variation baked into the constant itself (13.8).
        self.assertEqual(TRUNCATED, _FIXED_TRUNCATION_MARKER)
        self.assertEqual(MAX_STRING_LENGTH, _MAX_STRING)
        self.assertEqual(MAX_ENTRIES, _MAX_ENTRIES)
        self.assertEqual(MAX_DEPTH, _MAX_DEPTH)
        self.assertEqual(MAX_SERIALIZED_BYTES, _MAX_SERIALIZED)

    def test_overlong_string_is_bounded_and_marker_fixed(self) -> None:
        # Anchor: a single over-limit string is truncated to <= 4096 chars and
        # the truncation uses exactly the fixed marker.
        record = {"payload": "a" * (_MAX_STRING * 3)}
        out = redact_record(record)
        (value,) = (v for v in out.values())
        self.assertLessEqual(len(value), _MAX_STRING)
        self.assertTrue(value.endswith(_FIXED_TRUNCATION_MARKER))
        self.assertTrue(_truncation_markers_are_fixed(out))

    def test_deep_nesting_collapses_within_depth_bound(self) -> None:
        # Anchor: nesting far deeper than 8 collapses to depth <= 8.
        value: Any = "leaf"
        for _ in range(_MAX_DEPTH * 2):
            value = {"nested": value}
        out = redact_record({"deep": value})
        self.assertLessEqual(_container_depth(out), _MAX_DEPTH)

    # Feature: platform-modernization, Property 30: 로그 경계 값
    # Validates: Requirement 13.8
    @settings(max_examples=100, deadline=None)
    @given(record=_records())
    def test_property_30_log_bounds(self, record: dict[str, Any]) -> None:
        try:
            redacted = redact_record(record)
        except LogRedactionError as exc:
            # Fail-closed is acceptable: nothing is forwarded to a sink, and the
            # only surfaced payload is the bounded fixed code (13.8/13.15).
            self.assertEqual(exc.code, CODE_REDACTION_UNSAFE)
            self.assertEqual(str(exc), CODE_REDACTION_UNSAFE)
            return

        # A forwarded record is always a dict object.
        self.assertIsInstance(redacted, dict)

        # Bound 1: every string value is at most 4096 characters.
        for text in _iter_strings(redacted):
            self.assertLessEqual(len(text), _MAX_STRING)

        # Bound 2: no container carries more than 100 entries.
        self.assertLessEqual(_max_entry_count(redacted), _MAX_ENTRIES)

        # Bound 3: container nesting depth stays within 8 levels.
        self.assertLessEqual(_container_depth(redacted), _MAX_DEPTH)

        # Bound 4: the serialized record fits within 65536 bytes.
        self.assertLessEqual(_serialized_size(redacted), _MAX_SERIALIZED)

        # Fixed marker: any truncation uses exactly ``[TRUNCATED]`` with no
        # length/hash variation.
        self.assertTrue(
            _truncation_markers_are_fixed(redacted),
            "truncation must use the fixed [TRUNCATED] marker",
        )

        # Determinism: the same class of value always maps to the same output,
        # so redacting twice yields an identical bounded record.
        self.assertEqual(redact_record(record), redacted)


if __name__ == "__main__":
    unittest.main()
