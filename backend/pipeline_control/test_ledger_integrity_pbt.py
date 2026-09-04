"""Property-based test for repo-owned ledger structural integrity.

Feature: platform-modernization (design Property 1, "원장 구조 무결성"). This test
targets the shared ledger validator described in design section "Correctness
Properties → Property 1" and the Data Models section (D1, D3, D4, D9 and the
C3/C7/C10 ledger descriptions). It encodes design Property 1, uses Python
``hypothesis`` (min 100 examples), and runs under ``python -m unittest``.

This is a test-first task (task 2.1): the shared validator does not exist yet.
Because ``backend/pipeline_control/`` IS an importable package (it carries an
``__init__.py`` and sibling tests import from it directly), the target module is
imported normally under a guarded ``try/except`` and the encoded property is
skipped cleanly when the module or the targeted function is absent. As a result
``python -m unittest`` discovery always collects this file without error, and
the encoded property runs the moment the validator lands.

Intended interface (the shared validator implements to match this contract):

  ``ledger_validation.validate_ledger(kind, document) -> {"ok": bool, "errorCode": str|None}``
      Mirrors the ``validate_cadence`` / ``validate_rollback_plan`` /
      ``validate_phase_assignment`` contract already used in this package (a dict
      with an ``ok`` boolean and a bounded ``errorCode`` from a closed set;
      ``None`` when accepted). ``kind`` is one of the seven repo-owned ledger
      kinds enumerated in ``LEDGER_KINDS`` below.

      Per design Property 1 the validator returns ``ok=True`` if and only if the
      document has *none* of the following defects:

        * a required field is empty (missing, ``None``, or blank), or
        * a closed-set field holds a value outside its permitted set, or
        * an identifier that must be unique is duplicated, or
        * a document-kind cardinality rule is violated, specifically:
            - a Tooling_Selection_Record category has fewer than 2 or more than
              6 candidates,
            - a Phase_Gate record does not carry exactly one Rollback_Plan
              reference, or
            - a Performance_Evidence_Set has a repetition/sample count below 7
              or a summary statistic other than ``p75``.

      On rejection ``ok`` is ``False`` and ``errorCode`` is a bounded, non-empty
      string; on acceptance ``errorCode`` is ``None`` (or empty).

The seven ledger kinds and their structural contracts encoded here derive from
the design Data Models and component sections:

  * ``migration_ledger``            — D1 (schemaVersion, slices[] with unique
                                       sliceId, non-empty replaced/rust path
                                       lists, closed replacementScope /
                                       activeImplementation).
  * ``performance_evidence_set``    — D3 (repetitionCount >= 7, summaryStatistic
                                       == "p75", non-empty id/slice/metric).
  * ``layout_manifest``             — D4 (entries[] with unique path, non-empty
                                       ownership / allowedContents /
                                       forbiddenContents, closed classification).
  * ``rename_ledger``               — C3 (entries[] with unique renameId,
                                       non-empty old/new names, closed
                                       contractClass of five values).
  * ``tooling_selection_record``    — C7 (categories[] with unique categoryId,
                                       2..6 candidates each with unique
                                       candidateId).
  * ``deployment_descriptor_set``   — C10 / Req 14.2 (components[] with unique
                                       componentId and all four items filled:
                                       imageRef, resourceRequest, envVars,
                                       secretRefs).
  * ``phase_gate``                  — D9 (entry/exit conditions with unique
                                       conditionId, non-empty verification
                                       commands, exactly one rollback plan ref).
"""

from __future__ import annotations

import unittest

from hypothesis import given, settings
from hypothesis import strategies as st

# ---------------------------------------------------------------------------
# Test-first module load: backend/pipeline_control is an importable package, so
# the shared validator is imported normally under a guard. When the validator
# has not landed yet, the encoded property is skipped rather than failing
# collection.
# ---------------------------------------------------------------------------
_MODULE = None
_LOAD_ERROR = ""
try:  # pragma: no cover - import guard exercised only in the test-first phase
    from backend.pipeline_control import ledger_validation as _MODULE
