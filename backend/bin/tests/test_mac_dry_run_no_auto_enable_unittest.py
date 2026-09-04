"""Unit test: Mac entrypoint previews before any live write and never auto-enables.

Feature: crawler-pipeline-orchestration (Requirements 3.5, 3.6). Task 4.7.

These are read-only source-contract assertions over the Mac entrypoint chain
plus safely-runnable pure checks. No source file is modified or executed.

Requirement 3.5 (dry-run preview precedes any live write):
  * The Mac entrypoint ``run_hosted_new_video_pipeline.py`` runs a dry-run apply
    preview (``apply_cmd + ["--dry-run"]``) before it invokes the live apply
    (``apply_exit = _run(apply_cmd)``).
  * The apply script ``apply_hosted_pending_candidates.py`` always builds the
    apply preview (``build_apply_preview``) before it can call the live
    ``apply_pending_candidates``, and gates the live apply behind a
    dry-run / zero-candidate short-circuit that returns first.

Requirement 3.6 (no auto-enable during unattended runs):
  * Neither the entrypoint, the apply script, nor the hosted data-plane planner
    writes the approval env var ``TZUDONG_HOSTED_DATA_PLANE_APPROVED`` or flips
    the hosted-apply latch ``PIPELINE_HOSTED_APPLY_ENABLED`` into the process
    environment; enablement stays an explicit operator action.
  * ``PIPELINE_HOSTED_APPLY_ENABLED`` remains a module-level compile-time
    ``False`` constant in ``backend/utils/supabase_rest.py`` and is never
    reassigned to a truthy value.

Runnable via ``python -m unittest``.
"""

from __future__ import annotations

import ast
import unittest
from pathlib import Path


# tests -> bin -> backend -> <repo root>
REPO_ROOT = Path(__file__).resolve().parents[3]

ENTRYPOINT = REPO_ROOT / "backend" / "bin" / "run_hosted_new_video_pipeline.py"
APPLY_SCRIPT = REPO_ROOT / "backend" / "bin" / "apply_hosted_pending_candidates.py"
DATA_PLANE = REPO_ROOT / "backend" / "supabase" / "scripts" / "hosted_data_plane.py"
SUPABASE_REST = REPO_ROOT / "backend" / "utils" / "supabase_rest.py"

APPROVAL_ENV_NAME = "TZUDONG_HOSTED_DATA_PLANE_APPROVED"
APPLY_LATCH_NAME = "PIPELINE_HOSTED_APPLY_ENABLED"
FORBIDDEN_ENABLE_KEYS = frozenset({APPROVAL_ENV_NAME, APPLY_LATCH_NAME})

# Constants whose value is the approval env-var name; a write keyed by one of
# these names is treated as a write to the approval env var itself.
_APPROVAL_ENV_ALIASES = frozenset({"APPROVAL_ENV"})


def _parse(path: Path) -> ast.Module:
    return ast.parse(path.read_text(encoding="utf-8"), filename=str(path))


def _find_function(tree: ast.AST, name: str) -> ast.FunctionDef | None:
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return node
    return None


def _calls_to(func: ast.AST, callee: str) -> list[ast.Call]:
    """Return every ``callee(...)`` call node (callee referenced by bare name)."""
    found: list[ast.Call] = []
    for node in ast.walk(func):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == callee
        ):
            found.append(node)
    return found


def _is_dry_run_apply_binop(arg: ast.AST) -> bool:
    """True for ``apply_cmd + [... "--dry-run" ...]`` expressions."""
    if not (isinstance(arg, ast.BinOp) and isinstance(arg.op, ast.Add)):
        return False
    if not (isinstance(arg.left, ast.Name) and arg.left.id == "apply_cmd"):
        return False
    if not isinstance(arg.right, (ast.List, ast.Tuple)):
        return False
    literals = [
        elt.value
        for elt in arg.right.elts
        if isinstance(elt, ast.Constant) and isinstance(elt.value, str)
    ]
    return "--dry-run" in literals


def _subscript_key(slice_node: ast.AST) -> str | None:
    """Resolve the string key of a subscript target (py3.8 Index and py3.9+)."""
    node = slice_node
    if isinstance(node, ast.Index):  # pragma: no cover - py3.8 compatibility
        node = node.value
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.Name):
        return node.id
    return None


