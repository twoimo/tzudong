"""
LangGraph 노드 함수 (Node Functions).

각 노드는 기존 스크립트를 subprocess로 호출하고,
결과를 파싱하여 PipelineState를 업데이트한다.
"""

from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from .state import PipelineState, StepName, ValidationSeverity
from .validators import (
    validate_gemini_output,
    validate_selection,
    validate_rule_results,
    validate_laaj_results,
    cross_validate,
    validate_transform_output,
    has_blocking_errors,
    error_summary,
)
from .review import ReviewQueue


# ─── 유틸리티 ─────────────────────────────────────────────

def _project_root() -> Path:
    """backend/pipeline/ 기준으로 프로젝트 루트 반환"""
    return Path(__file__).resolve().parent.parent.parent


def _python_cmd() -> str:
    """현재 Python 인터프리터 경로"""
    return sys.executable


def _run_script(
    cmd: list[str],
    cwd: str | Path | None = None,
    timeout: int = 1800,  # 30분 기본 타임아웃
) -> subprocess.CompletedProcess:
    """스크립트 실행 래퍼"""
    return subprocess.run(
        cmd,
        cwd=str(cwd or _project_root()),
        capture_output=True,
        text=True,
        timeout=timeout,
        env=None,  # 부모 환경 상속
    )


def _load_latest_jsonl(filepath: Path) -> dict | None:
    """JSONL 파일의 마지막 줄을 JSON으로 파싱"""
    if not filepath.exists():
        return None
    last_line = None
    with open(filepath, "r", encoding="utf-8-sig") as f:
        for line in f:
            stripped = line.strip()
            if stripped:
                last_line = stripped
    if not last_line:
        return None
    try:
        return json.loads(last_line)
    except json.JSONDecodeError:
        return None


def _log(step: str, msg: str) -> None:
    """파이프라인 로그 출력"""
    timestamp = time.strftime("%H:%M:%S")
    print(f"[{timestamp}] [Pipeline/{step}] {msg}", flush=True)


# ═══════════════════════════════════════════════════════════
# 노드 함수들
# ═══════════════════════════════════════════════════════════

def discover_video_ids(state: PipelineState) -> dict:
    """
    처리 대상 video_id 목록을 수집한다.
    crawling 디렉토리의 JSONL 파일명에서 추출.
    """
    crawling_dir = Path(state["crawling_path"]) / "crawling"
    video_ids = sorted({f.stem for f in crawling_dir.glob("*.jsonl")})

    max_v = state.get("max_videos", -1)
    if max_v > 0:
        video_ids = video_ids[:max_v]

    _log("discover", f"대상 video_id: {len(video_ids)}개")
    return {"video_ids": video_ids}


def run_enrich(state: PipelineState) -> dict:
    """Step 6.1: 자막 문서 메타데이터 추가"""
    step = StepName.ENRICH.value
    _log(step, "자막 문서 메타데이터 추가 시작...")
    start = time.time()

    result = _run_script([
        _python_cmd(),
        "backend/restaurant-crawling/scripts/06.1-transcript-document-with-meta.py",
        "--channel", state["channel"],
    ])

    duration = time.time() - start
    _log(step, f"완료 (exit={result.returncode}, {duration:.0f}s)")

    if result.stdout:
        print(result.stdout, end="", flush=True)
    if result.returncode != 0 and result.stderr:
        print(result.stderr, end="", file=sys.stderr, flush=True)

    return {
        "current_step": step,
        "step_timings": [{"step": step, "duration_sec": round(duration, 1)}],
    }


def run_gemini(state: PipelineState) -> dict:
    """Step 7: Gemini 기반 데이터 분석"""
    step = StepName.GEMINI.value
    _log(step, "Gemini 데이터 분석 시작...")
    start = time.time()

    result = _run_script([
        "bash",
        "backend/restaurant-crawling/scripts/07-gemini-crawling.sh",
        "--channel", state["channel"],
    ], timeout=3600)

    duration = time.time() - start
    _log(step, f"완료 (exit={result.returncode}, {duration:.0f}s)")

    if result.stdout:
        print(result.stdout, end="", flush=True)

    return {
        "current_step": step,
        "step_timings": [{"step": step, "duration_sec": round(duration, 1)}],
    }