except Exception as exc:  # noqa: BLE001 - any import failure means "not landed yet"
    _MODULE = None
    _LOAD_ERROR = (
        "backend/pipeline_control/ledger_validation.py not implemented yet "
        f"(task 2.1): {type(exc).__name__}"
    )

_HAS_VALIDATOR = _MODULE is not None and hasattr(_MODULE, "validate_ledger")
_HAS_PATH_VALIDATOR = _MODULE is not None and hasattr(
    _MODULE, "validate_migration_slice_paths"
)
_PATH_LOAD_ERROR = _LOAD_ERROR or (
    "backend/pipeline_control/ledger_validation.validate_migration_slice_paths "
    "not implemented yet (task 46.2)"
)


# ---------------------------------------------------------------------------
# Closed sets and cardinality constants (shared by generators and the oracle).
# ---------------------------------------------------------------------------
SCHEMA_VERSION = 1

MIGRATION_REPLACEMENT_SCOPES = ("partial_replacement", "full_replacement")
MIGRATION_ACTIVE_IMPLS = ("python", "rust")
LAYOUT_CLASSIFICATIONS = ("source", "build_artifact", "local_ephemeral")
RENAME_CONTRACT_CLASSES = (
    "internal-path",
    "runner-contract",
    "test-loader-contract",
    "operator-cli-contract",
    "regression-fixture-contract",
)

MIN_SAMPLE_COUNT = 7
SUMMARY_STATISTIC = "p75"
TOOLING_MIN_CANDIDATES = 2
TOOLING_MAX_CANDIDATES = 6

LEDGER_KINDS = (
    "migration_ledger",
    "performance_evidence_set",
    "layout_manifest",
    "rename_ledger",
    "tooling_selection_record",
    "deployment_descriptor_set",
    "phase_gate",
)


# ---------------------------------------------------------------------------
# Small helpers shared by generators.
# ---------------------------------------------------------------------------
_BLANK_SCALARS = ("", "   ")


def _corrupt_required(draw, obj, key):
    """Corrupt a required scalar field by blanking, nulling, or removing it."""

    mode = draw(st.sampled_from(("blank", "none", "delete")))
    if mode == "delete":
        obj.pop(key, None)
    elif mode == "none":
        obj[key] = None
    else:
        obj[key] = draw(st.sampled_from(_BLANK_SCALARS))


def _maybe_duplicate(draw, items, key):
    """With some probability, force a duplicate identifier across ``items``."""

    if len(items) >= 2 and draw(st.booleans()):
        i = draw(st.integers(min_value=0, max_value=len(items) - 1))
        j = draw(st.integers(min_value=0, max_value=len(items) - 1))
        items[i][key] = items[j].get(key)


# ---------------------------------------------------------------------------
# Per-kind generators. Each starts from a valid base document (returned directly
# when the ``valid`` gate is drawn) and otherwise applies independent,
# probabilistic perturbations injecting the four Property-1 defect classes:
# required-field omission, out-of-set closed-field values, duplicate
# identifiers, and cardinality violations. The oracle decides the expected
# result for whatever document is produced.
# ---------------------------------------------------------------------------