def _is_process_environ(node: ast.AST) -> bool:
    """True for ``os.environ`` or a bare ``environ`` (the process environment)."""
    if (
        isinstance(node, ast.Attribute)
        and node.attr == "environ"
        and isinstance(node.value, ast.Name)
        and node.value.id == "os"
    ):
        return True
    return isinstance(node, ast.Name) and node.id == "environ"


def _normalize_key(key: str | None) -> str | None:
    if key in _APPROVAL_ENV_ALIASES:
        return APPROVAL_ENV_NAME
    return key


def _environ_writes(tree: ast.AST) -> list[tuple[str, int]]:
    """Return (key, lineno) for every write into the process environment."""
    writes: list[tuple[str, int]] = []

    def record(key: str | None, lineno: int) -> None:
        norm = _normalize_key(key)
        if norm is not None:
            writes.append((norm, lineno))

    for node in ast.walk(tree):
        # os.environ["KEY"] = ...  /  os.environ["KEY"] += ...  /  annotated
        targets: list[ast.AST] = []
        if isinstance(node, ast.Assign):
            targets = list(node.targets)
        elif isinstance(node, (ast.AugAssign, ast.AnnAssign)):
            targets = [node.target]
        for target in targets:
            if isinstance(target, ast.Subscript) and _is_process_environ(target.value):
                record(_subscript_key(target.slice), node.lineno)

        # os.environ.update({...}) / .setdefault("KEY", ...) / .__setitem__("KEY", ...)
        # and os.putenv("KEY", ...)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            attr = node.func.attr
            if attr in {"update", "setdefault", "__setitem__"} and _is_process_environ(
                node.func.value
            ):
                if attr == "update":
                    for arg in node.args:
                        if isinstance(arg, ast.Dict):
                            for dict_key in arg.keys:
                                if isinstance(dict_key, ast.Constant) and isinstance(
                                    dict_key.value, str
                                ):
                                    record(dict_key.value, node.lineno)
                                elif isinstance(dict_key, ast.Name):
                                    record(dict_key.id, node.lineno)
                elif node.args:
                    first = node.args[0]
                    if isinstance(first, ast.Constant) and isinstance(first.value, str):
                        record(first.value, node.lineno)
                    elif isinstance(first, ast.Name):
                        record(first.id, node.lineno)
            elif (
                attr == "putenv"
                and isinstance(node.func.value, ast.Name)
                and node.func.value.id == "os"
                and node.args
            ):
                first = node.args[0]
                if isinstance(first, ast.Constant) and isinstance(first.value, str):
                    record(first.value, node.lineno)

    return writes


