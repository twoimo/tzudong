#!/usr/bin/env python3
"""Layout_Manifest checker for the platform-modernization spec (Requirement 6).

This is the ``C3. Layout_Manifest`` checker from the design (section C3, data
model D4). It validates ``backend/layout-manifest.v1.json`` against the current
candidate tree and enforces the repository's current split between the
hyphenated operational-asset directory (``backend/pipeline-control``), the
importable Python package (``backend/pipeline_control``), and deployment
ledgers/IaC (``backend/deploy``).  It does not prescribe a directory move.

It performs six fail-closed checks, each returning a bounded fixed code and no
Forbidden_Log_Field:

1. **Entry shape / required content** (Requirements 6.1, 6.2, 6.8) ->
   ``layout_manifest_entry_invalid``. Every entry carries a non-empty ownership,
   at least one allowed and one forbidden content, and exactly one
   classification of ``source`` / ``build_artifact`` / ``local_ephemeral``.
   ``build_artifact`` and ``local_ephemeral`` entries also record a boolean
   ``vcsTracked`` (VCS-tracked-exclusion); ``source`` entries are ``vcsTracked``
   true. The ``apps/web`` entry is owned by the Web_App boundary and forbids the
   five long-running ownerships (crawler, ffmpeg, Gemini bulk, GDrive bulk, long
   Supabase batch insert); the ``backend`` entry is owned by Backend_Runtime.

2. **Bidirectional tree<->manifest correspondence** (Requirement 6.9) ->
   ``layout_manifest_missing_entry``. Every git-tracked in-scope 1st/2nd-level
   directory has exactly one ``source`` entry and vice versa; every
   ``vcsTracked=false`` entry is confirmed NOT git-tracked.

3. **Directory ownership** (Requirement 6.11) ->
   ``directory_ownership_violation``. No importable python module under
   ``backend/deploy/``; no container/config asset (Dockerfile, docker-compose*,
   collector/dashboard config yaml, metrics/events catalogs) under
   ``backend/pipeline_control/``.

4. **Directory-move residual path** (Requirement 6.4) ->
   ``directory_move_residual_path``. For a declared move the before-path
   tracked-match count must be 0 and the after-path count exactly 1.

5. **Alias / compat symlink** (Requirement 6.5) -> ``alias_path_not_admitted``.
   No alias directory or compatibility symlink for a moved-from path, and no
   directory symlink at depth 1-2 within the in-scope tree.

6. **Stale path reference** (Requirements 6.7, 6.10) -> ``stale_path_reference``.
   ``.github/workflows/``, ``.github/dependabot.yml``, moved-tree
   ``docker-compose*.yml`` relative volume sources, and
   ``backend/config/channels.yaml`` are scanned for references broken by a move;
   one or more unresolved references returns the code.

``backend/bin`` scripts are standalone (no ``__init__.py``); this module is
loaded by path by its tests. Git enumeration, the tree root, and the manifest
path are injectable so the checks are unit-testable with no live git state.
"""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping, Sequence

# ---------------------------------------------------------------------------
# Bounded fixed codes (design C3 / error-code table). ``None`` means accepted.
# ---------------------------------------------------------------------------

LAYOUT_MANIFEST_ENTRY_INVALID = "layout_manifest_entry_invalid"  # 6.1, 6.2, 6.8
LAYOUT_MANIFEST_MISSING_ENTRY = "layout_manifest_missing_entry"  # 6.9
DIRECTORY_OWNERSHIP_VIOLATION = "directory_ownership_violation"  # 6.11
DIRECTORY_MOVE_RESIDUAL_PATH = "directory_move_residual_path"  # 6.4
ALIAS_PATH_NOT_ADMITTED = "alias_path_not_admitted"  # 6.5
STALE_PATH_REFERENCE = "stale_path_reference"  # 6.7, 6.10

# The full closed set this checker may return. Any other value is a defect.
LAYOUT_CHECK_RESULT_CODES = frozenset(
    {
        None,
        LAYOUT_MANIFEST_ENTRY_INVALID,
        LAYOUT_MANIFEST_MISSING_ENTRY,
        DIRECTORY_OWNERSHIP_VIOLATION,
        DIRECTORY_MOVE_RESIDUAL_PATH,
        ALIAS_PATH_NOT_ADMITTED,
        STALE_PATH_REFERENCE,
    }
)