def validate_gemini_node(state: PipelineState) -> dict:
    """Step 7 후 검증: Gemini 크롤링 결과 검증"""
    step = "validate_gemini"
    _log(step, "Gemini 결과 검증 중...")

    crawling_dir = Path(state["crawling_path"]) / "crawling"
    queue = ReviewQueue(
        str(Path(state["evaluation_path"]).parent),
        state["channel"],
    )

    all_errors: list[dict] = []
    failed_ids: list[str] = []
    completed: list[str] = []
    total_restaurants = 0

    for vid in state["video_ids"]:
        if vid in state.get("failed_video_ids", []):
            continue

        data = _load_latest_jsonl(crawling_dir / f"{vid}.jsonl")
        if not data:
            continue

        errors = validate_gemini_output(vid, data)
        all_errors.extend(errors)
        total_restaurants += len(data.get("restaurants", []))

        if has_blocking_errors(errors):
            _log(step, f"  ✗ {vid}: {error_summary(errors)}")
            queue.enqueue(vid, StepName.GEMINI.value, errors, data)
            failed_ids.append(vid)
        else:
            completed.append(vid)

    _log(step, f"검증 완료: 통과={len(completed)}, 실패={len(failed_ids)}")

    return {
        "validation_errors": all_errors,
        "failed_video_ids": failed_ids,
        "completed_gemini": completed,
        "total_restaurants": total_restaurants,
        "review_queue": [{"step": StepName.GEMINI.value, "count": len(failed_ids)}]
        if failed_ids else [],
    }


def run_target(state: PipelineState) -> dict:
    """Step 8: 평가 대상 선정"""
    step = StepName.TARGET.value
    _log(step, "평가 대상 선정 시작...")
    start = time.time()

    result = _run_script([
        _python_cmd(),
        "backend/restaurant-evaluation/scripts/08-target-selection.py",
        "--channel", state["channel"],
        "--crawling-path", state["crawling_path"],
        "--evaluation-path", state["evaluation_path"],
    ])

    duration = time.time() - start
    _log(step, f"완료 (exit={result.returncode}, {duration:.0f}s)")

    if result.stdout:
        print(result.stdout, end="", flush=True)

    return {
        "current_step": step,
        "step_timings": [{"step": step, "duration_sec": round(duration, 1)}],
    }


def validate_target_node(state: PipelineState) -> dict:
    """Step 8 후 검증: Selection 결과 검증"""
    step = "validate_target"
    _log(step, "Selection 결과 검증 중...")

    selection_dir = Path(state["evaluation_path"]) / "evaluation" / "selection"
    queue = ReviewQueue(
        str(Path(state["evaluation_path"]).parent),
        state["channel"],
    )

    all_errors: list[dict] = []
    failed_ids: list[str] = []
    completed: list[str] = []

    for vid in state["video_ids"]:
        if vid in state.get("failed_video_ids", []):
            continue

        data = _load_latest_jsonl(selection_dir / f"{vid}.jsonl")
        if not data:
            continue

        errors = validate_selection(vid, data)
        all_errors.extend(errors)

        if has_blocking_errors(errors):
            _log(step, f"  ✗ {vid}: {error_summary(errors)}")
            queue.enqueue(vid, StepName.TARGET.value, errors, data)
            failed_ids.append(vid)
        else:
            completed.append(vid)

    _log(step, f"검증 완료: 통과={len(completed)}, 실패={len(failed_ids)}")

    return {
        "validation_errors": all_errors,
        "failed_video_ids": failed_ids,
        "completed_target": completed,
    }


def run_rule(state: PipelineState) -> dict:
    """Step 9: Rule 기반 평가"""
    step = StepName.RULE.value
    _log(step, "Rule 기반 평가 시작...")
    start = time.time()

    result = _run_script([
        _python_cmd(),
        "backend/restaurant-evaluation/scripts/09-rule-evaluation.py",
        "--channel", state["channel"],
        "--evaluation-path", state["evaluation_path"],
    ])

    duration = time.time() - start
    _log(step, f"완료 (exit={result.returncode}, {duration:.0f}s)")

    if result.stdout:
        print(result.stdout, end="", flush=True)

    return {
        "current_step": step,
        "step_timings": [{"step": step, "duration_sec": round(duration, 1)}],
    }


def validate_rule_node(state: PipelineState) -> dict:
    """Step 9 후 검증: Rule 평가 결과 검증"""
    step = "validate_rule"
    _log(step, "Rule 평가 결과 검증 중...")

    rule_dir = Path(state["evaluation_path"]) / "evaluation" / "rule_results"
    queue = ReviewQueue(
        str(Path(state["evaluation_path"]).parent),
        state["channel"],
    )

    all_errors: list[dict] = []
    failed_ids: list[str] = []
    completed: list[str] = []

    for vid in state["video_ids"]:
        if vid in state.get("failed_video_ids", []):
            continue

        data = _load_latest_jsonl(rule_dir / f"{vid}.jsonl")
        if not data:
            continue

        errors = validate_rule_results(vid, data)
        all_errors.extend(errors)

        if has_blocking_errors(errors):
            _log(step, f"  ✗ {vid}: {error_summary(errors)}")
            queue.enqueue(vid, StepName.RULE.value, errors, data)
            failed_ids.append(vid)
        else:
            completed.append(vid)

    _log(step, f"검증 완료: 통과={len(completed)}, 실패={len(failed_ids)}")

    return {
        "validation_errors": all_errors,
        "failed_video_ids": failed_ids,
        "completed_rule": completed,
    }