class MacEntrypointDryRunPrecedesLiveTest(unittest.TestCase):
    """R3.5: the Mac entrypoint previews (dry-run) before any live apply."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.tree = _parse(ENTRYPOINT)
        cls.main = _find_function(cls.tree, "main")

    def test_entrypoint_main_is_present(self) -> None:
        self.assertIsNotNone(
            self.main, msg=f"main() not found in {ENTRYPOINT}"
        )

    def test_schedule_and_env_preflights_precede_pipeline_work(self) -> None:
        calls = [node for node in ast.walk(self.main) if isinstance(node, ast.Call)]
        cadence_calls = [
            node
            for node in calls
            if isinstance(node.func, ast.Name)
            and node.func.id == "cadence_source_preflight"
        ]
        env_calls = [
            node
            for node in calls
            if isinstance(node.func, ast.Name)
            and node.func.id == "env_contract_preflight"
        ]
        run_calls = _calls_to(self.main, "_run")
        self.assertEqual(len(cadence_calls), 1)
        self.assertEqual(len(env_calls), 1)
        self.assertTrue(run_calls)
        self.assertLess(cadence_calls[0].lineno, min(call.lineno for call in run_calls))
        self.assertLess(env_calls[0].lineno, min(call.lineno for call in run_calls))
        self.assertEqual(
            ast.literal_eval(env_calls[0].args[0]), "hosted-pending-apply"
        )

    def test_dry_run_preview_precedes_live_apply(self) -> None:
        # The live apply in the unattended path is the call whose result is bound
        # to ``apply_exit``; the dry-run preview is ``_run(apply_cmd + [..])``.
        live_linenos: list[int] = []
        for node in ast.walk(self.main):
            if isinstance(node, ast.Assign):
                if any(
                    isinstance(t, ast.Name) and t.id == "apply_exit"
                    for t in node.targets
                ) and isinstance(node.value, ast.Call):
                    live_linenos.append(node.lineno)
        self.assertEqual(
            len(live_linenos),
            1,
            msg="expected exactly one live apply bound to `apply_exit`",
        )
        live_lineno = live_linenos[0]

        dry_preview_linenos = [
            call.lineno
            for call in _calls_to(self.main, "_run")
            if call.args and _is_dry_run_apply_binop(call.args[0])
        ]
        self.assertEqual(
            len(dry_preview_linenos),
            1,
            msg=(
                "expected exactly one dry-run apply preview "
                "`_run(apply_cmd + [\"--dry-run\"])` before the live apply (R3.5)"
            ),
        )
        self.assertLess(
            dry_preview_linenos[0],
            live_lineno,
            msg=(
                "the dry-run apply preview must precede the live apply in the "
                "unattended run path (R3.5)"
            ),
        )

    def test_explicit_dry_run_branch_never_reaches_a_live_apply(self) -> None:
        # The `--dry-run` branch must append `--dry-run` to apply_cmd and return
        # before any live apply, so an operator-forced dry run cannot write.
        dry_run_ifs: list[ast.If] = []
        for node in ast.walk(self.main):
            if isinstance(node, ast.If) and "args.dry_run" in ast.unparse(node.test):
                dry_run_ifs.append(node)
        self.assertTrue(
            dry_run_ifs,
            msg="entrypoint must special-case an explicit --dry-run branch",
        )
        branch = dry_run_ifs[0]
        branch_src = ast.unparse(ast.Module(body=branch.body, type_ignores=[]))
        self.assertIn(
            "--dry-run",
            branch_src,
            msg="the --dry-run branch must append --dry-run to the apply command",
        )
        self.assertTrue(
            any(isinstance(stmt, ast.Return) for stmt in branch.body),
            msg="the --dry-run branch must return before any live apply (R3.5)",
        )


class ApplyScriptPreviewGatesLiveApplyTest(unittest.TestCase):
    """R3.5: the apply script always builds a preview before the live apply."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.tree = _parse(APPLY_SCRIPT)
        cls.main = _find_function(cls.tree, "main")

    def test_apply_script_main_is_present(self) -> None:
        self.assertIsNotNone(
            self.main, msg=f"main() not found in {APPLY_SCRIPT}"
        )

    def test_build_preview_precedes_apply_pending_candidates(self) -> None:
        preview_calls = _calls_to(self.main, "build_apply_preview")
        apply_calls = _calls_to(self.main, "apply_pending_candidates")
        self.assertEqual(
            len(preview_calls),
            1,
            msg="apply script must build exactly one apply preview",
        )
        self.assertEqual(
            len(apply_calls),
            1,
            msg="apply script must call apply_pending_candidates exactly once",
        )
        self.assertLess(
            preview_calls[0].lineno,
            apply_calls[0].lineno,
            msg=(
                "build_apply_preview must precede apply_pending_candidates so a "
                "dry-run preview is always computed before any live write (R3.5)"
            ),
        )

    def test_live_apply_is_gated_behind_dry_run_short_circuit(self) -> None:
        apply_calls = _calls_to(self.main, "apply_pending_candidates")
        self.assertEqual(len(apply_calls), 1)
        apply_lineno = apply_calls[0].lineno

        # A guard `if args.dry_run or ...: ... return` must appear before the
        # live apply so dry-run (and the zero-candidate case) short-circuits.
        guarded = False
        for node in ast.walk(self.main):
            if not isinstance(node, ast.If) or node.lineno >= apply_lineno:
                continue
            if "dry_run" not in ast.unparse(node.test):
                continue
            if any(isinstance(stmt, ast.Return) for stmt in node.body):
                guarded = True
                break
        self.assertTrue(
            guarded,
            msg=(
                "the live apply must be gated behind an `if args.dry_run ...: "
                "return` short-circuit that precedes it (R3.5)"
            ),
        )