# The order in which an aggregate run surfaces the first blocking code.
_CODE_PRECEDENCE = (
    LAYOUT_MANIFEST_ENTRY_INVALID,
    LAYOUT_MANIFEST_MISSING_ENTRY,
    DIRECTORY_OWNERSHIP_VIOLATION,
    ALIAS_PATH_NOT_ADMITTED,
    DIRECTORY_MOVE_RESIDUAL_PATH,
    STALE_PATH_REFERENCE,
)

# ---------------------------------------------------------------------------
# Frozen constants (design C3 / D4).
# ---------------------------------------------------------------------------

# Repo layout: backend/bin/check_layout_manifest.py -> bin -> backend -> <root>.
_ROOT = Path(__file__).resolve().parents[2]
_DEFAULT_MANIFEST_PATH = _ROOT / "backend" / "layout-manifest.v1.json"

# Dotfile / tooling / spec directories that are outside the manifest's tracked
# scope even when git happens to track files inside them.
EXCLUDED_TOP_LEVEL = frozenset(
    {".git", ".venv", ".hypothesis", ".cursor", ".kiro", ".local-archive"}
)

VALID_CLASSIFICATIONS = frozenset({"source", "build_artifact", "local_ephemeral"})
_NON_SOURCE_CLASSIFICATIONS = frozenset({"build_artifact", "local_ephemeral"})

# Ownership / forbidden-content requirements Requirement 6.2 pins by path.
_WEB_APP_OWNERSHIP_TOKEN = "Web_App"
_BACKEND_OWNERSHIP_TOKEN = "Backend_Runtime"
# Substrings that must each appear in some forbidden entry of ``apps/web``.
_WEB_FORBIDDEN_TOKENS = ("크롤러", "ffmpeg", "Gemini", "GDrive", "Supabase")

# Ownership guard (Requirement 6.11).
_DEPLOY_DIR = "backend/deploy"
_PIPELINE_CONTROL_DIR = "backend/pipeline_control"
# Container/config asset filename markers forbidden under pipeline_control/.
_CONTAINER_CONFIG_MARKERS = (
    "dockerfile",
    "docker-compose",
    "otel-collector",
    "prometheus.yml",
    "metrics.v1.json",
    "events.v1.json",
)
_CONTAINER_CONFIG_DIR_MARKERS = ("grafana",)

# No directory move is approved in the current architecture. Callers may inject
# an explicit proposed move to validate it without mutating the tree.
DEFAULT_MOVES: tuple[tuple[str, str], ...] = ()

# Scan targets for stale references (Requirement 6.7). Compose scanning is
# scoped to the moved deploy tree, where a move could have broken a relative
# volume path; unrelated stack compose files are not runtime-move references.
_WORKFLOWS_DIR = ".github/workflows"
_DEPENDABOT_FILE = ".github/dependabot.yml"
_CHANNELS_FILE = "backend/config/channels.yaml"
_COMPOSE_SCAN_DIRS = ("backend/pipeline-control", "backend/deploy")

_DEPENDABOT_DIRECTORY_RE = re.compile(r"""directory:\s*["']?(/[^"'\s]+)["']?""")
_COMPOSE_RELATIVE_VOLUME_RE = re.compile(r"""^\s*-\s*(\.\.?/[^:\s]+):""")


# ---------------------------------------------------------------------------
# Pure result helper (mirrors backend/bin + pipeline_control convention).
# ---------------------------------------------------------------------------


def _result(ok: bool, error_code: Any, **extra: Any) -> dict:
    out: dict = {"ok": ok, "errorCode": error_code}
    out.update(extra)
    return out


# A git-file enumerator returns POSIX-relative tracked file paths.
GitEnumerator = Callable[[Path], "list[str]"]


