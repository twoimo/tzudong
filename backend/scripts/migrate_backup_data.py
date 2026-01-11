#!/usr/bin/env python3
"""
백업 데이터 마이그레이션 스크립트
backup_20260108의 데이터를 새 구조로 변환합니다.

변환 내용:
- name → origin_name
- youtube_meta → 삭제 (10-transform에서 조회)
- unique_id → trace_id
- 추가: channel_name, recollect_version, naver_name, trace_id_name_source

폴더 구조 변환:
- 원본: data/{yy-mm-dd}/*.jsonl (통합 파일)
- 현재: data/{channel}/{folder}/{video_id}.jsonl (개별 파일)
"""

import json
import re
import hashlib
import argparse
from pathlib import Path
from typing import Dict, Any, Optional


def extract_video_id(youtube_link: str) -> Optional[str]:
    """YouTube 링크에서 video_id 추출"""
    if not youtube_link:
        return None
    patterns = [
        r"(?:v=|youtu\.be/)([a-zA-Z0-9_-]{11})",
        r"shorts/([a-zA-Z0-9_-]{11})",
    ]
    for pattern in patterns:
        match = re.search(pattern, youtube_link)
        if match:
            return match.group(1)
    return None


def generate_trace_id(youtube_link: str, name: str, review: str) -> str:
    """trace_id 생성"""
    key_string = str(youtube_link or "") + str(name or "") + str(review or "")
    return hashlib.sha256(key_string.encode("utf-8")).hexdigest()


def convert_restaurants(restaurants: list) -> list:
    """restaurants 배열에서 name → origin_name 변환, origin_name을 맨 앞에 배치"""
    new_restaurants = []
    for r in restaurants:
        origin_name = r.pop("name", None)
        new_r = {"origin_name": origin_name}
        new_r.update(r)
        new_restaurants.append(new_r)
    return new_restaurants


def migrate_urls(backup_dir: Path, output_dir: Path, channel: str = "tzuyang"):
    """
    urls.txt 마이그레이션
    모든 날짜 폴더에서 URL 수집 → 통합 urls.txt 생성
    """
    crawling_backup = backup_dir / "geminiCLI-restaurant-crawling" / "data"
    output_file = output_dir / "restaurant-crawling" / "data" / channel / "urls.txt"
    output_file.parent.mkdir(parents=True, exist_ok=True)

    # 기존 URL 수집
    existing_urls = set()
    if output_file.exists():
        with open(output_file, "r", encoding="utf-8") as f:
            existing_urls = set(line.strip() for line in f if line.strip())

    all_urls = set()
    for date_folder in sorted(crawling_backup.iterdir()):
        if not date_folder.is_dir() or date_folder.name.startswith("no_"):
            continue
        urls_file = date_folder / "tzuyang_youtubeVideo_urls.txt"
        if urls_file.exists():
            with open(urls_file, "r", encoding="utf-8") as f:
                for line in f:
                    url = line.strip()
                    if url:
                        all_urls.add(url)

    new_urls = all_urls - existing_urls
    with open(output_file, "a", encoding="utf-8") as f:
        for url in sorted(new_urls):
            f.write(url + "\n")

    print(
        f"✅ urls 마이그레이션 완료: 기존 {len(existing_urls)}개, 추가 {len(new_urls)}개, 총 {len(all_urls)}개"
    )
    return {
        "existing": len(existing_urls),
        "new": len(new_urls),
        "total": len(all_urls),
    }