@st.composite
def _migration_ledgers(draw):
    n = draw(st.integers(min_value=1, max_value=4))
    slices = [
        {
            "sliceId": f"R{i}-slice",
            "replacedPythonPaths": [f"backend/mod_{i}.py"],
            "rustArtifactPaths": [f"backend/rust/crate_{i}/src/lib.rs"],
            "replacementScope": draw(st.sampled_from(MIGRATION_REPLACEMENT_SCOPES)),
            "activeImplementation": "python",
        }
        for i in range(n)
    ]
    doc = {"schemaVersion": SCHEMA_VERSION, "slices": slices}
    if draw(st.booleans()):
        return doc

    if draw(st.booleans()):
        doc["schemaVersion"] = draw(st.sampled_from([0, 2, "1", None]))
    if slices and draw(st.booleans()):
        _corrupt_required(draw, draw(st.sampled_from(slices)), "sliceId")
    if slices and draw(st.booleans()):
        draw(st.sampled_from(slices))["replacedPythonPaths"] = []
    if slices and draw(st.booleans()):
        draw(st.sampled_from(slices))["rustArtifactPaths"] = []
    if slices and draw(st.booleans()):
        draw(st.sampled_from(slices))["replacementScope"] = draw(
            st.sampled_from(["partial", "full", "", None])
        )
    if slices and draw(st.booleans()):
        draw(st.sampled_from(slices))["activeImplementation"] = draw(
            st.sampled_from(["go", "PYTHON", "", None])
        )
    _maybe_duplicate(draw, slices, "sliceId")
    if draw(st.booleans()):
        doc["slices"] = []
    return doc


@st.composite
def _performance_evidence_sets(draw):
    doc = {
        "evidenceSetId": "R1-validators.2026.001",
        "sliceId": "R1-validators",
        "metricKey": "backend.delta_total_p75_ms",
        "repetitionCount": draw(st.integers(min_value=MIN_SAMPLE_COUNT, max_value=12)),
        "summaryStatistic": SUMMARY_STATISTIC,
    }
    if draw(st.booleans()):
        return doc

    if draw(st.booleans()):
        _corrupt_required(
            draw, doc, draw(st.sampled_from(["evidenceSetId", "sliceId", "metricKey"]))
        )
    if draw(st.booleans()):
        doc["repetitionCount"] = draw(st.integers(min_value=-1, max_value=6))
    if draw(st.booleans()):
        doc["repetitionCount"] = draw(st.sampled_from([None, "7", 7.5]))
    if draw(st.booleans()):
        doc["summaryStatistic"] = draw(
            st.sampled_from(["p50", "p90", "mean", "median", "", None])
        )
    return doc


@st.composite
def _layout_manifests(draw):
    n = draw(st.integers(min_value=1, max_value=4))
    entries = [
        {
            "path": f"backend/dir_{i}",
            "ownership": f"owner {i}",
            "allowedContents": [f"allowed {i}"],
            "forbiddenContents": [f"forbidden {i}"],
            "classification": draw(st.sampled_from(LAYOUT_CLASSIFICATIONS)),
        }
        for i in range(n)
    ]
    doc = {"schemaVersion": SCHEMA_VERSION, "entries": entries}
    if draw(st.booleans()):
        return doc

    if draw(st.booleans()):
        doc["schemaVersion"] = draw(st.sampled_from([0, 2, None]))
    if entries and draw(st.booleans()):
        _corrupt_required(
            draw, draw(st.sampled_from(entries)), draw(st.sampled_from(["path", "ownership"]))
        )
    if entries and draw(st.booleans()):
        draw(st.sampled_from(entries))["allowedContents"] = []
    if entries and draw(st.booleans()):
        draw(st.sampled_from(entries))["forbiddenContents"] = []
    if entries and draw(st.booleans()):
        draw(st.sampled_from(entries))["classification"] = draw(
            st.sampled_from(["binary", "SOURCE", "", None])
        )
    _maybe_duplicate(draw, entries, "path")
    if draw(st.booleans()):
        doc["entries"] = []
    return doc


@st.composite
def _rename_ledgers(draw):
    n = draw(st.integers(min_value=1, max_value=4))
    entries = [
        {
            "renameId": f"rename-{i}",
            "oldName": f"old_name_{i}",
            "newName": f"new_name_{i}",
            "contractClass": draw(st.sampled_from(RENAME_CONTRACT_CLASSES)),
        }
        for i in range(n)
    ]
    doc = {"schemaVersion": SCHEMA_VERSION, "entries": entries}
    if draw(st.booleans()):
        return doc

    if draw(st.booleans()):
        doc["schemaVersion"] = draw(st.sampled_from([0, 2, "1", None]))
    if entries and draw(st.booleans()):
        _corrupt_required(
            draw,
            draw(st.sampled_from(entries)),
            draw(st.sampled_from(["renameId", "oldName", "newName"])),
        )
    if entries and draw(st.booleans()):
        draw(st.sampled_from(entries))["contractClass"] = draw(
            st.sampled_from(["internal", "runner_contract", "", None])
        )
    _maybe_duplicate(draw, entries, "renameId")
    if draw(st.booleans()):
        doc["entries"] = []
    return doc