def run_laaj(state: PipelineState) -> dict:
    """Step 10: LAAJ (LLM) 기반 평가"""
    step = StepName.LAAJ.value
    _log(step, "LAAJ 평가 시작...")
    start = time.time()

    result = _run_script([
        "bash",
        "backend/restaurant-evaluation/scripts/10-laaj-evaluation.sh",
        "--channel", state["channel"],
        "--crawling-path", state["crawling_path"],
        "--evaluation-path", state["evaluation_path"],
    ], timeout=3600)

    duration = time.time() - start
    _log(step, f"완료 (exit={result.returncode}, {duration:.0f}s)")

    if result.stdout:
        print(result.stdout, end="", flush=True)

    return {
        "current_step": step,
        "step_timings": [{"step": step, "duration_sec": round(duration, 1)}],
    }


def validate_laaj_node(state: PipelineState) -> dict:
    """Step 10 후 검증: LAAJ 평가 결과 검증 + 교차 검증"""
    step = "validate_laaj"
    _log(step, "LAAJ 평가 결과 및 교차 검증 중...")

    laaj_dir = Path(state["evaluation_path"]) / "evaluation" / "laaj_results"
    rule_dir = Path(state["evaluation_path"]) / "evaluation" / "rule_results"
    queue = ReviewQueue(
        str(Path(state["evaluation_path"]).parent),
        state["channel"],
    )

    all_errors: list[dict] = []
    failed_ids: list[str] = []
    completed: list[str] = []

    for vid in state["video_ids"]:
        if vid in state.get("failed_video_ids", []):
            continue

        laaj_data = _load_latest_jsonl(laaj_dir / f"{vid}.jsonl")
        if not laaj_data:
            continue

        # LAAJ 자체 검증
        errors = validate_laaj_results(vid, laaj_data)

        # Rule vs LAAJ 교차 검증
        rule_data = _load_latest_jsonl(rule_dir / f"{vid}.jsonl")
        if rule_data:
            cross_errors = cross_validate(vid, rule_data, laaj_data)
            errors.extend(cross_errors)

        all_errors.extend(errors)

        if has_blocking_errors(errors):
            _log(step, f"  ✗ {vid}: {error_summary(errors)}")
            queue.enqueue(vid, StepName.LAAJ.value, errors, laaj_data)
            failed_ids.append(vid)
        else:
            completed.append(vid)

    _log(step, f"검증 완료: 통과={len(completed)}, 실패={len(failed_ids)}")

    return {
        "validation_errors": all_errors,
        "failed_video_ids": failed_ids,
        "completed_laaj": completed,
    }


def run_transform(state: PipelineState) -> dict:
    """Step 11: 결과 변환"""
    step = StepName.TRANSFORM.value
    _log(step, "결과 변환 시작...")
    start = time.time()

    result = _run_script([
        _python_cmd(),
        "backend/restaurant-evaluation/scripts/11-transform.py",
        "--channel", state["channel"],
        "--crawling-path", state["crawling_path"],
        "--evaluation-path", state["evaluation_path"],
    ])

    duration = time.time() - start
    _log(step, f"완료 (exit={result.returncode}, {duration:.0f}s)")

    if result.stdout:
        print(result.stdout, end="", flush=True)

    return {
        "current_step": step,
        "step_timings": [{"step": step, "duration_sec": round(duration, 1)}],
    }