def migrate_meta(backup_dir: Path, output_dir: Path, channel: str = "tzuyang"):
    """
    meta 데이터 마이그레이션
    results_with_meta.jsonl에서 youtube_meta 추출 → meta/{video_id}.jsonl 생성
    """
    crawling_backup = backup_dir / "geminiCLI-restaurant-crawling" / "data"
    output_meta_dir = output_dir / "restaurant-crawling" / "data" / channel / "meta"
    output_meta_dir.mkdir(parents=True, exist_ok=True)

    stats = {"total": 0, "success": 0, "skipped": 0, "error": 0}

    for date_folder in sorted(crawling_backup.iterdir()):
        if not date_folder.is_dir() or date_folder.name.startswith("no_"):
            continue

        input_file = date_folder / "tzuyang_restaurant_results_with_meta.jsonl"
        if not input_file.exists():
            continue

        print(f"\n📂 처리 중: {date_folder.name}")

        with open(input_file, "r", encoding="utf-8") as f:
            for line in f:
                stats["total"] += 1
                try:
                    data = json.loads(line.strip())
                    video_id = extract_video_id(data.get("youtube_link"))
                    youtube_meta = data.get("youtube_meta", {})

                    if not video_id:
                        stats["error"] += 1
                        continue

                    output_file = output_meta_dir / f"{video_id}.jsonl"
                    if output_file.exists():
                        stats["skipped"] += 1
                        continue

                    # meta 데이터 구성 (recollect_id: 0 = 마이그레이션)
                    # 현재 코드와 동일한 구조 (video_id 제거)
                    meta_data = {
                        "youtube_link": data.get("youtube_link"),
                        "channel_name": channel,
                        "title": youtube_meta.get("title"),
                        "published_at": youtube_meta.get("publishedAt"),
                        "duration": youtube_meta.get("duration"),
                        "is_shorts": youtube_meta.get("is_shorts", False),
                        "description": None,  # 백업에 없음
                        "category": None,
                        "tags": [],
                        "stats": {
                            "view_count": youtube_meta.get("viewCount"),
                            "like_count": youtube_meta.get("likeCount"),
                            "comment_count": youtube_meta.get("commentCount"),
                        },
                        "recollect_id": 0,
                        "recollect_reason": "migration",
                        "collected_at": None,
                        "ads_info": youtube_meta.get("ads_info"),
                    }

                    with open(output_file, "w", encoding="utf-8") as out_f:
                        out_f.write(json.dumps(meta_data, ensure_ascii=False) + "\n")
                    stats["success"] += 1

                except Exception as e:
                    stats["error"] += 1
                    print(f"  ❌ 오류: {e}")

    print(f"\n✅ meta 마이그레이션 완료")
    print(
        f"   총: {stats['total']}, 성공: {stats['success']}, 스킵: {stats['skipped']}, 오류: {stats['error']}"
    )
    return stats


def migrate_transcript(backup_dir: Path, output_dir: Path, channel: str = "tzuyang"):
    """
    transcript 데이터 마이그레이션
    transcripts.json (배열) → transcript/{video_id}.jsonl (개별 파일)
    """
    crawling_backup = backup_dir / "geminiCLI-restaurant-crawling" / "data"
    output_transcript_dir = (
        output_dir / "restaurant-crawling" / "data" / channel / "transcript"
    )
    output_transcript_dir.mkdir(parents=True, exist_ok=True)

    stats = {"total": 0, "success": 0, "skipped": 0, "error": 0}

    for date_folder in sorted(crawling_backup.iterdir()):
        if not date_folder.is_dir() or date_folder.name.startswith("no_"):
            continue

        input_file = date_folder / "tzuyang_restaurant_transcripts.json"
        if not input_file.exists():
            continue

        print(f"\n📂 처리 중: {date_folder.name}")

        try:
            with open(input_file, "r", encoding="utf-8") as f:
                transcripts = json.load(f)

            for item in transcripts:
                stats["total"] += 1
                try:
                    video_id = extract_video_id(item.get("youtube_link"))
                    if not video_id:
                        stats["error"] += 1
                        continue

                    output_file = output_transcript_dir / f"{video_id}.jsonl"
                    if output_file.exists():
                        stats["skipped"] += 1
                        continue

                    # transcript 데이터 구성 (video_id 제거)
                    transcript_data = {
                        "youtube_link": item.get("youtube_link"),
                        "language": item.get("language"),
                        "collected_at": item.get("collected_at"),
                        "transcript": item.get("transcript"),
                        "recollect_id": 0,
                        "recollect_reason": "migration",
                    }

                    with open(output_file, "w", encoding="utf-8") as out_f:
                        out_f.write(
                            json.dumps(transcript_data, ensure_ascii=False) + "\n"
                        )
                    stats["success"] += 1

                except Exception as e:
                    stats["error"] += 1
                    print(f"  ❌ 오류: {e}")

        except Exception as e:
            print(f"  ❌ 파일 오류: {e}")

    print(f"\n✅ transcript 마이그레이션 완료")
    print(
        f"   총: {stats['total']}, 성공: {stats['success']}, 스킵: {stats['skipped']}, 오류: {stats['error']}"
    )
    return stats