@st.composite
def _tooling_selection_records(draw):
    n = draw(st.integers(min_value=1, max_value=4))
    counter = 0
    categories = []
    for i in range(n):
        k = draw(st.integers(min_value=TOOLING_MIN_CANDIDATES, max_value=TOOLING_MAX_CANDIDATES))
        candidates = []
        for _ in range(k):
            candidates.append({"candidateId": f"cand-{counter}"})
            counter += 1
        categories.append({"categoryId": f"cat-{i}", "candidates": candidates})
    doc = {"categories": categories}
    if draw(st.booleans()):
        return doc

    # Cardinality violation: too few or too many candidates in a category.
    if categories and draw(st.booleans()):
        cat = draw(st.sampled_from(categories))
        bad_k = draw(st.sampled_from([0, 1, 7, 8]))
        cat["candidates"] = [{"candidateId": f"x-{counter + idx}"} for idx in range(bad_k)]
        counter += bad_k
    if categories and draw(st.booleans()):
        _corrupt_required(draw, draw(st.sampled_from(categories)), "categoryId")
    if categories and draw(st.booleans()):
        cat = draw(st.sampled_from(categories))
        if cat["candidates"]:
            _corrupt_required(draw, draw(st.sampled_from(cat["candidates"])), "candidateId")
    _maybe_duplicate(draw, categories, "categoryId")
    if draw(st.booleans()):
        all_cands = [c for cat in categories for c in cat["candidates"]]
        if len(all_cands) >= 2:
            i = draw(st.integers(min_value=0, max_value=len(all_cands) - 1))
            j = draw(st.integers(min_value=0, max_value=len(all_cands) - 1))
            all_cands[i]["candidateId"] = all_cands[j].get("candidateId")
    if draw(st.booleans()):
        doc["categories"] = []
    return doc


@st.composite
def _deployment_descriptor_sets(draw):
    n = draw(st.integers(min_value=1, max_value=4))
    components = [
        {
            "componentId": f"comp-{i}",
            "imageRef": f"registry.local/tzudong/img-{i}:{i}.0.0",
            "resourceRequest": "cpu=500m,memory=512Mi",
            "envVars": [{"name": f"VAR_{i}", "source": "configmap"}],
            "secretRefs": [f"SECRET_{i}_REF"],
        }
        for i in range(n)
    ]
    doc = {"components": components}
    if draw(st.booleans()):
        return doc

    if components and draw(st.booleans()):
        _corrupt_required(
            draw,
            draw(st.sampled_from(components)),
            draw(st.sampled_from(["componentId", "imageRef", "resourceRequest"])),
        )
    if components and draw(st.booleans()):
        draw(st.sampled_from(components))["envVars"] = []
    if components and draw(st.booleans()):
        draw(st.sampled_from(components))["secretRefs"] = []
    _maybe_duplicate(draw, components, "componentId")
    if draw(st.booleans()):
        doc["components"] = []
    return doc


