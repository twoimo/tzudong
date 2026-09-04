"""Declarative numbered-script graph. Commands are fail-closed before start."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from string import Formatter
from typing import FrozenSet

REPO_ROOT = Path(__file__).resolve().parents[2]
MUTATING_CAPABILITY = "mutating_db"
HEAVY_CAPABILITY = "heavy_compute"
MAP_URL_CAPABILITY = "map_url"
FRAME_CAPTION_CAPABILITY = "frame_caption"
CHUNK_CAPABILITY = "chunk"
ALLOWED_INTERPRETERS = frozenset({"python3", "node", "bash"})
ALLOWED_PYTHON_NAMES = frozenset({"python3", "python3.exe"})
ALLOWED_TEMPLATES = frozenset({"target", "python", "max_videos"})
SKIP_HEAVY_REASON = "경량 모드(SKIP_HEAVY_COMPUTE) — 로컬 머신에서 실행"
DOWNSTREAM_OF_08 = "08-chunk"


class AdapterGraphError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class StepSpec:
    id: str
    canonical_name: str
    interpreter: str
    script: str
    extra_args: tuple[str, ...]
    capabilities: FrozenSet[str] = frozenset()
    channel_capabilities: FrozenSet[str] = frozenset()
    skip_when_lite: bool = False
    skip_after: str | None = None


STEP_SPECS: tuple[StepSpec, ...] = (
    StepSpec(
        "01-collect-urls",
        "Step 1 (URL Collection)",
        "python3",
        "backend/restaurant-crawling/scripts/01-collect-urls.py",
        ("--channel", "{target}"),
    ),
    StepSpec(
        "02-collect-meta",
        "Step 2 (Metadata)",
        "python3",
        "backend/restaurant-crawling/scripts/02-collect-meta.py",
        ("--channel", "{target}"),
    ),
    StepSpec(
        "02-1-migrate",
        "Step 2.1+2.5 (Migration+Cleanup)",
        "python3",
        "backend/restaurant-crawling/scripts/02-1-migrate-meta-to-supabase.py",
        ("--channel", "{target}"),
        frozenset({MUTATING_CAPABILITY}),
    ),
    StepSpec(
        "02-5-cleanup",
        "Step 2.1+2.5 (Migration+Cleanup)",
        "python3",
        "backend/restaurant-crawling/scripts/02-5-cleanup-orphans.py",
        ("--channel", "{target}"),
    ),
    StepSpec(
        "03-transcript",
        "Step 3 (Transcript)",
        "node",
        "backend/restaurant-crawling/scripts/03-collect-transcript.js",
        ("--channel", "{target}"),
    ),
    StepSpec(
        "03-1-context",
        "Step 3.1 (Context Generation)",
        "python3",
        "backend/restaurant-crawling/scripts/03-1-generate-transcript-context.py",
        ("--max-videos", "{max_videos}"),
    ),
    StepSpec(
        "03-2-visual",
        "Step 3.2 (Visual Location)",
        "python3",
        "backend/restaurant-crawling/scripts/03-2-visual-location.py",
        ("--channel", "{target}"),
        frozenset({HEAVY_CAPABILITY}),
        skip_when_lite=True,
    ),
    StepSpec(
        "04-frames",
        "Step 4 (Heatmap & Frames)",
        "node",
        "backend/restaurant-crawling/scripts/04-extract-frames-with-heatmap.js",
        ("--channel", "{target}", "--delete-cache"),
        frozenset({HEAVY_CAPABILITY}),
        skip_when_lite=True,
    ),
    StepSpec(
        "05-map-url",
        "Step 5 (Map URL Crawling)",
        "node",
        "backend/restaurant-crawling/scripts/05-map-url-crawling.js",
        ("--channel", "{target}"),
        frozenset({HEAVY_CAPABILITY}),
        frozenset({MAP_URL_CAPABILITY}),
        skip_when_lite=True,
    ),
    StepSpec(
        "06-frame-caption",
        "Step 6 (Frame Caption)",
        "python3",
        "backend/restaurant-crawling/scripts/06-frame-caption.py",
        ("--youtuber", "{target}"),
        frozenset({HEAVY_CAPABILITY}),
        frozenset({FRAME_CAPTION_CAPABILITY}),
        skip_when_lite=True,
        skip_after="04-frames",
    ),
    StepSpec(
        "06-1-enrich",
        "Step 6.1 (Enrich)",
        "python3",
        "backend/restaurant-crawling/scripts/06-1-transcript-document-with-meta.py",
        ("--channel", "{target}"),
    ),
    StepSpec(
        "08-chunk",
        "Step 08 (Chunk Multimodal)",
        "bash",
        "backend/restaurant-crawling/scripts/08-chunk-multimodal-crawling.sh",
        ("--channel", "{target}"),
        frozenset({HEAVY_CAPABILITY}),
        frozenset({CHUNK_CAPABILITY}),
        skip_when_lite=True,
    ),
    StepSpec(
        "09-target",
        "Step 09 (Target)",
        "python3",
        "backend/restaurant-evaluation/scripts/09-target-selection.py",
        (
            "--channel",
            "{target}",
            "--crawling-path",
            "backend/restaurant-crawling/data/{target}",
            "--evaluation-path",
            "backend/restaurant-evaluation/data/{target}",
        ),
        skip_after=DOWNSTREAM_OF_08,
    ),
    StepSpec(
        "10-rule",
        "Step 10 (Rule Eval)",
        "python3",
        "backend/restaurant-evaluation/scripts/10-rule-evaluation.py",
        (
            "--channel",
            "{target}",
            "--evaluation-path",
            "backend/restaurant-evaluation/data/{target}",
        ),
        skip_after="09-target",
    ),
    StepSpec(
        "11-laaj",
        "Step 11 (LAAJ Evaluation)",
        "bash",
        "backend/restaurant-evaluation/scripts/11-laaj-evaluation.sh",
        (
            "--channel",
            "{target}",
            "--crawling-path",
            "backend/restaurant-crawling/data/{target}",
            "--evaluation-path",
            "backend/restaurant-evaluation/data/{target}",
        ),
        skip_after="10-rule",
    ),
    StepSpec(
        "12-transform",
        "Step 12 (Transform)",
        "python3",
        "backend/restaurant-evaluation/scripts/12-transform.py",
        (
            "--channel",
            "{target}",
            "--crawling-path",
            "backend/restaurant-crawling/data/{target}",
            "--evaluation-path",
            "backend/restaurant-evaluation/data/{target}",
        ),
        skip_after="11-laaj",
    ),
    StepSpec(
        "13-supabase-insert",
        "Step 13 (Supabase)",
        "python3",
        "backend/restaurant-evaluation/scripts/13-supabase-insert.py",
        (
            "--channel",
            "{target}",
            "--evaluation-path",
            "backend/restaurant-evaluation/data/{target}",
        ),
        frozenset({MUTATING_CAPABILITY}),
        skip_after="12-transform",
    ),
    StepSpec(
        "13-quality-gate",
        "Step 13.1 (Admin Data Quality Gate)",
        "node",
        "backend/restaurant-evaluation/scripts/admin-data-quality-audit.mjs",
        ("--fail-on-exact",),
        frozenset({MUTATING_CAPABILITY}),
        skip_after="13-supabase-insert",
    ),
)

ADAPTER_STEPS = tuple(spec.id for spec in STEP_SPECS)
CANONICAL_STEP_NAMES = {spec.id: spec.canonical_name for spec in STEP_SPECS}
STEP_BY_ID = {spec.id: spec for spec in STEP_SPECS}

# Four step classes composed for a heavy_local + local_db run (R8.1). Every one
# of the 18 STEP_SPECS ids belongs to exactly one class; the four classes are
# the crawling, evaluation, media, and insertion stages the design fixes.
CRAWLING_CLASS = "crawling"
EVALUATION_CLASS = "evaluation"
MEDIA_CLASS = "media"
INSERTION_CLASS = "insertion"
STEP_CLASSES: tuple[str, ...] = (
    CRAWLING_CLASS,
    EVALUATION_CLASS,
    MEDIA_CLASS,
    INSERTION_CLASS,
)
STEP_CLASS_BY_ID: dict[str, str] = {
    "01-collect-urls": CRAWLING_CLASS,
    "02-collect-meta": CRAWLING_CLASS,
    "02-1-migrate": CRAWLING_CLASS,
    "02-5-cleanup": CRAWLING_CLASS,
    "03-transcript": CRAWLING_CLASS,
    "03-1-context": CRAWLING_CLASS,
    "03-2-visual": EVALUATION_CLASS,
    "09-target": EVALUATION_CLASS,
    "10-rule": EVALUATION_CLASS,
    "11-laaj": EVALUATION_CLASS,
    "12-transform": EVALUATION_CLASS,
    "04-frames": MEDIA_CLASS,
    "05-map-url": MEDIA_CLASS,
    "06-frame-caption": MEDIA_CLASS,
    "06-1-enrich": MEDIA_CLASS,
    "08-chunk": MEDIA_CLASS,
    "13-supabase-insert": INSERTION_CLASS,
    "13-quality-gate": INSERTION_CLASS,
}


def step_class(step_id: str) -> str:
    """Return the composed step class for a known step id.

    Raises AdapterGraphError("step_class_unknown") for an id absent from the
    mapping so an unmapped step can never be composed silently.
    """

    try:
        return STEP_CLASS_BY_ID[step_id]
    except KeyError:
        raise AdapterGraphError("step_class_unknown") from None


def validate_step_classes() -> None:
    """Fail closed unless every step maps to exactly one of the four classes.

    Every ``STEP_SPECS`` id must have a class, every mapped id must be a real
    step, and each of the four classes must be non-empty. This keeps the
    crawling/evaluation/media/insertion composition total and disjoint (R8.1).
    """

    spec_ids = {spec.id for spec in STEP_SPECS}
    mapped_ids = set(STEP_CLASS_BY_ID)
    if spec_ids != mapped_ids:
        raise AdapterGraphError("step_class_incomplete")
    if set(STEP_CLASS_BY_ID.values()) != set(STEP_CLASSES):
        raise AdapterGraphError("step_class_incomplete")


def _reject_escape(path: Path, root: Path) -> None:
    try:
        resolved = path.resolve()
        resolved.relative_to(root.resolve())
    except (OSError, ValueError):
        raise AdapterGraphError("command_path_escape") from None
    if ".." in path.parts:
        raise AdapterGraphError("command_path_escape")


def validate_graph(root: Path | None = None) -> None:
    base = root or REPO_ROOT
    context = next(spec for spec in STEP_SPECS if spec.id == "03-1-context")
    if "--channel" in context.extra_args:
        raise AdapterGraphError("command_args_invalid")
    frames = next(spec for spec in STEP_SPECS if spec.id == "04-frames")
    if Path(frames.script).name != "04-extract-frames-with-heatmap.js":
        raise AdapterGraphError("command_path_invalid")
    if "13-quality-gate" not in STEP_BY_ID:
        raise AdapterGraphError("quality_gate_missing")
    validate_step_classes()
    for spec in STEP_SPECS:
        if spec.interpreter not in ALLOWED_INTERPRETERS:
            raise AdapterGraphError("interpreter_not_admitted")
        script = Path(spec.script)
        if script.is_absolute() or script.suffix not in {".py", ".js", ".mjs", ".sh"}:
            raise AdapterGraphError("command_path_invalid")
        _reject_escape(base / script, base)
        if not (base / script).is_file():
            raise AdapterGraphError("command_path_missing")
        for part in spec.extra_args:
            for _, field_name, _, _ in Formatter().parse(part):
                if field_name and field_name not in ALLOWED_TEMPLATES:
                    raise AdapterGraphError("command_args_invalid")


def resolve_python() -> str:
    import os

    command = os.environ.get("PYTHON_CMD", "python3").strip() or "python3"
    if Path(command).name not in ALLOWED_PYTHON_NAMES:
        raise AdapterGraphError("interpreter_not_admitted")
    return command


def build_argv(spec: StepSpec, *, target: str, root: Path | None = None) -> list[str]:
    import os

    base = root or REPO_ROOT
    python = resolve_python()
    max_videos = os.environ.get("MAX_CONTEXT_VIDEOS", "0").strip() or "0"
    mapping = {"target": target, "python": python, "max_videos": max_videos}
    formatted: list[str] = []
    for part in spec.extra_args:
        value = part.format(**mapping)
        if "/" in value or value.startswith("backend"):
            _reject_escape(base / value, base)
        formatted.append(value)
    if spec.interpreter == "python3":
        return [python, spec.script, *formatted]
    return [spec.interpreter, spec.script, *formatted]