def migrate_crawling(backup_dir: Path, output_dir: Path, channel: str = "tzuyang"):
    """
    crawling 데이터 마이그레이션
    입력: backup/geminiCLI-restaurant-crawling/data/{yy-mm-dd}/tzuyang_restaurant_results_with_meta.jsonl
    출력: restaurant-crawling/data/{channel}/crawling/{video_id}.jsonl
    """
    crawling_backup = backup_dir / "geminiCLI-restaurant-crawling" / "data"
    output_crawling_dir = (
        output_dir / "restaurant-crawling" / "data" / channel / "crawling"
    )
    output_crawling_dir.mkdir(parents=True, exist_ok=True)

    stats = {"total": 0, "success": 0, "skipped": 0, "error": 0}

    # 모든 날짜 폴더 순회
    for date_folder in sorted(crawling_backup.iterdir()):
        if not date_folder.is_dir():
            continue
        if date_folder.name.startswith("no_"):
            continue

        input_file = date_folder / "tzuyang_restaurant_results_with_meta.jsonl"
        if not input_file.exists():
            continue

        print(f"\n📂 처리 중: {date_folder.name}")

        with open(input_file, "r", encoding="utf-8") as f:
            for line in f:
                stats["total"] += 1
                try:
                    data = json.loads(line.strip())
                    video_id = extract_video_id(data.get("youtube_link"))

                    if not video_id:
                        stats["error"] += 1
                        continue

                    output_file = output_crawling_dir / f"{video_id}.jsonl"

                    # 이미 존재하면 스킵
                    if output_file.exists():
                        stats["skipped"] += 1
                        continue

                    # restaurants 변환 (name → origin_name)
                    restaurants = convert_restaurants(data.get("restaurants", []))

                    # 출력 데이터 구성
                    output_data = {
                        "youtube_link": data.get("youtube_link"),
                        "restaurants": restaurants,
                        "channel_name": channel,
                        "recollect_version": {"meta": 0, "transcript": 0},
                    }

                    # 저장
                    with open(output_file, "w", encoding="utf-8") as out_f:
                        out_f.write(json.dumps(output_data, ensure_ascii=False) + "\n")

                    stats["success"] += 1

                except Exception as e:
                    stats["error"] += 1
                    print(f"  ❌ 오류: {e}")

    print(f"\n✅ crawling 마이그레이션 완료")
    print(
        f"   총: {stats['total']}, 성공: {stats['success']}, 스킵: {stats['skipped']}, 오류: {stats['error']}"
    )
    return stats