@st.composite
def _phase_gates(draw):
    ne = draw(st.integers(min_value=1, max_value=3))
    nx = draw(st.integers(min_value=1, max_value=3))
    entry = [
        {"conditionId": f"E{i}", "statement": f"entry {i}", "satisfied": None}
        for i in range(ne)
    ]
    exit_conditions = [
        {"conditionId": f"X{i}", "statement": f"exit {i}", "satisfied": None}
        for i in range(nx)
    ]
    doc = {
        "schemaVersion": SCHEMA_VERSION,
        "phaseId": "P1-local-pipeline",
        "entryConditions": entry,
        "exitConditions": exit_conditions,
        "verificationCommands": [{"cwd": "apps/web", "command": "bun run lint"}],
        "rollbackPlanRefs": ["backend/log/phases/P1-local-pipeline-rollback.json"],
    }
    if draw(st.booleans()):
        return doc

    if draw(st.booleans()):
        doc["schemaVersion"] = draw(st.sampled_from([0, 2, None]))
    if draw(st.booleans()):
        _corrupt_required(draw, doc, "phaseId")
    if draw(st.booleans()):
        doc["entryConditions"] = []
    if draw(st.booleans()):
        doc["exitConditions"] = []
    if draw(st.booleans()):
        doc["verificationCommands"] = []
    if draw(st.booleans()):
        # Violate the "exactly one Rollback_Plan reference" cardinality rule.
        doc["rollbackPlanRefs"] = draw(st.sampled_from([[], ["a", "b"], ["a", "b", "c"]]))
    if draw(st.booleans()):
        pool = doc["entryConditions"] + doc["exitConditions"]
        if pool:
            _corrupt_required(draw, draw(st.sampled_from(pool)), "conditionId")
    if draw(st.booleans()):
        all_conds = doc["entryConditions"] + doc["exitConditions"]
        if len(all_conds) >= 2:
            i = draw(st.integers(min_value=0, max_value=len(all_conds) - 1))
            j = draw(st.integers(min_value=0, max_value=len(all_conds) - 1))
            all_conds[i]["conditionId"] = all_conds[j].get("conditionId")
    return doc


_GENERATORS = {
    "migration_ledger": _migration_ledgers,
    "performance_evidence_set": _performance_evidence_sets,
    "layout_manifest": _layout_manifests,
    "rename_ledger": _rename_ledgers,
    "tooling_selection_record": _tooling_selection_records,
    "deployment_descriptor_set": _deployment_descriptor_sets,
    "phase_gate": _phase_gates,
}


def ledger_documents(kind):
    """Strategy factory: produce ledger documents of the requested ``kind``."""

    return _GENERATORS[kind]()


@st.composite
def _kind_and_document(draw):
    kind = draw(st.sampled_from(LEDGER_KINDS))
    document = draw(ledger_documents(kind))
    return kind, document


# ---------------------------------------------------------------------------
# Independent oracle for design Property 1, one function per ledger kind.
# ---------------------------------------------------------------------------


def _is_blank(value):
    if value is None:
        return True
    if isinstance(value, str) and value.strip() == "":
        return True
    return False


def _nonempty_list(value):
    return isinstance(value, list) and len(value) > 0


def _duplicated(values):
    return len(values) != len(set(values))


def _ok_migration_ledger(doc):
    if doc.get("schemaVersion") != SCHEMA_VERSION:
        return False
    slices = doc.get("slices")
    if not _nonempty_list(slices):
        return False
    ids = []
    for item in slices:
        if _is_blank(item.get("sliceId")):
            return False
        ids.append(item.get("sliceId"))
        if not _nonempty_list(item.get("replacedPythonPaths")):
            return False
        if not _nonempty_list(item.get("rustArtifactPaths")):
            return False
        if item.get("replacementScope") not in MIGRATION_REPLACEMENT_SCOPES:
            return False
        if item.get("activeImplementation") not in MIGRATION_ACTIVE_IMPLS:
            return False
    return not _duplicated(ids)


def _ok_performance_evidence_set(doc):
    for field in ("evidenceSetId", "sliceId", "metricKey"):
        if _is_blank(doc.get(field)):
            return False
    rep = doc.get("repetitionCount")
    if isinstance(rep, bool) or not isinstance(rep, int) or rep < MIN_SAMPLE_COUNT:
        return False
    if doc.get("summaryStatistic") != SUMMARY_STATISTIC:
        return False
    return True


