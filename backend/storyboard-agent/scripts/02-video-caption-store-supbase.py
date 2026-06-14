#!/usr/bin/env python3
"""
비디오 프레임 캡션 데이터 적재 스크립트 (JSONL -> Supabase)

backend/restaurant-crawling/data/tzuyang/frame-caption/ 경로의 JSONL 파일들을 읽어서
Supabase의 `video_frame_captions` 테이블에 적재합니다.

주요 기능:
- JSONL 파일 파싱
- parsed_json 필드 처리 로직 (parsed_json 있으면 chronological_analysis, highlight_keywords 추출)
- raw_caption은 항상 저장
- Supabase upsert (video_id, recollect_id, start_sec 기준)

사용법:
    python 02-video-caption-store-supbase.py
    python 02-video-caption-store-supbase.py --batch-size 100
    python 02-video-caption-store-supbase.py --input-file <video>.jsonl --skip-git-fetch --dry-run
"""

from __future__ import annotations

import json
import os
import sys
import argparse
import subprocess
from pathlib import Path
from urllib.parse import urlparse
from tqdm import tqdm
from supabase import create_client, Client
from dotenv import load_dotenv

# 출력 버퍼링 비활성화 (즉시 출력)
sys.stdout.reconfigure(line_buffering=True)
sys.stderr.reconfigure(line_buffering=True)

# .env 로드
load_dotenv()
load_dotenv(Path.cwd() / ".env.local")