def migrate_selection(backup_dir: Path, output_dir: Path, channel: str = "tzuyang"):
    """
    selection 데이터 마이그레이션
    입력: backup/geminiCLI-restaurant-evaluation/data/{yy-mm-dd}/tzuyang_restaurant_evaluation_selection.jsonl
    출력: restaurant-evaluation/data/{channel}/evaluation/selection/{video_id}.jsonl
    """
    eval_backup = backup_dir / "geminiCLI-restaurant-evaluation" / "data"
    output_selection_dir = (
        output_dir
        / "restaurant-evaluation"
        / "data"
        / channel
        / "evaluation"
        / "selection"
    )
    output_not_selection_dir = (
        output_dir
        / "restaurant-evaluation"
        / "data"
        / channel
        / "evaluation"
        / "notSelection"
    )
    output_selection_dir.mkdir(parents=True, exist_ok=True)
    output_not_selection_dir.mkdir(parents=True, exist_ok=True)

    stats = {"total": 0, "success": 0, "skipped": 0, "notSelection": 0, "error": 0}

    for date_folder in sorted(eval_backup.iterdir()):
        if not date_folder.is_dir():
            continue

        input_file = date_folder / "tzuyang_restaurant_evaluation_selection.jsonl"
        if not input_file.exists():
            continue

        print(f"\n📂 처리 중: {date_folder.name}")

        with open(input_file, "r", encoding="utf-8") as f:
            for line in f:
                stats["total"] += 1
                try:
                    data = json.loads(line.strip())
                    video_id = extract_video_id(data.get("youtube_link"))

                    if not video_id:
                        stats["error"] += 1
                        continue

                    # restaurants 변환 (name → origin_name)
                    restaurants = data.get("restaurants", [])
                    for r in restaurants:
                        if "name" in r:
                            r["origin_name"] = r.pop("name")

                    # 출력 데이터 구성 (youtube_meta 제거)
                    output_data = {
                        "youtube_link": data.get("youtube_link"),
                        "channel_name": channel,
                        "evaluation_target": data.get("evaluation_target", {}),
                        "restaurants": restaurants,
                        "recollect_version": {"meta": 0, "transcript": 0},
                    }

                    # notSelection 여부 확인
                    is_not_selected = data.get("is_notSelected", False)

                    if is_not_selected:
                        output_data["is_notSelected"] = True
                        output_data["notSelected_reason"] = data.get(
                            "notSelected_reason", "unknown"
                        )
                        output_file = output_not_selection_dir / f"{video_id}.jsonl"
                        stats["notSelection"] += 1
                    else:
                        output_file = output_selection_dir / f"{video_id}.jsonl"

                    # 이미 존재하면 스킵
                    if output_file.exists():
                        stats["skipped"] += 1
                        continue

                    # 저장
                    with open(output_file, "w", encoding="utf-8") as out_f:
                        out_f.write(json.dumps(output_data, ensure_ascii=False) + "\n")

                    stats["success"] += 1

                except Exception as e:
                    stats["error"] += 1
                    print(f"  ❌ 오류: {e}")

    print(f"\n✅ selection 마이그레이션 완료")
    print(
        f"   총: {stats['total']}, 성공: {stats['success']}, 스킵: {stats['skipped']}, notSelection: {stats['notSelection']}, 오류: {stats['error']}"
    )
    return stats


def migrate_not_selection(backup_dir: Path, output_dir: Path, channel: str = "tzuyang"):
    """
    notSelection 데이터 마이그레이션 (별도 파일)
    입력: backup/geminiCLI-restaurant-evaluation/data/{yy-mm-dd}/tzuyang_restaurant_evaluation_notSelection_with_addressNull.jsonl
    출력: restaurant-evaluation/data/{channel}/evaluation/notSelection/{video_id}.jsonl
    """
    eval_backup = backup_dir / "geminiCLI-restaurant-evaluation" / "data"
    output_not_selection_dir = (
        output_dir
        / "restaurant-evaluation"
        / "data"
        / channel
        / "evaluation"
        / "notSelection"
    )
    output_not_selection_dir.mkdir(parents=True, exist_ok=True)

    stats = {"total": 0, "success": 0, "skipped": 0, "error": 0}

    for date_folder in sorted(eval_backup.iterdir()):
        if not date_folder.is_dir():
            continue

        input_file = (
            date_folder
            / "tzuyang_restaurant_evaluation_notSelection_with_addressNull.jsonl"
        )
        if not input_file.exists():
            continue

        print(f"\n📂 처리 중: {date_folder.name}")

        with open(input_file, "r", encoding="utf-8") as f:
            for line in f:
                stats["total"] += 1
                try:
                    data = json.loads(line.strip())
                    video_id = extract_video_id(data.get("youtube_link"))

                    if not video_id:
                        stats["error"] += 1
                        continue

                    output_file = output_not_selection_dir / f"{video_id}.jsonl"

                    if output_file.exists():
                        stats["skipped"] += 1
                        continue

                    # restaurants 변환 (name → origin_name, 맨 앞에 배치)
                    restaurants = data.get("restaurants", [])
                    new_restaurants = []
                    for r in restaurants:
                        origin_name = r.pop("name", None)
                        new_r = {"origin_name": origin_name}
                        new_r.update(r)
                        new_restaurants.append(new_r)
                    restaurants = new_restaurants

                    output_data = {
                        "youtube_link": data.get("youtube_link"),
                        "channel_name": channel,
                        "evaluation_target": data.get("evaluation_target", {}),
                        "restaurants": restaurants,
                        "recollect_version": {"meta": 0, "transcript": 0},
                        "is_notSelected": True,
                        "notSelected_reason": data.get(
                            "notSelected_reason", "address_null"
                        ),
                    }

                    with open(output_file, "w", encoding="utf-8") as out_f:
                        out_f.write(json.dumps(output_data, ensure_ascii=False) + "\n")

                    stats["success"] += 1

                except Exception as e:
                    stats["error"] += 1
                    print(f"  ❌ 오류: {e}")

    print(f"\n✅ notSelection 마이그레이션 완료")
    print(
        f"   총: {stats['total']}, 성공: {stats['success']}, 스킵: {stats['skipped']}, 오류: {stats['error']}"
    )
    return stats


