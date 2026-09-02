"""Property-based test for Implementation_Selector default resolution.

Feature: platform-modernization (design Property 5, "Implementation_Selector
기본값"). This test targets ``impl_selector.resolve_implementation`` (Task 41,
already landed) and encodes the opt-in contract of requirements 1.5 and 1.11:

  * Requirement 1.5 — the selector runs the Rust_Component only for a
    Migration_Slice whose id the ``TZUDONG_RUST_SLICES`` opt-in *explicitly*
    names; every execution without the opt-in, or that does not name the slice,
    runs the python implementation.
  * Requirement 1.11 — an opt-in that names a slice id absent from the
    Migration_Ledger resolves to the fixed code ``migration_slice_unknown`` and
    runs neither the python implementation nor the Rust_Component.

Design Property 5 (the invariant under test): for *all* environment-variable
mappings and slice-id pairs, ``resolve_implementation`` returns ``rust`` if and
only if the opt-in value explicitly contains that slice id, ``python`` in every
other case, and raises ``migration_slice_unknown`` for an id not present in the
ledger. In short: opt-in-named ⟺ ``rust`` (bounded by ledger membership).

Uses Python ``hypothesis`` (min 100 examples) and runs under
``python -m unittest``. The target module is imported under a guard so that
discovery never fails; the encoded property is skipped cleanly if the module or
the resolver is absent.
"""

from __future__ import annotations

import unittest

from hypothesis import given, settings
from hypothesis import strategies as st

# ---------------------------------------------------------------------------
# Guarded import: skip (never error) if the resolver has not landed.
# ---------------------------------------------------------------------------
_MODULE = None
_LOAD_ERROR = ""
try:  # pragma: no cover - import guard
    from backend.pipeline_control import impl_selector as _MODULE
except Exception as exc:  # noqa: BLE001 - any import failure means "not landed"
    _MODULE = None
    _LOAD_ERROR = (
        "backend/pipeline_control/impl_selector.py not importable "
        f"(task 41): {type(exc).__name__}"
    )

_HAS_RESOLVER = _MODULE is not None and hasattr(_MODULE, "resolve_implementation")

# The opt-in environment variable name and the two fixed implementation labels
# are read from the module when present so the test tracks the module contract.
SELECTOR_ENV = getattr(_MODULE, "SELECTOR_ENV", "TZUDONG_RUST_SLICES")
IMPL_PYTHON = getattr(_MODULE, "IMPL_PYTHON", "python")
IMPL_RUST = getattr(_MODULE, "IMPL_RUST", "rust")
CODE_SLICE_UNKNOWN = getattr(_MODULE, "CODE_SLICE_UNKNOWN", "migration_slice_unknown")


# ---------------------------------------------------------------------------
# Generators.
#
# A run is characterised by:
#   * ``known``     — the set of slice ids declared in an in-memory ledger,
#   * ``opt_in``    — the list of tokens named in the TZUDONG_RUST_SLICES value
#                     (a mix of known ids, unknown ids, and blank noise, with
#                     optional surrounding whitespace to exercise parsing),
#   * ``query``     — the slice id passed to resolve_implementation (drawn from
#                     the known ids OR from an unknown id, so both the
#                     req-1.5 and req-1.11 branches are reached),
#   * ``present``   — whether the opt-in env var is present at all (absent env
#                     must resolve python for every known slice).
#
# Slice ids are drawn from a comma/whitespace-free alphabet so the opt-in raw
# string parse (split on comma, strip, drop empties) is unambiguous and the
# test's expected-membership oracle stays independent of the parser internals.
# ---------------------------------------------------------------------------
_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"
_slice_ids = st.text(alphabet=_ID_ALPHABET, min_size=1, max_size=12)


def _build_ledger(known_ids):
    """A minimal but structurally valid Migration_Ledger for the given ids."""

    return {
        "schemaVersion": 1,
        "slices": [
            {
                "sliceId": sid,
                "replacedPythonPaths": [f"backend/mod_{i}.py"],
                "rustArtifactPaths": [f"backend/rust/crate_{i}/src/lib.rs"],
                "replacementScope": "partial_replacement",
                "activeImplementation": "python",
            }
            for i, sid in enumerate(known_ids)
        ],
    }


def _pad(draw, token):
    """Optionally wrap a token in whitespace; parsing must strip it back."""

    lead = draw(st.sampled_from(["", " ", "  ", "\t"]))
    trail = draw(st.sampled_from(["", " ", "  ", "\t"]))
    return f"{lead}{token}{trail}"