def validate_transform_node(state: PipelineState) -> dict:
    """Step 11 후 검증: Transform 출력 검증"""
    step = "validate_transform"
    _log(step, "Transform 결과 검증 중...")

    transforms_file = Path(state["evaluation_path"]) / "evaluation" / "transforms.jsonl"
    queue = ReviewQueue(
        str(Path(state["evaluation_path"]).parent),
        state["channel"],
    )

    if not transforms_file.exists():
        _log(step, "transforms.jsonl 파일 없음")
        return {
            "validation_errors": [{
                "step": step,
                "video_id": "*",
                "restaurant_name": None,
                "severity": ValidationSeverity.ERROR.value,
                "rule": "missing_file",
                "message": "transforms.jsonl 파일이 존재하지 않습니다",
                "field_path": "",
                "actual_value": None,
            }],
        }

    # 전체 transforms.jsonl 로드 (video_id별 그룹핑)
    records_by_video: dict[str, list[dict]] = {}
    total_records = 0

    with open(transforms_file, "r", encoding="utf-8-sig") as f:
        for line in f:
            stripped = line.strip()
            if not stripped:
                continue
            try:
                record = json.loads(stripped)
                vid = record.get("youtube_link", "").split("v=")[-1] if record.get("youtube_link") else "unknown"
                records_by_video.setdefault(vid, []).append(record)
                total_records += 1
            except json.JSONDecodeError:
                continue

    all_errors: list[dict] = []
    failed_ids: list[str] = []
    completed: list[str] = []
    validated_count = 0

    for vid, records in records_by_video.items():
        if vid in state.get("failed_video_ids", []):
            continue

        errors = validate_transform_output(vid, records)
        all_errors.extend(errors)

        if has_blocking_errors(errors):
            _log(step, f"  ✗ {vid}: {error_summary(errors)}")
            queue.enqueue(vid, StepName.TRANSFORM.value, errors,
                          {"video_id": vid, "records": records})
            failed_ids.append(vid)
        else:
            completed.append(vid)
            validated_count += len(records)

    _log(step, f"검증 완료: 레코드 {total_records}개 중 {validated_count}개 통과")

    # 품질 점수 계산
    quality = validated_count / total_records if total_records > 0 else 0.0

    return {
        "validation_errors": all_errors,
        "failed_video_ids": failed_ids,
        "completed_transform": completed,
        "validated_restaurants": validated_count,
        "quality_score": round(quality, 4),
    }


def run_insert(state: PipelineState) -> dict:
    """Step 12: Supabase 데이터 삽입"""
    step = StepName.INSERT.value

    if state.get("dry_run"):
        _log(step, "DRY RUN 모드: Supabase 삽입 건너뜀")
        return {
            "current_step": step,
            "step_timings": [{"step": step, "duration_sec": 0.0}],
        }

    _log(step, "Supabase 데이터 삽입 시작...")
    start = time.time()

    result = _run_script([
        _python_cmd(),
        "backend/restaurant-evaluation/scripts/12-supabase-insert.py",
        "--channel", state["channel"],
        "--evaluation-path", state["evaluation_path"],
    ])

    duration = time.time() - start
    _log(step, f"완료 (exit={result.returncode}, {duration:.0f}s)")

    if result.stdout:
        print(result.stdout, end="", flush=True)

    return {
        "current_step": step,
        "completed_insert": state.get("completed_transform", []),
        "step_timings": [{"step": step, "duration_sec": round(duration, 1)}],
    }


def generate_summary(state: PipelineState) -> dict:
    """최종 리포트 생성"""
    failed = state.get("failed_video_ids", [])
    unique_failed = list(set(failed))

    # 스텝별 소요 시간
    timings = state.get("step_timings", [])
    timing_lines = [f"  {t['step']}: {t['duration_sec']:.0f}s" for t in timings]
    total_time = sum(t["duration_sec"] for t in timings)

    # 검증 오류 요약
    errors = state.get("validation_errors", [])
    error_count = {"error": 0, "warning": 0, "info": 0}
    for e in errors:
        sev = e.get("severity", "info")
        error_count[sev] = error_count.get(sev, 0) + 1

    # 리뷰 큐 통계
    queue = ReviewQueue(
        str(Path(state["evaluation_path"]).parent),
        state["channel"],
    )
    queue_stats = queue.stats()

    summary = f"""
═══════════════════════════════════════════════════
 LangGraph 파이프라인 실행 리포트
═══════════════════════════════════════════════════
 채널: {state['channel']}
 모드: {'DRY RUN' if state.get('dry_run') else 'PRODUCTION'}
 총 비디오: {len(state.get('video_ids', []))}개
 검증 실패 제외: {len(unique_failed)}개
 품질 점수: {state.get('quality_score', 0):.1%}
───────────────────────────────────────────────────
 실행 시간:
{chr(10).join(timing_lines)}
  ────────────
  총 소요: {total_time:.0f}s ({total_time/60:.1f}m)
───────────────────────────────────────────────────
 검증 결과:
  ERROR: {error_count['error']}건
  WARNING: {error_count['warning']}건
  INFO: {error_count['info']}건
───────────────────────────────────────────────────
 리뷰 큐:
  대기: {queue_stats['pending']}건
  승인: {queue_stats['approved']}건
  거부: {queue_stats['rejected']}건
  수정: {queue_stats['modified']}건
═══════════════════════════════════════════════════
"""

    _log("summary", summary)
    return {"summary": summary.strip()}