def migrate_rule_results(backup_dir: Path, output_dir: Path, channel: str = "tzuyang"):
    """
    rule_results 데이터 마이그레이션
    입력: backup/geminiCLI-restaurant-evaluation/data/{yy-mm-dd}/tzuyang_restaurant_evaluation_rule_results.jsonl
    출력: restaurant-evaluation/data/{channel}/evaluation/rule_results/{video_id}.jsonl
    """
    eval_backup = backup_dir / "geminiCLI-restaurant-evaluation" / "data"
    output_dir_path = (
        output_dir
        / "restaurant-evaluation"
        / "data"
        / channel
        / "evaluation"
        / "rule_results"
    )
    output_dir_path.mkdir(parents=True, exist_ok=True)

    stats = {"total": 0, "success": 0, "skipped": 0, "error": 0}

    for date_folder in sorted(eval_backup.iterdir()):
        if not date_folder.is_dir():
            continue

        input_file = date_folder / "tzuyang_restaurant_evaluation_rule_results.jsonl"
        if not input_file.exists():
            continue

        print(f"\n📂 처리 중: {date_folder.name}")

        with open(input_file, "r", encoding="utf-8") as f:
            for line in f:
                stats["total"] += 1
                try:
                    data = json.loads(line.strip())
                    video_id = extract_video_id(data.get("youtube_link"))

                    if not video_id:
                        stats["error"] += 1
                        continue

                    output_file = output_dir_path / f"{video_id}.jsonl"

                    if output_file.exists():
                        stats["skipped"] += 1
                        continue

                    # restaurants 변환
                    restaurants = data.get("restaurants", [])
                    for r in restaurants:
                        if "name" in r:
                            r["origin_name"] = r.pop("name")

                    output_data = {
                        "youtube_link": data.get("youtube_link"),
                        "channel_name": channel,
                        "evaluation_target": data.get("evaluation_target", {}),
                        "evaluation_results": data.get("evaluation_results", {}),
                        "restaurants": restaurants,
                        "recollect_version": {"meta": 0, "transcript": 0},
                    }

                    with open(output_file, "w", encoding="utf-8") as out_f:
                        out_f.write(json.dumps(output_data, ensure_ascii=False) + "\n")

                    stats["success"] += 1

                except Exception as e:
                    stats["error"] += 1
                    print(f"  ❌ 오류: {e}")

    print(f"\n✅ rule_results 마이그레이션 완료")
    print(
        f"   총: {stats['total']}, 성공: {stats['success']}, 스킵: {stats['skipped']}, 오류: {stats['error']}"
    )
    return stats