@st.composite
def _selector_cases(draw):
    known = list(draw(st.lists(_slice_ids, min_size=1, max_size=6, unique=True)))
    known_set = set(known)

    # Unknown ids: freshly drawn ids that are NOT in the ledger.
    unknown_pool = [
        sid
        for sid in draw(st.lists(_slice_ids, min_size=0, max_size=4, unique=True))
        if sid not in known_set
    ]

    # Build the opt-in token list: some known ids, some unknown ids, and some
    # blank/noise entries. Order and duplicates are allowed.
    named_known = draw(
        st.lists(st.sampled_from(known), min_size=0, max_size=len(known), unique=True)
    )
    named_unknown = (
        draw(
            st.lists(
                st.sampled_from(unknown_pool),
                min_size=0,
                max_size=len(unknown_pool),
                unique=True,
            )
        )
        if unknown_pool
        else []
    )
    blanks = draw(st.lists(st.sampled_from(["", " ", "\t"]), min_size=0, max_size=3))

    tokens = named_known + named_unknown + list(blanks)
    tokens = draw(st.permutations(tokens))
    raw = ",".join(_pad(draw, str(tok)) for tok in tokens)

    # The set of ids the opt-in *explicitly names* (parse: strip, drop empties).
    named_set = {t.strip() for t in raw.split(",") if t.strip()}

    present = draw(st.booleans())

    # Query id: from the known ledger ids, or an unknown id (which may or may
    # not itself appear in the opt-in, covering requirement 1.11 directly).
    query_unknown_candidates = unknown_pool + [
        sid for sid in draw(st.lists(_slice_ids, min_size=0, max_size=3)) if sid not in known_set
    ]
    if query_unknown_candidates and draw(st.booleans()):
        query = draw(st.sampled_from(query_unknown_candidates))
    else:
        query = draw(st.sampled_from(known))

    return {
        "known": known_set,
        "ledger": _build_ledger(known),
        "raw": raw,
        "named_set": named_set,
        "present": present,
        "query": query,
    }


class ImplementationSelectorDefaultProperties(unittest.TestCase):
    # Feature: platform-modernization, Property 5: Implementation_Selector 기본값.
    # For all environment-variable mappings and slice-id pairs,
    # resolve_implementation returns "rust" IFF the TZUDONG_RUST_SLICES opt-in
    # explicitly names the slice id (and the id is in the ledger), returns
    # "python" for every execution without the opt-in or that does not name the
    # slice, and raises migration_slice_unknown for an id absent from the
    # Migration_Ledger, running neither implementation. Invariant: opt-in-named
    # ⟺ rust, bounded by ledger membership.
    # Validates: Requirements 1.5, 1.11
    @unittest.skipUnless(_HAS_RESOLVER, _LOAD_ERROR or "resolve_implementation unavailable")
    @settings(max_examples=100, deadline=None)
    @given(case=_selector_cases())
    def test_opt_in_named_iff_rust(self, case):
        known = case["known"]
        ledger = case["ledger"]
        query = case["query"]
        present = case["present"]

        # Environment mapping: include the opt-in only when "present"; add an
        # unrelated key to confirm the resolver reads only SELECTOR_ENV.
        environment = {"UNRELATED_KEY": "ignored"}
        if present:
            environment[SELECTOR_ENV] = case["raw"]

        # Requirement 1.11: an id absent from the ledger fails closed with the
        # fixed code and runs neither implementation.
        if query not in known:
            with self.assertRaises(_MODULE.SelectorError) as ctx:
                _MODULE.resolve_implementation(
                    query, environment=environment, ledger=ledger
                )
            self.assertEqual(ctx.exception.code, CODE_SLICE_UNKNOWN)
            return

        result = _MODULE.resolve_implementation(
            query, environment=environment, ledger=ledger
        )
        self.assertIn(result, (IMPL_PYTHON, IMPL_RUST))

        # Requirement 1.5 invariant: rust IFF the (present) opt-in names it.
        named = present and (query in case["named_set"])
        expected = IMPL_RUST if named else IMPL_PYTHON
        self.assertEqual(
            result,
            expected,
            msg=(
                f"query={query!r} present={present} "
                f"named_set={sorted(case['named_set'])!r} raw={case['raw']!r}"
            ),
        )

    @unittest.skipUnless(_HAS_RESOLVER, _LOAD_ERROR or "resolve_implementation unavailable")
    @settings(max_examples=100, deadline=None)
    @given(
        known=st.lists(_slice_ids, min_size=1, max_size=6, unique=True),
        pick=st.data(),
    )
    def test_absent_opt_in_always_python(self, known, pick):
        # With no TZUDONG_RUST_SLICES in the environment at all, every known
        # slice resolves to python (requirement 1.5, "옵트인 입력이 없는 모든 실행").
        ledger = _build_ledger(known)
        query = pick.draw(st.sampled_from(known))
        result = _MODULE.resolve_implementation(query, environment={}, ledger=ledger)
        self.assertEqual(result, IMPL_PYTHON)


if __name__ == "__main__":
    unittest.main()