class NoAutoEnableDuringUnattendedRunTest(unittest.TestCase):
    """R3.6: the entrypoint/apply path never auto-enables the hosted-apply latch."""

    def test_entrypoint_and_apply_path_never_write_enable_keys(self) -> None:
        for path in (ENTRYPOINT, APPLY_SCRIPT, DATA_PLANE):
            with self.subTest(source=path.name):
                writes = _environ_writes(_parse(path))
                offending = [
                    (key, lineno)
                    for key, lineno in writes
                    if key in FORBIDDEN_ENABLE_KEYS
                ]
                self.assertEqual(
                    offending,
                    [],
                    msg=(
                        f"{path.name} must not write {sorted(FORBIDDEN_ENABLE_KEYS)} "
                        f"into the process environment during a run (R3.6); found "
                        f"{offending}"
                    ),
                )

    def test_entrypoint_only_writes_benign_runtime_env_keys(self) -> None:
        # Positive anchor: the entrypoint DOES write process env (PYTHON_CMD /
        # PYTHONPATH), so the negative assertion above is meaningful rather than
        # vacuous. Confirm every write it makes is a benign runtime-layout key.
        writes = _environ_writes(_parse(ENTRYPOINT))
        self.assertTrue(
            writes, msg="expected the entrypoint to write some runtime env keys"
        )
        allowed = {"PYTHON_CMD", "PYTHONPATH"}
        unexpected = sorted({key for key, _ in writes} - allowed)
        self.assertEqual(
            unexpected,
            [],
            msg=(
                "entrypoint should only write benign runtime-layout env keys "
                f"{sorted(allowed)}; found unexpected {unexpected}"
            ),
        )

    def test_approval_env_constant_matches_expected_name(self) -> None:
        # Anchor the approval-env alias used above to the planner's constant so
        # this test tracks any rename of the approval env var.
        tree = _parse(DATA_PLANE)
        value: str | None = None
        for node in ast.walk(tree):
            if isinstance(node, ast.Assign) and any(
                isinstance(t, ast.Name) and t.id == "APPROVAL_ENV"
                for t in node.targets
            ):
                if isinstance(node.value, ast.Constant) and isinstance(
                    node.value.value, str
                ):
                    value = node.value.value
        self.assertEqual(
            value,
            APPROVAL_ENV_NAME,
            msg="APPROVAL_ENV in hosted_data_plane.py must name the approval env var",
        )


class HostedApplyLatchStaysFalseConstantTest(unittest.TestCase):
    """R3.6: PIPELINE_HOSTED_APPLY_ENABLED is a compile-time False constant."""

    def test_latch_is_module_level_false_and_never_set_truthy(self) -> None:
        tree = _parse(SUPABASE_REST)
        module_assignments: list[ast.Constant] = []
        for node in tree.body:
            if isinstance(node, ast.Assign) and any(
                isinstance(t, ast.Name) and t.id == APPLY_LATCH_NAME
                for t in node.targets
            ):
                self.assertIsInstance(
                    node.value,
                    ast.Constant,
                    msg=f"{APPLY_LATCH_NAME} must be a literal constant",
                )
                module_assignments.append(node.value)

        self.assertEqual(
            len(module_assignments),
            1,
            msg=f"{APPLY_LATCH_NAME} must be assigned exactly once at module level",
        )
        self.assertIs(
            module_assignments[0].value,
            False,
            msg=f"{APPLY_LATCH_NAME} must be the compile-time constant False (R3.6)",
        )

        # No assignment anywhere reassigns the latch to a truthy value.
        for node in ast.walk(tree):
            if isinstance(node, ast.Assign) and any(
                isinstance(t, ast.Name) and t.id == APPLY_LATCH_NAME
                for t in node.targets
            ):
                self.assertFalse(
                    isinstance(node.value, ast.Constant)
                    and bool(node.value.value) is True,
                    msg=f"{APPLY_LATCH_NAME} must never be reassigned to True",
                )


if __name__ == "__main__":
    unittest.main()