def migrate_laaj_results(backup_dir: Path, output_dir: Path, channel: str = "tzuyang"):
    """
    laaj_results 데이터 마이그레이션
    입력: backup/geminiCLI-restaurant-evaluation/data/{yy-mm-dd}/tzuyang_restaurant_evaluation_results.jsonl
    출력: restaurant-evaluation/data/{channel}/evaluation/laaj_results/{video_id}.jsonl
    """
    eval_backup = backup_dir / "geminiCLI-restaurant-evaluation" / "data"
    output_dir_path = (
        output_dir
        / "restaurant-evaluation"
        / "data"
        / channel
        / "evaluation"
        / "laaj_results"
    )
    output_dir_path.mkdir(parents=True, exist_ok=True)

    stats = {"total": 0, "success": 0, "skipped": 0, "error": 0}

    for date_folder in sorted(eval_backup.iterdir()):
        if not date_folder.is_dir():
            continue

        input_file = date_folder / "tzuyang_restaurant_evaluation_results.jsonl"
        if not input_file.exists():
            continue

        print(f"\n📂 처리 중: {date_folder.name}")

        with open(input_file, "r", encoding="utf-8") as f:
            for line in f:
                stats["total"] += 1
                try:
                    data = json.loads(line.strip())
                    video_id = extract_video_id(data.get("youtube_link"))

                    if not video_id:
                        stats["error"] += 1
                        continue

                    output_file = output_dir_path / f"{video_id}.jsonl"

                    if output_file.exists():
                        stats["skipped"] += 1
                        continue

                    # restaurants 변환
                    restaurants = data.get("restaurants", [])
                    for r in restaurants:
                        if "name" in r:
                            r["origin_name"] = r.pop("name")

                    output_data = {
                        "youtube_link": data.get("youtube_link"),
                        "channel_name": channel,
                        "evaluation_target": data.get("evaluation_target", {}),
                        "evaluation_results": data.get("evaluation_results", {}),
                        "restaurants": restaurants,
                        "recollect_version": {"meta": 0, "transcript": 0},
                    }

                    with open(output_file, "w", encoding="utf-8") as out_f:
                        out_f.write(json.dumps(output_data, ensure_ascii=False) + "\n")

                    stats["success"] += 1

                except Exception as e:
                    stats["error"] += 1
                    print(f"  ❌ 오류: {e}")

    print(f"\n✅ laaj_results 마이그레이션 완료")
    print(
        f"   총: {stats['total']}, 성공: {stats['success']}, 스킵: {stats['skipped']}, 오류: {stats['error']}"
    )
    return stats


def migrate_transforms(backup_dir: Path, output_dir: Path, channel: str = "tzuyang"):
    """
    transforms 데이터 마이그레이션
    입력: backup/geminiCLI-restaurant-evaluation/data/{yy-mm-dd}/tzuyang_restaurant_transforms.jsonl
    출력: restaurant-evaluation/data/{channel}/evaluation/transforms.jsonl (통합 파일)
    """
    eval_backup = backup_dir / "geminiCLI-restaurant-evaluation" / "data"
    output_file = (
        output_dir
        / "restaurant-evaluation"
        / "data"
        / channel
        / "evaluation"
        / "transforms.jsonl"
    )
    output_file.parent.mkdir(parents=True, exist_ok=True)

    # 기존 trace_id 수집
    existing_trace_ids = set()
    if output_file.exists():
        with open(output_file, "r", encoding="utf-8") as f:
            for line in f:
                try:
                    data = json.loads(line.strip())
                    tid = data.get("trace_id")
                    if tid:
                        existing_trace_ids.add(tid)
                except:
                    pass

    print(f"기존 trace_id: {len(existing_trace_ids)}개")

    stats = {"total": 0, "success": 0, "skipped": 0, "error": 0}

    with open(output_file, "a", encoding="utf-8") as out_f:
        for date_folder in sorted(eval_backup.iterdir()):
            if not date_folder.is_dir():
                continue

            input_file = date_folder / "tzuyang_restaurant_transforms.jsonl"
            if not input_file.exists():
                continue

            print(f"\n📂 처리 중: {date_folder.name}")

            with open(input_file, "r", encoding="utf-8") as f:
                for line in f:
                    stats["total"] += 1
                    try:
                        data = json.loads(line.strip())

                        # unique_id → trace_id
                        trace_id = data.get("unique_id")
                        if trace_id in existing_trace_ids:
                            stats["skipped"] += 1
                            continue

                        # 키 변환
                        output_data = {
                            "youtube_link": data.get("youtube_link"),
                            "trace_id": trace_id,
                            "channel_name": channel,
                            "status": data.get("status", "pending"),
                            "youtube_meta": data.get(
                                "youtube_meta"
                            ),  # transforms에는 유지
                            "origin_name": data.get("name"),
                            "naver_name": None,
                            "trace_id_name_source": "original",
                            "phone": data.get("phone"),
                            "category": data.get("category"),
                            "reasoning_basis": data.get("reasoning_basis"),
                            "youtuber_review": data.get("tzuyang_review"),
                            "origin_address": data.get("origin_address"),
                            "roadAddress": data.get("roadAddress"),
                            "jibunAddress": data.get("jibunAddress"),
                            "englishAddress": data.get("englishAddress"),
                            "addressElements": data.get("addressElements"),
                            "lat": data.get("lat"),
                            "lng": data.get("lng"),
                            "geocoding_success": data.get("geocoding_success"),
                            "geocoding_false_stage": data.get("geocoding_false_stage"),
                            "is_missing": data.get("is_missing", False),
                            "is_notSelected": data.get("is_notSelected", False),
                            "evaluation_results": data.get("evaluation_results"),
                            "source_type": data.get("source_type", "geminiCLI"),
                            "description_map_url": data.get("description_map_url"),
                            "recollect_version": {"meta": 0, "transcript": 0},
                        }

                        out_f.write(json.dumps(output_data, ensure_ascii=False) + "\n")
                        existing_trace_ids.add(trace_id)
                        stats["success"] += 1

                    except Exception as e:
                        stats["error"] += 1
                        print(f"  ❌ 오류: {e}")

    print(f"\n✅ transforms 마이그레이션 완료")
    print(
        f"   총: {stats['total']}, 성공: {stats['success']}, 스킵: {stats['skipped']}, 오류: {stats['error']}"
    )
    return stats


