"""Property-based test for the Log_Pipeline Redaction_Boundary (Property 28).

Feature: platform-modernization, Property 28: 로그 레다크션 누출 부재
Validates: Requirements 4.8, 8.4, 10.8, 11.10, 12.9, 13.5, 13.6, 13.9, 13.15,
15.7, 15.11

Property 28 (design section "로그 레다크션 누출 부재"). For *every* log record
input -- including deeply nested structures that exceed the depth bound, cyclic
references, non-serializable objects, empty records, null values, and exception
objects -- the value that reaches a Log_Sink must not carry any Forbidden_Log_Field
value. The twelve Forbidden_Log_Field classes named by the design are:

  1.  passwords
  2.  credentials
  3.  cookies
  4.  session / onboarding tokens
  5.  email addresses
  6.  phone numbers
  7.  resident registration numbers (RRNs)
  8.  precise location
  9.  raw OCR
  10. arbitrary request bodies
  11. provider diagnostics
  12. free-form errors

This test drives the shared backend Redaction_Boundary
``backend.utils.privacy_log.sanitize_log_value`` and the Log_Pipeline wrapper
``backend.pipeline_control.log_redaction.redact_record``.

Generator
---------
``st.recursive``-style nested ``dict``/``list``/``tuple``/``frozenset``
structures whose leaves mix benign primitives with *planted* secrets drawn from
all twelve Forbidden_Log_Field classes, plus cyclic references, non-serializable
objects, and exception objects. Every planted secret is carried in a form the
Redaction_Boundary is contractually required to remove -- either under a
sensitive key (key redaction) or as a value that matches a value pattern (value
redaction) -- and each carries a distinctive sentinel token drawn from an
alphabet the benign generator cannot produce, so a leak is unambiguous.

Invariant
---------
The Redaction_Boundary never raises on any of these inputs, its output is
JSON-serializable, and the serialized (sink) form never contains any planted
sentinel. ``redact_record`` either returns a bounded serialized-safe dict with
no planted sentinel, or fails closed with the single bounded fixed code
``log_redaction_unsafe`` carrying at most an exception *type name* (never a
message) -- in neither case does a planted value reach the sink.

Runnable via
``python -m unittest backend.pipeline_control.test_log_redaction_pbt``.
Requires ``hypothesis`` (the project ``.venv`` provides it).
"""

from __future__ import annotations

import json
import unittest
from typing import Any

from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from backend.pipeline_control.log_redaction import (
    CODE_REDACTION_UNSAFE,
    LogRedactionError,
    redact_record,
)
from backend.utils.privacy_log import sanitize_log_value

# --- Sentinel design -------------------------------------------------------
# Sentinel tokens use an uppercase-only prefix. The benign leaf generator draws
# from a lowercase/digit/space alphabet with no ``-``, ``.``, ``@``, ``=`` and no
# uppercase, so no benign leaf can ever equal a planted sentinel or reproduce one
# of the fixed-shape secrets (phone/RRN/coordinate). A match in the serialized
# output therefore proves a genuine leak, not a generator coincidence.
_SENTINEL_PREFIX = "XSECRETLEAK"
_BENIGN_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789 "

# Fixed-shape secrets (their pattern is the identity; no token can be embedded).
_PLANTED_PHONE = "010-9876-5432"
_PLANTED_RRN = "880808-2345678"
_PLANTED_LAT = "37.987654"
_PLANTED_LNG = "126.987654"


class _NonSerializable:
    """A plain object json.dumps cannot encode; the boundary must not stringify
    it into a leak but reduce it to a bounded ``<type-name>`` token."""

    def __init__(self) -> None:
        # A secret stashed on a non-serializable object must never surface.
        self.secret = f"{_SENTINEL_PREFIX}ATTR"

    def __repr__(self) -> str:  # pragma: no cover - must never be invoked
        return f"secret={_SENTINEL_PREFIX}REPR"


# Non-serializable / unsupported leaf objects. They carry no *tracked* sentinel
# on their own (their internal secrets use the sentinel prefix, and the boundary
# must never reach them); they exercise the "never raises / never stringifies"
# guarantee.
def _weird_objects() -> list[Any]:
    return [object(), (lambda: None), _NonSerializable(), Ellipsis]