def _default_git_enumerator(root: Path) -> list[str]:
    """Return versioned and candidate file paths as POSIX-relative paths.

    Only the file path list reaches the checks; no other git state is read. A
    git failure returns an empty list, which the correspondence check treats as
    "nothing tracked" and fails closed against a non-empty manifest.
    """

    try:
        completed = subprocess.run(
            ["git", "ls-files", "--cached", "--others", "--exclude-standard"],
            cwd=str(root),
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            check=False,
            text=True,
        )
    except Exception:  # noqa: BLE001 - a missing git must read as "nothing tracked"
        return []
    if completed.returncode != 0:
        return []
    return [line for line in (completed.stdout or "").splitlines() if line]


def load_manifest(path: str | Path = _DEFAULT_MANIFEST_PATH) -> dict:
    """Load and JSON-parse the Layout_Manifest at ``path``."""

    return json.loads(Path(path).read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# Tracked-directory enumeration (design C3; git ls-files scope).
# ---------------------------------------------------------------------------


def tracked_directories(
    tracked_files: Iterable[str],
    *,
    excluded_top: Iterable[str] = EXCLUDED_TOP_LEVEL,
) -> set[str]:
    """Derive the in-scope 1st- and 2nd-level tracked directories.

    A file ``a/b/c`` contributes the 1st-level dir ``a`` and the 2nd-level dir
    ``a/b``; a file ``a/b`` (a file directly under ``a``) contributes only the
    1st-level dir ``a``. Top-level files contribute nothing. Directories whose
    top-level segment is in ``excluded_top`` are dropped so dotfile / tooling /
    spec trees never enter the manifest scope.
    """

    excluded = set(excluded_top)
    dirs: set[str] = set()
    for raw in tracked_files:
        path = raw.strip().replace("\\", "/")
        if not path:
            continue
        parts = path.split("/")
        if len(parts) < 2:
            continue  # a top-level file, not a directory
        top = parts[0]
        if top in excluded:
            continue
        dirs.add(top)
        if len(parts) >= 3:
            dirs.add(f"{top}/{parts[1]}")
    return dirs


# ---------------------------------------------------------------------------
# Check 1: entry shape / required content (6.1, 6.2, 6.8).
# ---------------------------------------------------------------------------


def _nonempty_str(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _nonempty_str_list(value: Any) -> bool:
    return (
        isinstance(value, list)
        and len(value) >= 1
        and all(_nonempty_str(item) for item in value)
    )


def validate_entries(manifest: Mapping[str, Any]) -> dict:
    """Validate manifest entry shape and Requirement 6.2 pinned content.

    Returns ``layout_manifest_entry_invalid`` with a bounded issue list when any
    entry is missing a non-empty ownership, lacks at least one allowed or one
    forbidden content, carries a classification outside the closed set, records
    a non-boolean ``vcsTracked`` for a non-source entry (or a source entry that
    is not ``vcsTracked`` true), duplicates a path, or when the ``apps/web`` /
    ``backend`` ownership and the ``apps/web`` forbidden set do not match 6.2.
    """

    issues: list[dict] = []
    entries = manifest.get("entries")
    if not isinstance(entries, list) or not entries:
        return _result(
            False, LAYOUT_MANIFEST_ENTRY_INVALID, issues=[{"kind": "entries_missing"}]
        )

    seen_paths: set[str] = set()
    by_path: dict[str, Mapping[str, Any]] = {}
    for index, entry in enumerate(entries):
        if not isinstance(entry, Mapping):
            issues.append({"kind": "entry_not_object", "index": index})
            continue
        path = entry.get("path")
        if not _nonempty_str(path):
            issues.append({"kind": "path_missing", "index": index})
            continue
        if path in seen_paths:
            issues.append({"kind": "duplicate_path", "path": path})
        seen_paths.add(path)
        by_path[path] = entry

        if not _nonempty_str(entry.get("ownership")):
            issues.append({"kind": "ownership_empty", "path": path})
        if not _nonempty_str_list(entry.get("allowedContents")):
            issues.append({"kind": "allowed_contents_empty", "path": path})
        if not _nonempty_str_list(entry.get("forbiddenContents")):
            issues.append({"kind": "forbidden_contents_empty", "path": path})

        classification = entry.get("classification")
        if classification not in VALID_CLASSIFICATIONS:
            issues.append({"kind": "classification_invalid", "path": path})
        else:
            vcs = entry.get("vcsTracked")
            if not isinstance(vcs, bool):
                issues.append({"kind": "vcs_tracked_not_bool", "path": path})
            elif classification == "source" and vcs is not True:
                issues.append({"kind": "source_not_vcs_tracked", "path": path})
            elif classification in _NON_SOURCE_CLASSIFICATIONS and vcs is not False:
                issues.append({"kind": "excluded_not_vcs_excluded", "path": path})

    # Requirement 6.2: pinned ownership and forbidden content.
    web = by_path.get("apps/web")
    if web is None:
        issues.append({"kind": "apps_web_entry_missing"})
    else:
        if _WEB_APP_OWNERSHIP_TOKEN not in str(web.get("ownership", "")):
            issues.append({"kind": "apps_web_ownership_not_web_app"})
        forbidden_text = " ".join(
            str(x) for x in (web.get("forbiddenContents") or [])
        )
        missing_tokens = [t for t in _WEB_FORBIDDEN_TOKENS if t not in forbidden_text]
        if missing_tokens:
            issues.append(
                {"kind": "apps_web_forbidden_incomplete", "missing": missing_tokens}
            )

    backend = by_path.get("backend")
    if backend is None:
        issues.append({"kind": "backend_entry_missing"})
    elif _BACKEND_OWNERSHIP_TOKEN not in str(backend.get("ownership", "")):
        issues.append({"kind": "backend_ownership_not_backend_runtime"})

    if issues:
        return _result(False, LAYOUT_MANIFEST_ENTRY_INVALID, issues=issues)
    return _result(True, None, issues=[])


# ---------------------------------------------------------------------------
# Check 2: bidirectional correspondence (6.9).
# ---------------------------------------------------------------------------


def check_correspondence(
    manifest: Mapping[str, Any],
    tracked_dirs: set[str],
) -> dict:
    """Assert bidirectional tree<->manifest correspondence (Requirement 6.9).

    Missing either way -> ``layout_manifest_missing_entry`` with a bounded list
    of ``{direction, path}`` descriptors:

      * ``tree_without_entry`` — a git-tracked in-scope directory with no
        ``source`` manifest entry.
      * ``entry_without_tree`` — a ``source`` manifest entry whose directory is
        not git-tracked.
      * ``excluded_entry_tracked`` — a ``vcsTracked=false`` entry whose path is
        git-tracked, contradicting its VCS-tracked-exclusion.
    """

    entries = manifest.get("entries") or []
    source_paths: set[str] = set()
    excluded_paths: set[str] = set()
    for entry in entries:
        if not isinstance(entry, Mapping):
            continue
        path = entry.get("path")
        if not _nonempty_str(path):
            continue
        classification = entry.get("classification")
        if classification == "source":
            source_paths.add(path)
        elif classification in _NON_SOURCE_CLASSIFICATIONS:
            excluded_paths.add(path)

    missing: list[dict] = []
    for directory in sorted(tracked_dirs - source_paths):
        missing.append({"direction": "tree_without_entry", "path": directory})
    for path in sorted(source_paths - tracked_dirs):
        missing.append({"direction": "entry_without_tree", "path": path})
    for path in sorted(excluded_paths & tracked_dirs):
        missing.append({"direction": "excluded_entry_tracked", "path": path})

    if missing:
        return _result(False, LAYOUT_MANIFEST_MISSING_ENTRY, missing=missing)
    return _result(True, None, missing=[])


# ---------------------------------------------------------------------------
# Check 3: directory ownership (6.11).
# ---------------------------------------------------------------------------


def check_directory_ownership(tracked_files: Iterable[str]) -> dict:
    """Enforce the deploy / pipeline_control ownership split (Requirement 6.11).

    A tracked ``*.py`` under ``backend/deploy/`` (an importable python module in
    the operational-artifacts path) or a tracked container/config asset under
    ``backend/pipeline_control/`` (Dockerfile, docker-compose*, collector /
    dashboard config, metrics/events catalog) returns
    ``directory_ownership_violation`` with a bounded offender list.
    """

    violations: list[dict] = []
    deploy_prefix = f"{_DEPLOY_DIR}/"
    control_prefix = f"{_PIPELINE_CONTROL_DIR}/"

    for raw in tracked_files:
        path = raw.strip().replace("\\", "/")
        if not path:
            continue
        lower = path.lower()

        if path.startswith(deploy_prefix) and lower.endswith(".py"):
            violations.append({"kind": "python_module_under_deploy", "path": path})

        if path.startswith(control_prefix):
            tail = path[len(control_prefix):].lower()
            filename = tail.rsplit("/", 1)[-1]
            if any(marker in filename for marker in _CONTAINER_CONFIG_MARKERS):
                violations.append(
                    {"kind": "container_config_under_pipeline_control", "path": path}
                )
            elif any(seg in _CONTAINER_CONFIG_DIR_MARKERS for seg in tail.split("/")):
                violations.append(
                    {"kind": "container_config_under_pipeline_control", "path": path}
                )

    if violations:
        return _result(False, DIRECTORY_OWNERSHIP_VIOLATION, violations=violations)
    return _result(True, None, violations=[])


# ---------------------------------------------------------------------------
# Check 4: directory-move residual path (6.4).
# ---------------------------------------------------------------------------


def _is_tracked_dir(tracked_files: Iterable[str], path: str) -> bool:
    """True iff any tracked file lives under ``path`` (a directory of any depth).

    A directory path is unique in the tree, so this yields a match count of 0
    or 1 for Requirement 6.4's before/after path comparison.
    """

    prefix = path.rstrip("/") + "/"
    for raw in tracked_files:
        normalized = raw.strip().replace("\\", "/")
        if normalized.startswith(prefix):
            return True
    return False


def check_directory_move(
    before_path: str,
    after_path: str,
    tracked_files: Iterable[str],
) -> dict:
    """Assert a declared move left no residual path (Requirement 6.4).

    The before-path tracked-match count must be 0 and the after-path count
    exactly 1; otherwise ``directory_move_residual_path`` with the two counts.
    Matches are counted over the whole tracked tree so a move at any depth (for
    example ``backend/deploy/pipeline-control``) is evaluated correctly.
    """

    materialized = list(tracked_files)
    before_count = 1 if _is_tracked_dir(materialized, before_path) else 0
    after_count = 1 if _is_tracked_dir(materialized, after_path) else 0
    if before_count != 0 or after_count != 1:
        return _result(
            False,
            DIRECTORY_MOVE_RESIDUAL_PATH,
            beforePath=before_path,
            afterPath=after_path,
            beforeMatchCount=before_count,
            afterMatchCount=after_count,
        )
    return _result(
        True,
        None,
        beforePath=before_path,
        afterPath=after_path,
        beforeMatchCount=before_count,
        afterMatchCount=after_count,
    )


# ---------------------------------------------------------------------------
# Check 5: alias / compat symlink (6.5).
# ---------------------------------------------------------------------------


def check_alias_paths(
    root: Path,
    *,
    moves: Sequence[tuple[str, str]] = DEFAULT_MOVES,
    top_level: Iterable[str] = (".github", "apps", "backend", "docs", "scripts"),
) -> dict:
    """Reject alias directories and compatibility symlinks (Requirement 6.5).

    Returns ``alias_path_not_admitted`` when a moved-from path still exists as a
    symlink or an alias directory, or when any directory symlink is present at
    depth 1-2 within the in-scope top-level trees.
    """

    offenders: list[dict] = []

    for before_path, _after in moves:
        candidate = root / before_path
        if candidate.is_symlink():
            offenders.append({"kind": "moved_from_symlink", "path": before_path})
        elif candidate.exists():
            offenders.append({"kind": "moved_from_alias_dir", "path": before_path})

    for top in top_level:
        top_dir = root / top
        if not top_dir.is_dir():
            continue
        try:
            first_level = list(top_dir.iterdir())
        except OSError:
            continue
        for child in first_level:
            rel1 = f"{top}/{child.name}"
            if child.is_symlink() and child.is_dir():
                offenders.append({"kind": "directory_symlink", "path": rel1})
                continue
            if child.is_dir():
                try:
                    for grandchild in child.iterdir():
                        if grandchild.is_symlink() and grandchild.is_dir():
                            offenders.append(
                                {
                                    "kind": "directory_symlink",
                                    "path": f"{rel1}/{grandchild.name}",
                                }
                            )
                except OSError:
                    continue

    if offenders:
        return _result(False, ALIAS_PATH_NOT_ADMITTED, offenders=offenders)
    return _result(True, None, offenders=[])


# ---------------------------------------------------------------------------
# Check 6: stale path reference (6.7, 6.10).
# ---------------------------------------------------------------------------


def _collect_scan_targets(root: Path) -> list[Path]:
    """Collect the Requirement 6.7 scan-target files that exist on disk."""

    targets: list[Path] = []
    workflows = root / _WORKFLOWS_DIR
    if workflows.is_dir():
        targets.extend(sorted(p for p in workflows.iterdir() if p.is_file()))
    for rel in (_DEPENDABOT_FILE, _CHANNELS_FILE):
        candidate = root / rel
        if candidate.is_file():
            targets.append(candidate)
    for compose_rel in _COMPOSE_SCAN_DIRS:
        compose_dir = root / compose_rel
        if compose_dir.is_dir():
            targets.extend(
                sorted(
                    p
                    for p in compose_dir.rglob("docker-compose*.yml")
                    if p.is_file()
                )
            )
            targets.extend(
                sorted(
                    p
                    for p in compose_dir.rglob("docker-compose*.yaml")
                    if p.is_file()
                )
            )
    return targets


def scan_stale_references(
    root: Path,
    *,
    moves: Sequence[tuple[str, str]] = DEFAULT_MOVES,
    local_ephemeral_directories: Sequence[str] = (),
) -> dict:
    """Scan Requirement 6.7 targets for references broken by a move (6.7, 6.10).

    Three reference classes are resolved:

      * moved-from tokens — any literal occurrence of a moved-from path in a
        scan target (the reorganization should have rewritten it to the
        moved-to path);
      * dependabot ``directory:`` entries under ``/backend`` that do not resolve
        to an existing directory;
      * compose relative volume sources (``./`` / ``../``) that escape the
        repository or do not exist. Exact, manifest-declared local ephemeral
        directories may be absent in a clean checkout; files beneath them may
        not use that exception.

    One or more unresolved references returns ``stale_path_reference`` with a
    bounded reference list; the total count is always reported.
    """

    stale: list[dict] = []
    targets = _collect_scan_targets(root)
    canonical_root = root.resolve()
    ephemeral_paths: set[Path] = set()
    for relative in local_ephemeral_directories:
        candidate = Path(relative)
        if candidate.is_absolute() or ".." in candidate.parts or "\\" in relative:
            continue
        lexical_path = canonical_root / candidate
        if any(part.is_symlink() for part in (lexical_path, *lexical_path.parents)):
            continue
        try:
            resolved_path = lexical_path.resolve()
        except (OSError, RuntimeError, ValueError):
            continue
        if resolved_path == lexical_path and lexical_path != canonical_root:
            ephemeral_paths.add(lexical_path)

    for target in targets:
        try:
            text = target.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        rel = target.relative_to(root).as_posix()

        for before_path, _after in moves:
            # ``moved_to`` does not contain ``moved_from`` as a substring (the
            # inserted path segment breaks it), so a literal hit is always stale.
            if before_path in text:
                stale.append(
                    {"kind": "moved_from_reference", "file": rel, "token": before_path}
                )

        if rel == _DEPENDABOT_FILE:
            for match in _DEPENDABOT_DIRECTORY_RE.finditer(text):
                directory = match.group(1)
                if not directory.startswith("/backend"):
                    continue
                resolved = root / directory.lstrip("/")
                if not resolved.is_dir():
                    stale.append(
                        {
                            "kind": "dependabot_directory_unresolved",
                            "file": rel,
                            "reference": directory,
                        }
                    )

        if target.name.startswith("docker-compose"):
            for line in text.splitlines():
                m = _COMPOSE_RELATIVE_VOLUME_RE.match(line)
                if not m:
                    continue
                source = m.group(1)
                try:
                    resolved = (target.parent / source).resolve()
                except (OSError, RuntimeError, ValueError):
                    resolved = None
                if resolved is None or not resolved.is_relative_to(canonical_root) or (
                    not resolved.exists() and resolved not in ephemeral_paths
                ):
                    stale.append(
                        {
                            "kind": "compose_volume_unresolved",
                            "file": rel,
                            "reference": source,
                        }
                    )

    if stale:
        return _result(
            False, STALE_PATH_REFERENCE, unresolvedCount=len(stale), unresolved=stale
        )
    return _result(True, None, unresolvedCount=0, unresolved=[])


# ---------------------------------------------------------------------------
# Aggregate run (design C3).
# ---------------------------------------------------------------------------


def run_check(
    *,
    root: str | Path = _ROOT,
    manifest_path: str | Path = _DEFAULT_MANIFEST_PATH,
    git_enumerator: GitEnumerator = _default_git_enumerator,
    moves: Sequence[tuple[str, str]] = DEFAULT_MOVES,
) -> dict:
    """Run every Layout_Manifest check and return one bounded artifact.

    The aggregate ``ok`` is true only when every check passes; ``errorCode`` is
    the first failing code by ``_CODE_PRECEDENCE``. Each check's bounded result
    is included under ``checks`` so a caller can see every dimension. No
    Forbidden_Log_Field is emitted: only paths, counts, and fixed codes.
    """

    root_path = Path(root)
    manifest = load_manifest(manifest_path)
    tracked_files = git_enumerator(root_path)
    tracked_dirs = tracked_directories(tracked_files)

    entry_check = validate_entries(manifest)
    correspondence = check_correspondence(manifest, tracked_dirs)
    ownership = check_directory_ownership(tracked_files)
    alias = check_alias_paths(root_path, moves=moves)
    local_ephemeral_directories = (
        tuple(
            entry["path"]
            for entry in manifest["entries"]
            if entry["classification"] == "local_ephemeral"
            and entry["vcsTracked"] is False
        )
        if entry_check["ok"]
        else ()
    )
    stale = scan_stale_references(
        root_path, moves=moves, local_ephemeral_directories=local_ephemeral_directories
    )

    move_checks = [
        check_directory_move(before, after, tracked_files) for before, after in moves
    ]
    move_ok = all(m["ok"] for m in move_checks)

    checks = {
        "entries": entry_check,
        "correspondence": correspondence,
        "ownership": ownership,
        "alias": alias,
        "moves": move_checks,
        "staleReferences": stale,
    }

    outcomes = {
        LAYOUT_MANIFEST_ENTRY_INVALID: entry_check["ok"],
        LAYOUT_MANIFEST_MISSING_ENTRY: correspondence["ok"],
        DIRECTORY_OWNERSHIP_VIOLATION: ownership["ok"],
        ALIAS_PATH_NOT_ADMITTED: alias["ok"],
        DIRECTORY_MOVE_RESIDUAL_PATH: move_ok,
        STALE_PATH_REFERENCE: stale["ok"],
    }

    error_code = None
    for code in _CODE_PRECEDENCE:
        if not outcomes[code]:
            error_code = code
            break

    return _result(
        error_code is None,
        error_code,
        trackedDirectoryCount=len(tracked_dirs),
        checks=checks,
    )


# ---------------------------------------------------------------------------
# CLI entry point.
# ---------------------------------------------------------------------------


def main(argv: Sequence[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(
        description="Layout_Manifest checker (platform-modernization Requirement 6).",
    )
    parser.add_argument(
        "--manifest",
        default=str(_DEFAULT_MANIFEST_PATH),
        help="Path to backend/layout-manifest.v1.json.",
    )
    parser.add_argument(
        "--root",
        default=str(_ROOT),
        help="Repository root used for git enumeration and path resolution.",
    )
    parser.add_argument(
        "--json", action="store_true", help="Print only machine-readable JSON."
    )
    args = parser.parse_args(list(argv) if argv is not None else None)

    result = run_check(root=args.root, manifest_path=args.manifest)

    if args.json:
        print(json.dumps(result, ensure_ascii=True, sort_keys=True))
    else:
        print(
            "layout-manifest ok={ok} code={code} trackedDirs={n}".format(
                ok=str(result["ok"]).lower(),
                code=result["errorCode"],
                n=result["trackedDirectoryCount"],
            )
        )
        if not result["ok"]:
            print(json.dumps(result["checks"], ensure_ascii=True, sort_keys=True))

    return 0 if result["ok"] else 1


if __name__ == "__main__":  # pragma: no cover - thin CLI shim
    raise SystemExit(main())