def _ok_layout_manifest(doc):
    if doc.get("schemaVersion") != SCHEMA_VERSION:
        return False
    entries = doc.get("entries")
    if not _nonempty_list(entries):
        return False
    paths = []
    for entry in entries:
        if _is_blank(entry.get("path")):
            return False
        paths.append(entry.get("path"))
        if _is_blank(entry.get("ownership")):
            return False
        if not _nonempty_list(entry.get("allowedContents")):
            return False
        if not _nonempty_list(entry.get("forbiddenContents")):
            return False
        if entry.get("classification") not in LAYOUT_CLASSIFICATIONS:
            return False
    return not _duplicated(paths)


def _ok_rename_ledger(doc):
    if doc.get("schemaVersion") != SCHEMA_VERSION:
        return False
    entries = doc.get("entries")
    if not _nonempty_list(entries):
        return False
    ids = []
    for entry in entries:
        if _is_blank(entry.get("renameId")):
            return False
        ids.append(entry.get("renameId"))
        if _is_blank(entry.get("oldName")):
            return False
        if _is_blank(entry.get("newName")):
            return False
        if entry.get("contractClass") not in RENAME_CONTRACT_CLASSES:
            return False
    return not _duplicated(ids)


def _ok_tooling_selection_record(doc):
    categories = doc.get("categories")
    if not _nonempty_list(categories):
        return False
    category_ids = []
    candidate_ids = []
    for category in categories:
        if _is_blank(category.get("categoryId")):
            return False
        category_ids.append(category.get("categoryId"))
        candidates = category.get("candidates")
        if not isinstance(candidates, list):
            return False
        if not (TOOLING_MIN_CANDIDATES <= len(candidates) <= TOOLING_MAX_CANDIDATES):
            return False
        for candidate in candidates:
            if _is_blank(candidate.get("candidateId")):
                return False
            candidate_ids.append(candidate.get("candidateId"))
    if _duplicated(category_ids):
        return False
    return not _duplicated(candidate_ids)


def _ok_deployment_descriptor_set(doc):
    components = doc.get("components")
    if not _nonempty_list(components):
        return False
    ids = []
    for component in components:
        if _is_blank(component.get("componentId")):
            return False
        ids.append(component.get("componentId"))
        if _is_blank(component.get("imageRef")):
            return False
        if _is_blank(component.get("resourceRequest")):
            return False
        if not _nonempty_list(component.get("envVars")):
            return False
        if not _nonempty_list(component.get("secretRefs")):
            return False
    return not _duplicated(ids)


def _ok_phase_gate(doc):
    if doc.get("schemaVersion") != SCHEMA_VERSION:
        return False
    if _is_blank(doc.get("phaseId")):
        return False
    entry = doc.get("entryConditions")
    exit_conditions = doc.get("exitConditions")
    if not _nonempty_list(entry):
        return False
    if not _nonempty_list(exit_conditions):
        return False
    if not _nonempty_list(doc.get("verificationCommands")):
        return False
    refs = doc.get("rollbackPlanRefs")
    if not isinstance(refs, list) or len(refs) != 1 or _is_blank(refs[0]):
        return False
    condition_ids = []
    for condition in list(entry) + list(exit_conditions):
        if _is_blank(condition.get("conditionId")):
            return False
        condition_ids.append(condition.get("conditionId"))
    return not _duplicated(condition_ids)


_ORACLES = {
    "migration_ledger": _ok_migration_ledger,
    "performance_evidence_set": _ok_performance_evidence_set,
    "layout_manifest": _ok_layout_manifest,
    "rename_ledger": _ok_rename_ledger,
    "tooling_selection_record": _ok_tooling_selection_record,
    "deployment_descriptor_set": _ok_deployment_descriptor_set,
    "phase_gate": _ok_phase_gate,
}


def _expected_ok(kind, document):
    """Independent oracle for design Property 1 across all seven ledger kinds."""

    return _ORACLES[kind](document)