@st.composite
def _log_inputs(draw: st.DrawFn) -> tuple[Any, list[str]]:
    """Build a nested structure with planted secrets and return (value, planted).

    ``planted`` is the list of substrings that MUST NOT appear in the sink
    serialization of the redacted output.
    """
    planted: list[str] = []
    counter = [0]

    def nonce() -> str:
        counter[0] += 1
        return f"{_SENTINEL_PREFIX}{counter[0]}"

    def planter() -> Any:
        """Return a carrier for one Forbidden_Log_Field class, tracking the
        sentinel(s) it must scrub. Every carrier is self-redacting: key-based
        carriers ride a sensitive key; value-based carriers match a value
        pattern regardless of position."""
        kind = draw(st.integers(min_value=0, max_value=11))
        if kind == 0:  # 1. passwords -- sensitive key
            token = nonce()
            planted.append(token)
            return {"password": token}
        if kind == 1:  # 2. credentials -- sensitive key
            token = nonce()
            planted.append(token)
            key = draw(st.sampled_from(["api_key", "secret", "service_role_key"]))
            return {key: token}
        if kind == 2:  # 3. cookies -- sensitive key
            token = nonce()
            planted.append(token)
            return {"cookie": token}
        if kind == 3:  # 4. session / onboarding tokens -- sensitive key
            token = nonce()
            planted.append(token)
            key = draw(st.sampled_from(["session", "session_token", "onboarding_token"]))
            return {key: token}
        if kind == 4:  # 5. email addresses -- value pattern
            token = nonce()
            planted.append(token)
            return f"{token}@planted.example"
        if kind == 5:  # 6. phone numbers -- value pattern (fixed shape)
            planted.append(_PLANTED_PHONE)
            return _PLANTED_PHONE
        if kind == 6:  # 7. RRNs -- value pattern (fixed shape)
            planted.append(_PLANTED_RRN)
            return _PLANTED_RRN
        if kind == 7:  # 8. precise location -- labeled value (fixed shape)
            planted.extend([_PLANTED_LAT, _PLANTED_LNG])
            return f"lat: {_PLANTED_LAT}, lng: {_PLANTED_LNG}"
        if kind == 8:  # 9. raw OCR -- sensitive key
            token = nonce()
            planted.append(token)
            key = draw(st.sampled_from(["raw_ocr", "ocr_text", "ocr"]))
            return {key: token}
        if kind == 9:  # 10. arbitrary request bodies -- value pattern
            token = nonce()
            planted.append(token)
            return f"password={token}"
        if kind == 10:  # 11. provider diagnostics -- value pattern (bearer)
            token = nonce()
            planted.append(token)
            return f"Bearer {token}"
        # 12. free-form errors -- exception object (only the type name survives)
        token = nonce()
        planted.append(token)
        return ValueError(f"provider failure {token}")

    def leaf() -> Any:
        choice = draw(st.integers(min_value=0, max_value=4))
        if choice == 0:
            return draw(
                st.one_of(
                    st.none(),
                    st.booleans(),
                    st.integers(min_value=-1_000_000, max_value=1_000_000),
                    st.floats(allow_nan=False, allow_infinity=False, width=32),
                    st.text(alphabet=_BENIGN_ALPHABET, max_size=20),
                    st.frozensets(st.integers(max_value=50, min_value=-50), max_size=3),
                )
            )
        if choice in (1, 2):
            return planter()
        if choice == 3:
            return draw(st.sampled_from(_weird_objects()))
        return planter()

    def build(depth: int) -> Any:
        if depth <= 0:
            return leaf()
        shape = draw(st.integers(min_value=0, max_value=3))
        if shape == 0:
            return leaf()
        size = draw(st.integers(min_value=0, max_value=4))
        if shape == 1:  # list
            return [build(depth - 1) for _ in range(size)]
        if shape == 2:  # dict with benign string keys
            result: dict[str, Any] = {}
            for _ in range(size):
                key = draw(st.text(alphabet=_BENIGN_ALPHABET, min_size=1, max_size=10))
                result[key] = build(depth - 1)
            return result
        # shape == 3: tuple (list-like to the boundary)
        return tuple(build(depth - 1) for _ in range(min(size, 3)))

    generated = build(draw(st.integers(min_value=1, max_value=5)))

    # A self-referencing dict and list exercise cycle handling. Each also holds a
    # planted secret so the cycle branch is proven to redact, not just survive.
    cyclic_dict: dict[str, Any] = {"planted": planter()}
    cyclic_dict["self"] = cyclic_dict
    cyclic_list: list[Any] = [planter()]
    cyclic_list.append(cyclic_list)

    root: dict[str, Any] = {
        "generated": generated,
        "always_planted": [planter() for _ in range(draw(st.integers(1, 4)))],
        "cyclic_dict": cyclic_dict,
        "cyclic_list": cyclic_list,
        "weird": draw(st.sampled_from(_weird_objects())),
        "empty_dict": {},
        "empty_list": [],
        "null": None,
    }
    return root, planted