# Supabase 설정
SUPABASE_URL = os.getenv("PUBLIC_SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
TABLE_NAME = "video_frame_captions"

# 경로 설정
SCRIPT_DIR = Path(__file__).parent.resolve()
INPUT_DIR = SCRIPT_DIR / "../../restaurant-crawling/data/tzuyang/frame-caption"

PUBLIC_PROVENANCE_KEYS = {
    "providerId",
    "model",
    "authMode",
    "schemaVersion",
    "requestHash",
    "frameCount",
    "truncatedFrames",
    "fileNameHashes",
    "latencyMs",
    "parserStatus",
    "responseId",
}


def fetch_data_from_git(branch: str, target_path: Path):
    """지정된 브랜치에서 데이터 폴더를 체크아웃"""
    print(f"📥 '{branch}' 브랜치에서 데이터 가져오는 중...", flush=True)

    try:
        # 1. Repo Root 찾기
        repo_root = (
            subprocess.check_output(
                ["git", "rev-parse", "--show-toplevel"], stderr=subprocess.STDOUT
            )
            .decode()
            .strip()
        )

        # 2. target_path를 Repo Root 기준 상대 경로로 변환
        rel_path = target_path.relative_to(repo_root)

        # 3. git checkout 실행
        subprocess.run(
            ["git", "checkout", branch, "--", str(rel_path)],
            cwd=repo_root,
            check=True,
            capture_output=True,
        )
        print(f"✅ 데이터 체크아웃 완료: {rel_path}", flush=True)

    except subprocess.CalledProcessError as e:
        print(
            f"⚠️ 데이터 가져오기 실패: {e.output.decode() if e.output else str(e)}",
            flush=True,
        )
    except Exception as e:
        print(f"⚠️ 데이터 가져오기 중 오류: {e}", flush=True)


def resolve_input_files(input_file: Path | None = None, video_id: str | None = None) -> list[Path]:
    """단일 파일/비디오 선택을 지원하는 입력 파일 목록 해석."""
    if input_file:
        return [input_file.expanduser().resolve()]

    if video_id:
        return [(INPUT_DIR / f"{video_id}.jsonl").resolve()]

    if not INPUT_DIR.exists():
        return []

    return sorted(INPUT_DIR.glob("*.jsonl"))


def sanitize_caption_provenance(value: object) -> dict:
    """DB에 공개 가능한 provenance 필드만 저장한다.

    로컬 JSONL은 디버깅용으로 프레임 경로를 포함할 수 있지만, DB/API에 올리는
    provenance는 해시/모델/파서 상태 같은 공개 가능한 필드로 제한한다.
    """
    if not isinstance(value, dict):
        return {}

    sanitized = {}
    for key in PUBLIC_PROVENANCE_KEYS:
        if key not in value:
            continue
        current = value[key]
        if key == "fileNameHashes":
            if isinstance(current, list):
                sanitized[key] = [str(item) for item in current]
            continue
        sanitized[key] = current
    return sanitized


def load_captions(input_file: Path | None = None, video_id: str | None = None):
    """JSONL 파일에서 캡션 데이터 로드"""
    print("📥 캡션 데이터 로드 중...", flush=True)

    captions = []

    input_files = resolve_input_files(input_file=input_file, video_id=video_id)
    if not input_files:
        print(f"❌ 입력 파일 없음: {INPUT_DIR}", flush=True)
        return captions

    for input_file in tqdm(input_files, desc="파일 로드"):
        if not input_file.exists():
            print(f"⚠️ 입력 파일 없음: {input_file}", flush=True)
            continue
        video_id = input_file.stem  # 파일명에서 video_id 추출

        with open(input_file, "r", encoding="utf-8") as f:
            for line_number, line in enumerate(f, start=1):
                stripped = line.strip()
                if not stripped:
                    continue
                try:
                    data = json.loads(stripped)

                    # 기본 필드 추출
                    record = {
                        "video_id": video_id,
                        "recollect_id": data.get("recollect_id"),
                        "start_sec": data.get("start_sec"),
                        "end_sec": data.get("end_sec"),
                        "duration": data.get("duration"),
                        "rank": data.get("rank"),
                        "raw_caption": data.get("raw_caption") or data.get("caption"),
                        "chronological_analysis": None,
                        "highlight_keywords": None,
                        "caption_provider": data.get("caption_provider")
                        or "llava_next_video",
                        "caption_model": data.get("caption_model"),
                        "caption_auth_mode": data.get("caption_auth_mode")
                        or "unknown_legacy",
                        "caption_provenance": sanitize_caption_provenance(
                            data.get("caption_provenance") or {}
                        ),
                        "caption_generated_at": data.get("caption_generated_at"),
                        "caption_schema_version": data.get("caption_schema_version") or 1,
                    }

                    # parsed_json 처리 로직
                    parsed_json = data.get("parsed_json")
                    if parsed_json:
                        # parsed_json이 dict인 경우 (정상적으로 파싱된 경우)
                        if isinstance(parsed_json, dict):
                            record["chronological_analysis"] = parsed_json.get(
                                "chronological_analysis"
                            )
                            keywords = parsed_json.get("highlight_keywords")
                            # keywords가 리스트면 문자열로 변환하지 않고 그대로 저장 (Supabase 배열 타입 대응)
                            # 만약 Supabase 컬럼이 text[]가 아니라면 변환 필요할 수 있음.
                            # 일단 JSON 그대로 유지.
                            record["highlight_keywords"] = keywords

                        # parsed_json이 문자열인 경우 (가끔 이중 인코딩되는 경우 대비)
                        elif isinstance(parsed_json, str):
                            try:
                                parsed_dict = json.loads(parsed_json)
                                record["chronological_analysis"] = parsed_dict.get(
                                    "chronological_analysis"
                                )
                                record["highlight_keywords"] = parsed_dict.get(
                                    "highlight_keywords"
                                )
                            except json.JSONDecodeError as e:
                                print(
                                    f"⚠️ parsed_json 파싱 실패 ({input_file.name}:{line_number}): {e}",
                                    flush=True,
                                )

                    # 만약 raw_caption만 있고 parsed_json은 비어있는 경우
                    # 사용자 요청: "parsed_json는 비어있고 raw_caption만 있는 경우에는 raw_caption 필드에 넣게 해줘"
                    # -> 이미 raw_caption 필드에 raw_caption 값을 넣고 있으므로 추가 작업 불필요.
                    # -> 단, chronological_analysis 등이 null인 상태로 저장됨.

                    captions.append(record)

                except json.JSONDecodeError as e:
                    print(
                        f"⚠️ JSONL 파싱 실패 ({input_file.name}:{line_number}): {e}",
                        flush=True,
                    )
                    continue
                except Exception as e:
                    print(f"⚠️ 데이터 처리 중 오류 ({input_file.name}): {e}", flush=True)
                    continue

    print(f"✅ {len(captions)}개 캡션 로드됨", flush=True)
    return captions


def summarize_captions(captions: list[dict]) -> dict:
    """dry-run/readback 로그에 사용할 안전한 요약."""
    providers = sorted({caption.get("caption_provider") for caption in captions if caption.get("caption_provider")})
    models = sorted({caption.get("caption_model") for caption in captions if caption.get("caption_model")})
    video_ids = sorted({caption.get("video_id") for caption in captions if caption.get("video_id")})
    return {
        "count": len(captions),
        "video_ids": video_ids[:10],
        "providers": providers,
        "models": models,
        "sample": captions[0] if captions else None,
    }


def store_captions(supabase: Client, captions: list[dict], batch_size: int = 100):
    """Supabase에 캡션 데이터 저장 (Upsert)"""
    if not captions:
        print("\n📝 저장할 데이터 없음", flush=True)
        return (0, 0)

    print(
        f"\n📝 Supabase 저장 중: {len(captions)}개 (배치 크기: {batch_size})",
        flush=True,
    )

    total_batches = (len(captions) + batch_size - 1) // batch_size
    inserted = 0
    errors = 0

    for i in tqdm(
        range(0, len(captions), batch_size),
        desc="DB 저장",
        total=total_batches,
    ):
        batch = captions[i : i + batch_size]

        try:
            # upsert 실행
            # conflict 컬럼: video_id, recollect_id, start_sec (유니크 키로 가정)
            # 만약 테이블의 PK가 다르다면 on_conflict 수정 필요
            supabase.table(TABLE_NAME).upsert(
                batch, on_conflict="video_id,recollect_id,start_sec"
            ).execute()

            inserted += len(batch)

        except Exception as e:
            print(f"\n⚠️ 배치 오류: {e}", flush=True)
            # 상세 에러 확인을 위해 첫 번째 항목 출력해보기
            if batch:
                print(f"   Sample data: {batch[0]}")
            errors += len(batch)

    print(f"\n✅ 저장 완료: {inserted}개 성공, {errors}개 실패", flush=True)
    if errors:
        raise RuntimeError(f"Supabase caption upsert failed for {errors} row(s)")
    return (inserted, errors)


def readback_captions(supabase: Client, captions: list[dict], limit: int = 3):
    """저장 후 핵심 provenance 필드가 DB에서 다시 읽히는지 확인."""
    if not captions:
        return []

    print(f"\n🔎 저장 결과 readback 확인 (최대 {limit}개)", flush=True)
    read_rows = []
    for record in captions[:limit]:
        response = (
            supabase.table(TABLE_NAME)
            .select(
                "video_id,recollect_id,start_sec,caption_provider,caption_model,"
                "caption_auth_mode,caption_schema_version,caption_provenance"
            )
            .eq("video_id", record["video_id"])
            .eq("recollect_id", record["recollect_id"])
            .eq("start_sec", record["start_sec"])
            .limit(1)
            .execute()
        )
        rows = response.data or []
        if not rows:
            raise RuntimeError(
                f"Supabase caption readback missing: "
                f"{record['video_id']}#{record['recollect_id']}@{record['start_sec']}"
            )
        print(json.dumps(rows[0], ensure_ascii=False, sort_keys=True), flush=True)
        read_rows.append(rows[0])
    return read_rows


def format_supabase_target(url: str) -> str:
    parsed = urlparse(url)
    return parsed.netloc or parsed.path


def main():
    parser = argparse.ArgumentParser(
        description="비디오 프레임 캡션 데이터 적재 (JSONL -> Supabase)"
    )
    parser.add_argument("--batch-size", type=int, default=100, help="배치 크기")
    parser.add_argument("--input-file", type=Path, help="단일 JSONL 파일만 적재")
    parser.add_argument("--video-id", help="단일 video_id JSONL만 적재")
    parser.add_argument(
        "--skip-git-fetch",
        action="store_true",
        help="data 브랜치 checkout을 건너뜀 (로컬 생성 파일 보호)",
    )
    parser.add_argument("--dry-run", action="store_true", help="DB 저장 없이 로드/검증만 수행")
    parser.add_argument("--readback", action="store_true", help="저장 후 DB readback 검증")
    args = parser.parse_args()

    print("=" * 60, flush=True)
    print("비디오 프레임 캡션 데이터 적재", flush=True)
    print("=" * 60, flush=True)

    # 1.5. 데이터 브랜치에서 데이터 가져오기.
    # 단일 파일/비디오 모드에서는 로컬에서 방금 생성한 JSONL이 data 브랜치 checkout으로
    # 덮이지 않도록 기본적으로 fetch를 건너뛴다.
    if not args.skip_git_fetch and not args.input_file and not args.video_id and not args.dry_run:
        fetch_data_from_git("data", INPUT_DIR)
    else:
        print("⏭️ data 브랜치 checkout 건너뜀", flush=True)

    # 2. 데이터 로드
    captions = load_captions(input_file=args.input_file, video_id=args.video_id)

    if not captions:
        return

    summary = summarize_captions(captions)
    print("📋 로드 요약:", json.dumps(summary, ensure_ascii=False, sort_keys=True), flush=True)

    if args.dry_run:
        print("✅ dry-run 완료: DB 저장 없음", flush=True)
        return

    # 3. Supabase 연결
    if not SUPABASE_URL or not SUPABASE_KEY:
        print(
            "❌ PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 없습니다",
            flush=True,
        )
        return

    print(f"\n🔌 Supabase 연결: {format_supabase_target(SUPABASE_URL)}", flush=True)
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    print("✅ 연결 성공", flush=True)

    # 4. Supabase 저장
    store_captions(supabase, captions, batch_size=args.batch_size)
    if args.readback:
        readback_captions(supabase, captions)

    print("\n" + "=" * 60, flush=True)
    print("✅ 완료!", flush=True)
    print("=" * 60, flush=True)


if __name__ == "__main__":
    main()
