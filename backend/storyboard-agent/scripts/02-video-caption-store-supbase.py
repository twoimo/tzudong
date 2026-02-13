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
"""

import json
import os
import sys
import argparse
import subprocess
from pathlib import Path
from datetime import datetime
from tqdm import tqdm
from supabase import create_client, Client
from dotenv import load_dotenv

# 출력 버퍼링 비활성화 (즉시 출력)
sys.stdout.reconfigure(line_buffering=True)
sys.stderr.reconfigure(line_buffering=True)

# .env 로드
load_dotenv()

# Supabase 설정
SUPABASE_URL = os.getenv("PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
TABLE_NAME = "video_frame_captions"

# 경로 설정
SCRIPT_DIR = Path(__file__).parent.resolve()
INPUT_DIR = SCRIPT_DIR / "../../restaurant-crawling/data/tzuyang/frame-caption"


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


def load_captions():
    """JSONL 파일에서 캡션 데이터 로드"""
    print("📥 캡션 데이터 로드 중...", flush=True)

    captions = []

    if not INPUT_DIR.exists():
        print(f"❌ 입력 디렉토리 없음: {INPUT_DIR}", flush=True)
        return captions

    input_files = list(INPUT_DIR.glob("*.jsonl"))

    for input_file in tqdm(input_files, desc="파일 로드"):
        video_id = input_file.stem  # 파일명에서 video_id 추출

        with open(input_file, "r", encoding="utf-8") as f:
            for line in f:
                try:
                    data = json.loads(line.strip())

                    # 기본 필드 추출
                    record = {
                        "video_id": video_id,
                        "recollect_id": data.get("recollect_id"),
                        "start_sec": data.get("start_sec"),
                        "end_sec": data.get("end_sec"),
                        "duration": data.get("duration"),
                        "rank": data.get("rank"),
                        "raw_caption": data.get("raw_caption"),
                        "chronological_analysis": None,
                        "highlight_keywords": None,
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
                            except:
                                pass  # 파싱 실패시 null 유지

                    # 만약 raw_caption만 있고 parsed_json은 비어있는 경우
                    # 사용자 요청: "parsed_json는 비어있고 raw_caption만 있는 경우에는 raw_caption 필드에 넣게 해줘"
                    # -> 이미 raw_caption 필드에 raw_caption 값을 넣고 있으므로 추가 작업 불필요.
                    # -> 단, chronological_analysis 등이 null인 상태로 저장됨.

                    captions.append(record)

                except json.JSONDecodeError:
                    continue
                except Exception as e:
                    print(f"⚠️ 데이터 처리 중 오류 ({input_file.name}): {e}", flush=True)
                    continue

    print(f"✅ {len(captions)}개 캡션 로드됨", flush=True)
    return captions


def store_captions(supabase: Client, captions: list[dict], batch_size: int = 100):
    """Supabase에 캡션 데이터 저장 (Upsert)"""
    if not captions:
        print("\n📝 저장할 데이터 없음", flush=True)
        return

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


def main():
    parser = argparse.ArgumentParser(
        description="비디오 프레임 캡션 데이터 적재 (JSONL -> Supabase)"
    )
    parser.add_argument("--batch-size", type=int, default=100, help="배치 크기")
    args = parser.parse_args()

    print("=" * 60, flush=True)
    print("비디오 프레임 캡션 데이터 적재", flush=True)
    print("=" * 60, flush=True)

    # 1. Supabase 연결
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("❌ SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 없습니다", flush=True)
        return

    print(f"\n🔌 Supabase 연결: {SUPABASE_URL}", flush=True)
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    print("✅ 연결 성공", flush=True)

    # 1.5. 데이터 브랜치에서 데이터 가져오기 (코드 레벨에서 강제)
    fetch_data_from_git("data", INPUT_DIR)

    # 2. 데이터 로드
    captions = load_captions()

    if not captions:
        return

    # 3. Supabase 저장
    store_captions(supabase, captions, batch_size=args.batch_size)

    print("\n" + "=" * 60, flush=True)
    print("✅ 완료!", flush=True)
    print("=" * 60, flush=True)


if __name__ == "__main__":
    main()