def _result_ok(result):
    """Extract the ``ok`` flag from a dict result (validate_cadence convention)."""

    if isinstance(result, dict):
        return result["ok"], result.get("errorCode")
    # Tolerate an attribute-style result object as a fallback.
    return bool(getattr(result, "ok")), getattr(result, "errorCode", None)


class LedgerStructuralIntegrityProperties(unittest.TestCase):
    # Feature: platform-modernization, Property 1: 원장 구조 무결성.
    # For all repo-owned ledger documents (Migration_Ledger,
    # Performance_Evidence_Set, Layout_Manifest, Rename_Ledger,
    # Tooling_Selection_Record, Deployment_Descriptor_Set, Phase_Gate record),
    # the shared validator returns pass IFF the document has no empty required
    # field, no out-of-set closed-field value, no duplicated identifier, and no
    # document-kind cardinality violation (tooling category 2..6 candidates,
    # gate exactly one Rollback_Plan reference, evidence-set sample count >= 7
    # with summary statistic p75).
    # Validates: Requirements 1.1, 1.9, 3.2, 6.1, 6.9, 7.1, 7.2, 11.1, 11.2, 14.2, 16.2
    @unittest.skipUnless(_HAS_VALIDATOR, _LOAD_ERROR or "validate_ledger unavailable")
    @settings(max_examples=100, deadline=None)
    @given(case=_kind_and_document())
    def test_ledger_structural_integrity(self, case):
        kind, document = case
        result = _MODULE.validate_ledger(kind, document)
        ok, error_code = _result_ok(result)

        self.assertEqual(
            ok,
            _expected_ok(kind, document),
            msg=f"kind={kind!r} document={document!r}",
        )

        if ok:
            # Accepted documents carry no rejection code.
            self.assertIn(error_code, (None, ""))
        else:
            # Rejections use a bounded, non-empty fixed code.
            self.assertIsInstance(error_code, str)
            self.assertGreater(len(error_code), 0)


# ---------------------------------------------------------------------------
# Property 2 — Migration_Slice path exclusivity (design Property 2, D1;
# requirements 1.1, 1.7). Distinct from Property 1: it exercises the two
# cross-slice invariants over a Migration_Ledger — the union of every slice's
# replacedPythonPaths has zero duplicates, and the exclusion excludedPaths set
# is disjoint from that replaced-path set.
# ---------------------------------------------------------------------------

# A small shared path pool so that sampling with repetition across up to 20
# slices frequently injects both intra/inter-slice duplicates and
# excluded/replaced overlaps, while empty draws still produce accepted ledgers.
_MIGRATION_PATH_POOL = tuple(f"backend/pkg/module_{i}.py" for i in range(8))
_MIGRATION_REASON_CLASSES = ("node_sdk_bound", "provider_sdk_bound")


@st.composite
def migration_ledgers(draw):
    """Strategy: Migration_Ledgers with 0..20 slices sampled from a shared path
    pool with repetition, plus overlapping exclusion lists (design test-plan
    row 2). Produces both exclusive and non-exclusive documents."""

    n_slices = draw(st.integers(min_value=0, max_value=20))
    slices = []
    for i in range(n_slices):
        replaced = draw(
            st.lists(st.sampled_from(_MIGRATION_PATH_POOL), min_size=0, max_size=3)
        )
        slices.append(
            {
                "sliceId": f"R{i}-slice",
                "replacedPythonPaths": replaced,
                "rustArtifactPaths": [f"backend/rust/crate_{i}/src/lib.rs"],
                "replacementScope": "partial_replacement",
                "activeImplementation": "python",
            }
        )

    n_exclusions = draw(st.integers(min_value=0, max_value=3))
    exclusions = []
    for _ in range(n_exclusions):
        excluded = draw(
            st.lists(st.sampled_from(_MIGRATION_PATH_POOL), min_size=0, max_size=3)
        )
        exclusions.append(
            {
                "excludedPaths": excluded,
                "reasonClass": draw(st.sampled_from(_MIGRATION_REASON_CLASSES)),
            }
        )

    return {
        "schemaVersion": SCHEMA_VERSION,
        "slices": slices,
        "exclusions": exclusions,
    }