def _assert_no_leak(serialized: str, planted: list[str]) -> None:
    for secret in planted:
        if secret in serialized:
            raise AssertionError(
                f"planted secret leaked into sink serialization: {secret!r}"
            )


class LogRedactionLeakPropertyTests(unittest.TestCase):
    def test_canonical_record_redacts_every_class(self) -> None:
        # Anchor example: one carrier from every Forbidden_Log_Field class,
        # nested, cyclic, with a non-serializable object and an exception.
        cyclic: dict[str, Any] = {}
        cyclic["self"] = cyclic
        cyclic["cookie"] = "XSECRETLEAKcookie"
        record = {
            "password": "XSECRETLEAKpw",
            "api_key": "XSECRETLEAKcred",
            "session_token": "XSECRETLEAKsess",
            "onboarding_token": "XSECRETLEAKonb",
            "raw_ocr": "XSECRETLEAKocr",
            "email_value": "XSECRETLEAKmail@planted.example",
            "phone_value": _PLANTED_PHONE,
            "rrn_value": _PLANTED_RRN,
            "coords_value": f"lat: {_PLANTED_LAT}, lng: {_PLANTED_LNG}",
            "body_value": "password=XSECRETLEAKbody",
            "diag_value": "Bearer XSECRETLEAKdiag",
            "error_obj": RuntimeError("provider failure XSECRETLEAKerr"),
            "weird": object(),
            "cyclic": cyclic,
        }
        planted = [
            "XSECRETLEAKpw",
            "XSECRETLEAKcred",
            "XSECRETLEAKsess",
            "XSECRETLEAKonb",
            "XSECRETLEAKocr",
            "XSECRETLEAKmail",
            _PLANTED_PHONE,
            _PLANTED_RRN,
            _PLANTED_LAT,
            _PLANTED_LNG,
            "XSECRETLEAKbody",
            "XSECRETLEAKdiag",
            "XSECRETLEAKerr",
            "XSECRETLEAKcookie",
        ]

        sanitized = sanitize_log_value(record, max_depth=8)
        serialized = json.dumps(sanitized, ensure_ascii=False, sort_keys=True)
        _assert_no_leak(serialized, planted)

        redacted = redact_record(record)
        _assert_no_leak(
            json.dumps(redacted, ensure_ascii=False, sort_keys=True), planted
        )

    # Feature: platform-modernization, Property 28: 로그 레다크션 누출 부재
    # Validates: Requirements 4.8, 8.4, 10.8, 11.10, 12.9, 13.5, 13.6, 13.9,
    # 13.15, 15.7, 15.11
    @settings(
        max_examples=100,
        deadline=None,
        suppress_health_check=[HealthCheck.too_slow, HealthCheck.data_too_large],
    )
    @given(_log_inputs())
    def test_property_28_no_forbidden_value_reaches_sink(
        self, payload: tuple[Any, list[str]]
    ) -> None:
        value, planted = payload

        # 1. The shared Redaction_Boundary never raises, even on cyclic,
        #    non-serializable, exception, and over-deep inputs.
        try:
            sanitized_default = sanitize_log_value(value)
            sanitized_aligned = sanitize_log_value(value, max_depth=8)
        except BaseException as exc:  # pragma: no cover - failure path
            self.fail(f"sanitize_log_value raised {type(exc).__name__}")

        # 2. Its output is JSON-serializable (it reaches a sink as JSON) and
        #    carries no planted Forbidden_Log_Field value.
        for sanitized in (sanitized_default, sanitized_aligned):
            try:
                serialized = json.dumps(
                    sanitized, ensure_ascii=False, sort_keys=True
                )
            except BaseException as exc:  # pragma: no cover - failure path
                self.fail(f"redacted output was not serializable: {type(exc).__name__}")
            _assert_no_leak(serialized, planted)

        # 3. The Log_Pipeline wrapper either returns a bounded, serialized-safe
        #    dict with no planted value, or fails closed with exactly the fixed
        #    code and a bounded (message-free) exception type name -- never a leak.
        try:
            redacted = redact_record(value)
        except LogRedactionError as exc:
            self.assertEqual(exc.code, CODE_REDACTION_UNSAFE)
            if exc.error_name is not None:
                self.assertLessEqual(len(exc.error_name), 128)
                _assert_no_leak(exc.error_name, planted)
        else:
            self.assertIsInstance(redacted, dict)
            _assert_no_leak(
                json.dumps(redacted, ensure_ascii=False, sort_keys=True), planted
            )


if __name__ == "__main__":
    unittest.main()