def main():
    parser = argparse.ArgumentParser(description="백업 데이터 마이그레이션")
    parser.add_argument("--backup-dir", required=True, help="백업 디렉토리 경로")
    parser.add_argument("--output-dir", required=True, help="출력 디렉토리 경로")
    parser.add_argument("--channel", default="tzuyang", help="채널 이름")
    parser.add_argument(
        "--target",
        choices=[
            "all",
            "urls",
            "meta",
            "transcript",
            "crawling",
            "selection",
            "not_selection",
            "rule_results",
            "laaj_results",
            "transforms",
        ],
        default="all",
        help="마이그레이션 대상",
    )
    args = parser.parse_args()

    backup_dir = Path(args.backup_dir)
    output_dir = Path(args.output_dir)

    if not backup_dir.exists():
        print(f"❌ 백업 디렉토리 없음: {backup_dir}")
        return 1

    print(f"=" * 60)
    print(f"백업 데이터 마이그레이션 시작")
    print(f"=" * 60)
    print(f"백업 디렉토리: {backup_dir}")
    print(f"출력 디렉토리: {output_dir}")
    print(f"채널: {args.channel}")
    print(f"대상: {args.target}")
    print()

    if args.target in ["all", "urls"]:
        print("\n" + "=" * 40)
        print("0. urls 마이그레이션")
        print("=" * 40)
        migrate_urls(backup_dir, output_dir, args.channel)

    if args.target in ["all", "meta"]:
        print("\n" + "=" * 40)
        print("0.5. meta 마이그레이션")
        print("=" * 40)
        migrate_meta(backup_dir, output_dir, args.channel)

    if args.target in ["all", "transcript"]:
        print("\n" + "=" * 40)
        print("0.7. transcript 마이그레이션")
        print("=" * 40)
        migrate_transcript(backup_dir, output_dir, args.channel)

    if args.target in ["all", "crawling"]:
        print("\n" + "=" * 40)
        print("1. crawling 마이그레이션")
        print("=" * 40)
        migrate_crawling(backup_dir, output_dir, args.channel)

    if args.target in ["all", "selection"]:
        print("\n" + "=" * 40)
        print("2. selection 마이그레이션")
        print("=" * 40)
        migrate_selection(backup_dir, output_dir, args.channel)

    if args.target in ["all", "not_selection"]:
        print("\n" + "=" * 40)
        print("2.5. notSelection 마이그레이션")
        print("=" * 40)
        migrate_not_selection(backup_dir, output_dir, args.channel)

    if args.target in ["all", "rule_results"]:
        print("\n" + "=" * 40)
        print("3. rule_results 마이그레이션")
        print("=" * 40)
        migrate_rule_results(backup_dir, output_dir, args.channel)

    if args.target in ["all", "laaj_results"]:
        print("\n" + "=" * 40)
        print("4. laaj_results 마이그레이션")
        print("=" * 40)
        migrate_laaj_results(backup_dir, output_dir, args.channel)

    if args.target in ["all", "transforms"]:
        print("\n" + "=" * 40)
        print("5. transforms 마이그레이션")
        print("=" * 40)
        migrate_transforms(backup_dir, output_dir, args.channel)

    print("\n" + "=" * 60)
    print("✅ 마이그레이션 완료!")
    print("=" * 60)

    return 0


if __name__ == "__main__":
    exit(main())