def _expected_paths_ok(document):
    """Independent oracle for design Property 2: replaced-path union has no
    duplicate AND excluded ∩ replaced = ∅."""

    replaced = []
    for item in document.get("slices", []):
        replaced.extend(
            p for p in item.get("replacedPythonPaths", []) if isinstance(p, str)
        )
    if len(replaced) != len(set(replaced)):
        return False

    excluded = []
    for exclusion in document.get("exclusions", []):
        excluded.extend(
            p for p in exclusion.get("excludedPaths", []) if isinstance(p, str)
        )
    return not (set(replaced) & set(excluded))


class MigrationSlicePathExclusivityProperties(unittest.TestCase):
    # Feature: platform-modernization, Property 2: Migration_Slice 경로 배타성.
    # For all Migration_Ledgers, the union of every slice's replacedPythonPaths
    # has zero duplicate paths AND the set of exclusion excludedPaths is
    # disjoint from the replaced-path set. The path-exclusivity validator
    # returns pass IFF both hold.
    # Validates: Requirements 1.1, 1.7
    @unittest.skipUnless(_HAS_PATH_VALIDATOR, _PATH_LOAD_ERROR)
    @settings(max_examples=100, deadline=None)
    @given(document=migration_ledgers())
    def test_migration_slice_path_exclusivity(self, document):
        result = _MODULE.validate_migration_slice_paths(document)
        ok, error_code = _result_ok(result)

        self.assertEqual(
            ok,
            _expected_paths_ok(document),
            msg=f"document={document!r}",
        )

        if ok:
            self.assertIn(error_code, (None, ""))
        else:
            self.assertIsInstance(error_code, str)
            self.assertGreater(len(error_code), 0)


class MigrationSlicePathExclusivityExamples(unittest.TestCase):
    """Concrete examples for design Property 2, including the committed ledger."""

    @unittest.skipUnless(_HAS_PATH_VALIDATOR, _PATH_LOAD_ERROR)
    def test_committed_migration_ledger_is_path_exclusive(self):
        import json
        from pathlib import Path

        ledger_path = (
            Path(__file__).resolve().parents[1]
            / "rust"
            / "migration-ledger.v1.json"
        )
        document = json.loads(ledger_path.read_text(encoding="utf-8"))
        result = _MODULE.validate_migration_slice_paths(document)
        ok, error_code = _result_ok(result)
        self.assertTrue(ok, msg=f"errorCode={error_code!r}")
        self.assertIn(error_code, (None, ""))

    @unittest.skipUnless(_HAS_PATH_VALIDATOR, _PATH_LOAD_ERROR)
    def test_duplicate_replaced_path_across_slices_is_rejected(self):
        document = {
            "schemaVersion": SCHEMA_VERSION,
            "slices": [
                {"sliceId": "R1", "replacedPythonPaths": ["backend/a.py"]},
                {"sliceId": "R2", "replacedPythonPaths": ["backend/a.py"]},
            ],
            "exclusions": [],
        }
        ok, _ = _result_ok(_MODULE.validate_migration_slice_paths(document))
        self.assertFalse(ok)

    @unittest.skipUnless(_HAS_PATH_VALIDATOR, _PATH_LOAD_ERROR)
    def test_excluded_path_that_is_also_replaced_is_rejected(self):
        document = {
            "schemaVersion": SCHEMA_VERSION,
            "slices": [
                {"sliceId": "R1", "replacedPythonPaths": ["backend/a.py"]},
            ],
            "exclusions": [
                {"excludedPaths": ["backend/a.py"], "reasonClass": "node_sdk_bound"},
            ],
        }
        ok, _ = _result_ok(_MODULE.validate_migration_slice_paths(document))
        self.assertFalse(ok)


if __name__ == "__main__":
    unittest.main()
