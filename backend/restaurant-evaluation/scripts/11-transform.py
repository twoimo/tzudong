#!/usr/bin/env python3
"""
평가 결과 변환 스크립트
laaj_results, map_url_crawling 데이터를 최종 형식으로 변환합니다.

채널별 폴더 구조:
- 입력:
  - evaluation/laaj_results/{video_id}.jsonl
  - evaluation/notSelection/{video_id}.jsonl
  - map_url_crawling/{video_id}.jsonl  ← 정육왕 전용
- 출력:
  - evaluation/transforms.jsonl (채널별로 각각)

- trace_id = hash(youtube_link + (naver_name || name) + youtuber_review)
- trace_id_name_source: "naver_name" or "original"
- source_type: "geminiCLI" or "map_url_crawling"
"""

import json
import re

def get_video_id(url):
    if not url: return None
    patterns = [
        r'(?:v=|\/)([0-9A-Za-z_-]{11}).*',
        r'(?:embed\/|v\/|shorts\/|watch\?v=|youtu\.be\/)([0-9A-Za-z_-]{11})',
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None
import hashlib
import sys
import argparse
from pathlib import Path
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone, timedelta

# 한국 시간대
KST = timezone(timedelta(hours=9))


def generate_trace_id(youtube_link: str, name: str, review: str) -> str:
    """
    trace_id 생성
    youtube_link, name(또는 naver_name), youtuber_review를 조합하여 SHA-256 해시 ID 생성
    """
    key_string = str(youtube_link or "") + str(name or "") + str(review or "")
    return hashlib.sha256(key_string.encode("utf-8")).hexdigest()


def get_eval_item(eval_results: dict, rest_name: str, key: str) -> Optional[dict]:
    """evaluation_results에서 항목 찾기
    - Rule 평가 항목 (category_validity_TF): origin_name으로 매칭
    - LAAJ 평가 항목: name으로 매칭
    """
    if not eval_results:
        return None

    value = eval_results.get(key)
    if not value:
        return None

    item_list = []
    if isinstance(value, dict) and "values" in value:
        item_list = value["values"]
    elif isinstance(value, list):
        item_list = value

    # 모든 평가 항목이 이제 name으로 매칭됨 (location_match_TF는 별도 처리)
    match_key = "name"

    found_item = next(
        (item for item in item_list if item.get(match_key) == rest_name), None
    )

    if found_item:
        new_item = found_item.copy()
        if match_key in new_item:
            del new_item[match_key]
        return new_item
    return None


def get_location_data(
    eval_results: dict, rest_name: str, is_missing_flag: bool, source_file_type: str
) -> dict:
    """location_match_TF에서 위치 데이터 추출 (기존 backup 로직 그대로)"""
    loc_data = {
        "naver_name": None,  # ★ 추가
        "roadAddress": None,
        "jibunAddress": None,
        "englishAddress": None,
        "addressElements": None,
        "geocoding_success": False,
        "geocoding_false_stage": None,
        "lat": None,
        "lng": None,
    }

    loc_match_item = None
    if eval_results:
        loc_match_list = eval_results.get("location_match_TF", [])
        loc_match_item = next(
            (item for item in loc_match_list if item.get("origin_name") == rest_name),
            None,
        )

    if loc_match_item:
        loc_data["naver_name"] = loc_match_item.get("naver_name")  # ★ 추가
        loc_data["geocoding_success"] = loc_match_item.get("eval_value", False)

        if not loc_data["geocoding_success"]:
            false_message = loc_match_item.get("falseMessage", "")
            if "1단계 실패" in false_message:
                loc_data["geocoding_false_stage"] = 1
            elif "2단계 실패" in false_message:
                loc_data["geocoding_false_stage"] = 2

        naver_address = loc_match_item.get("naver_address")
        if naver_address and len(naver_address) > 0:
            naver_address_data = naver_address[0]
            loc_data["roadAddress"] = naver_address_data.get("roadAddress")
            loc_data["jibunAddress"] = naver_address_data.get("jibunAddress")
            loc_data["englishAddress"] = naver_address_data.get("englishAddress")
            loc_data["addressElements"] = naver_address_data.get("addressElements")
            # 좌표 추가 (x=경도, y=위도)
            x = naver_address_data.get("x")
            y = naver_address_data.get("y")
            if x and y:
                try:
                    loc_data["lng"] = float(x)  # x = 경도 (longitude)
                    loc_data["lat"] = float(y)  # y = 위도 (latitude)
                except (ValueError, TypeError):
                    pass

    if source_file_type == "results" and is_missing_flag:
        loc_data["geocoding_false_stage"] = None
    elif source_file_type == "notSelection":
        loc_data["geocoding_false_stage"] = 0

    return loc_data


def transform_json_object(
    original_data: dict,
    source_file_type: str,
    channel_name: str,
    meta_dir: Path = None,
    video_id: str = None,
) -> List[dict]:
    """
    하나의 원본 JSON 객체를 변환 (기존 backup 로직 그대로)
    """
    flattened_results = []

    youtube_link = original_data.get("youtube_link")
    original_eval_results = original_data.get("evaluation_results")
    restaurants_list = original_data.get("restaurants", [])
    evaluation_targets = original_data.get("evaluation_target", {})

    # youtube_meta는 앞 단계(09-rule, 10-laaj)에서 이미 결합되어 넘어옴
    youtube_meta = original_data.get("youtube_meta", {})
    
    # 만약 앞 단계에서 결합 안 된 경우 (구버전 데이터 등) 대비하여 최소한의 fallback만 유지하거나
    # 아예 신뢰하고 그대로 사용. 여기서는 그대로 사용하되, 없으면 빈 딕셔너리.
    if not youtube_meta:
        # 혹시 모르니 map_info 등에서 가져올 수도 있지만, 
        # 이제 09-rule에서 처리하므로 여기선 pass
        pass

    # results 파일 처리
    if source_file_type == "results":
        processed_names = set()

        # 1A. restaurants 리스트 기준 처리
        for restaurant_data in restaurants_list:
            # Gemini 출력이 origin_name 필드 사용
            restaurant_name = restaurant_data.get("origin_name")
            if not restaurant_name:
                continue

            processed_names.add(restaurant_name)
            is_target = evaluation_targets.get(restaurant_name, True)

            loc_data = get_location_data(
                original_eval_results,
                restaurant_name,
                is_missing_flag=False,
                source_file_type=source_file_type,
            )

            # 평가 결과 추출
            new_eval_results = {}
            if original_eval_results:
                for key in original_eval_results:
                    if key == "location_match_TF":
                        continue
                    if key == "visit_authenticity":
                        visit_auth_values = original_eval_results.get(
                            "visit_authenticity", {}
                        ).get("values", [])
                        visit_auth_item = next(
                            (
                                item
                                for item in visit_auth_values
                                if item.get("name") == restaurant_name
                            ),
                            None,
                        )
                        if visit_auth_item:
                            new_visit_item = visit_auth_item.copy()
                            if "name" in new_visit_item:
                                del new_visit_item["name"]
                            new_eval_results["visit_authenticity"] = new_visit_item
                    else:
                        eval_item = get_eval_item(
                            original_eval_results, restaurant_name, key
                        )
                        if eval_item:
                            new_eval_results[key] = eval_item

            youtuber_review = restaurant_data.get("youtuber_review")

            # trace_id 생성: naver_name이 있으면 naver_name, 없으면 원본 name
            naver_name = loc_data.get("naver_name")
            trace_id_name = naver_name or restaurant_name
            trace_id_name_source = "naver" if naver_name else "original"

            output = {
                "youtube_link": youtube_link,
                "trace_id": generate_trace_id(
                    youtube_link, trace_id_name, youtuber_review
                ),
                "channel_name": channel_name,
                "status": "pending",
                "youtube_meta": youtube_meta,
                "origin_name": restaurant_name,
                "naver_name": naver_name,  # 없으면 null 그대로
                "trace_id_name_source": trace_id_name_source,
                "category": restaurant_data.get("category"),
                "reasoning_basis": restaurant_data.get("reasoning_basis"),
                "youtuber_review": youtuber_review,
                "origin_address": {
                    "address": restaurant_data.get("address"),
                    "lat": restaurant_data.get("lat"),
                    "lng": restaurant_data.get("lng"),
                },
                "roadAddress": loc_data["roadAddress"],
                "jibunAddress": loc_data["jibunAddress"],
                "englishAddress": loc_data["englishAddress"],
                "addressElements": loc_data["addressElements"],
                "lat": loc_data["lat"],
                "lng": loc_data["lng"],
                "geocoding_success": loc_data["geocoding_success"],
                "geocoding_false_stage": loc_data["geocoding_false_stage"],
                "is_missing": False,
                "is_notSelected": not is_target,
                "evaluation_results": new_eval_results if new_eval_results else None,
                "source_type": "geminiCLI",
                "description_map_url": None,  # 쯔양은 null
                "recollect_version": recollect_version,
            }
            flattened_results.append(output)

        # 1B. evaluation_target에만 있는 항목 (Missing)
        for restaurant_name, is_target in evaluation_targets.items():
            if restaurant_name not in processed_names:
                processed_names.add(restaurant_name)
                loc_data = get_location_data(
                    original_eval_results,
                    restaurant_name,
                    is_missing_flag=True,
                    source_file_type=source_file_type,
                )

                # Missing 항목은 평가 안 됐으므로 naver_name 없음
                output = {
                    "youtube_link": youtube_link,
                    "trace_id": generate_trace_id(youtube_link, restaurant_name, None),
                    "channel_name": channel_name,
                    "status": "pending",
                    "youtube_meta": youtube_meta,
                    "origin_name": restaurant_name,
                    "naver_name": None,  # Missing은 항상 null
                    "trace_id_name_source": "original",
                    "category": None,
                    "reasoning_basis": None,
                    "youtuber_review": None,
                    "origin_address": None,
                    "roadAddress": loc_data["roadAddress"],
                    "jibunAddress": loc_data["jibunAddress"],
                    "englishAddress": loc_data["englishAddress"],
                    "addressElements": loc_data["addressElements"],
                    "lat": loc_data["lat"],
                    "lng": loc_data["lng"],
                    "geocoding_success": loc_data["geocoding_success"],
                    "geocoding_false_stage": loc_data["geocoding_false_stage"],
                    "is_missing": True,
                    "is_notSelected": not is_target,
                    "evaluation_results": None,
                    "source_type": "geminiCLI",
                    "description_map_url": None,  # 쯔양은 null
                    "recollect_version": recollect_version,
                }
                flattened_results.append(output)

        # 1C. visit_authenticity.missing에만 있는 항목
        if original_eval_results:
            missing_list = original_eval_results.get("visit_authenticity", {}).get(
                "missing", []
            )
            for missing_item in missing_list:
                if isinstance(missing_item, str):
                    missing_name = missing_item
                elif isinstance(missing_item, dict):
                    missing_name = missing_item.get("name")
                else:
                    continue

                if not missing_name or missing_name in processed_names:
                    continue

                processed_names.add(missing_name)
                loc_data = get_location_data(
                    original_eval_results,
                    missing_name,
                    is_missing_flag=True,
                    source_file_type=source_file_type,
                )

                # Missing 항목은 평가 안 됐으므로 naver_name 없음
                output = {
                    "youtube_link": youtube_link,
                    "trace_id": generate_trace_id(youtube_link, missing_name, None),
                    "channel_name": channel_name,
                    "status": "pending",
                    "youtube_meta": youtube_meta,
                    "origin_name": missing_name,
                    "naver_name": None,  # Missing은 항상 null
                    "trace_id_name_source": "original",
                    "category": None,
                    "reasoning_basis": None,
                    "youtuber_review": None,
                    "origin_address": None,
                    "roadAddress": loc_data["roadAddress"],
                    "jibunAddress": loc_data["jibunAddress"],
                    "englishAddress": loc_data["englishAddress"],
                    "addressElements": loc_data["addressElements"],
                    "lat": loc_data["lat"],
                    "lng": loc_data["lng"],
                    "geocoding_success": loc_data["geocoding_success"],
                    "geocoding_false_stage": loc_data["geocoding_false_stage"],
                    "is_missing": True,
                    "is_notSelected": False,
                    "evaluation_results": None,
                    "source_type": "geminiCLI",
                    "description_map_url": None,  # 쯔양은 null
                    "recollect_version": recollect_version,
                }
                flattened_results.append(output)

    # notSelection 파일 처리
    elif source_file_type == "notSelection":
        for restaurant_data in restaurants_list:
            restaurant_name = restaurant_data.get("origin_name")
            if not restaurant_name:
                continue

            youtuber_review = restaurant_data.get("youtuber_review")

            output = {
                "youtube_link": youtube_link,
                "trace_id": generate_trace_id(
                    youtube_link, restaurant_name, youtuber_review
                ),
                "channel_name": channel_name,
                "status": "pending",
                "youtube_meta": youtube_meta,
                "origin_name": restaurant_name,
                "naver_name": None,  # notSelection은 평가 안 하므로 null
                "trace_id_name_source": "original",
                "category": restaurant_data.get("category"),
                "reasoning_basis": restaurant_data.get("reasoning_basis"),
                "youtuber_review": youtuber_review,
                "origin_address": {
                    "address": restaurant_data.get("address"),
                    "lat": restaurant_data.get("lat"),
                    "lng": restaurant_data.get("lng"),
                },
                "roadAddress": None,
                "jibunAddress": None,
                "englishAddress": None,
                "addressElements": None,
                "lat": None,
                "lng": None,
                "geocoding_success": False,
                "geocoding_false_stage": 0,
                "is_missing": False,
                "is_notSelected": True,
                "evaluation_results": None,
                "source_type": "geminiCLI",
                "description_map_url": None,  # 쯔양은 null
                "recollect_version": recollect_version,
            }
            flattened_results.append(output)

    return flattened_results


def transform_map_url_crawling_object(
    original_data: dict, channel_name: str, meta_dir: Path
) -> List[dict]:
    """
    map_url_crawling 데이터를 변환 (정육왕 전용, 평가 스킵)
    """
    flattened_results = []

    youtube_link = original_data.get("youtube_link")
    recollect_version = original_data.get("recollect_version", {})
    restaurants_list = original_data.get("restaurants", [])

    # youtube_meta는 앞 단계에서 결합되어 있음
    youtube_meta = original_data.get("youtube_meta", {})
    if not youtube_meta:
        pass

    for restaurant_data in restaurants_list:
        origin_name = restaurant_data.get("origin_name")  # 크롤링에서 받은 원본
        if not origin_name:
            continue

        youtuber_review = restaurant_data.get("youtuber_review")
        naver_name = restaurant_data.get("naver_name")  # 네이버 검색 결과

        # trace_id 생성: naver_name 있으면 naver_name, 없으면 origin_name
        trace_id_name = naver_name or origin_name

        output = {
            "youtube_link": youtube_link,
            "trace_id": generate_trace_id(youtube_link, trace_id_name, youtuber_review),
            "channel_name": channel_name,
            "status": "pending",
            "youtube_meta": youtube_meta,
            "origin_name": origin_name,  # 크롤링에서 받은 원본 상호명
            "naver_name": naver_name,  # 네이버 검색 결과 상호명
            "trace_id_name_source": "naver" if naver_name else "original",
            "category": restaurant_data.get("category"),
            "reasoning_basis": restaurant_data.get(
                "reasoning_basis"
            ),  # map_url_crawling에서 추출
            "youtuber_review": youtuber_review,
            "origin_address": None,  # map_url_crawling은 origin_address 없음 (지오코딩 주소가 최종)
            "roadAddress": restaurant_data.get("roadAddress"),
            "jibunAddress": restaurant_data.get("jibunAddress"),
            "englishAddress": restaurant_data.get("englishAddress"),
            "addressElements": restaurant_data.get("addressElements"),
            "lat": restaurant_data.get("lat"),
            "lng": restaurant_data.get("lng"),
            "geocoding_success": True,  # map_url_crawling은 항상 성공 (검증 통과했으므로)
            "geocoding_false_stage": None,
            "is_missing": False,
            "is_notSelected": False,
            "evaluation_results": None,  # 평가 스킵
            "source_type": "map_url_crawling",
            "description_map_url": restaurant_data.get(
                "description_map_url"
            ),  # 원본 네이버 지도 URL
            "recollect_version": recollect_version,
        }
        flattened_results.append(output)

    return flattened_results


def main():
    parser = argparse.ArgumentParser(description="평가 결과 변환")
    parser.add_argument("--channel", "-c", required=True, help="채널 이름")
    parser.add_argument(
        "--crawling-path",
        required=True,
        help="크롤링 데이터 경로 (meta, map_url_crawling)",
    )
    parser.add_argument("--evaluation-path", required=True, help="평가 데이터 경로")
    args = parser.parse_args()

    channel = args.channel
    crawling_path = Path(args.crawling_path)
    evaluation_path = Path(args.evaluation_path)

    print(f"\n[{datetime.now(KST).strftime('%H:%M:%S')}] Transform 시작: {channel}")
    print(f"크롤링 경로: {crawling_path}")
    print(f"평가 경로: {evaluation_path}")

    # 입력 폴더 (evaluation 경로)
    laaj_results_dir = evaluation_path / "evaluation" / "laaj_results"
    not_selection_dir = evaluation_path / "evaluation" / "notSelection"

    # 입력 폴더 (crawling 경로)
    map_url_crawling_dir = crawling_path / "map_url_crawling"  # ← 정육왕 전용
    meta_dir = crawling_path / "meta"

    # 출력 파일 (evaluation 경로)
    output_file = evaluation_path / "evaluation" / "transforms.jsonl"
    output_file.parent.mkdir(parents=True, exist_ok=True)

    # 기존 trace_id 수집 (중복 방지)
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

    # 통계
    stats = {
        "total_files": 0,
        "total_records": 0,
        "new_records": 0,
        "skipped_records": 0,
    }

    # laaj_results 처리
    if laaj_results_dir.exists():
        for f in laaj_results_dir.glob("*.jsonl"):
            stats["total_files"] += 1
            video_id = f.stem  # video_id 추출
            with open(f, "r", encoding="utf-8") as file:
                for line in file:
                    try:
                        data = json.loads(line.strip())
                        transformed = transform_json_object(
                            data, "results", channel, meta_dir, video_id
                        )

                        for record in transformed:
                            stats["total_records"] += 1
                            if record["trace_id"] not in existing_trace_ids:
                                with open(output_file, "a", encoding="utf-8") as out:
                                    out.write(
                                        json.dumps(record, ensure_ascii=False) + "\n"
                                    )
                                existing_trace_ids.add(record["trace_id"])
                                stats["new_records"] += 1
                            else:
                                stats["skipped_records"] += 1
                    except json.JSONDecodeError:
                        continue

    # notSelection 처리
    if not_selection_dir.exists():
        for f in not_selection_dir.glob("*.jsonl"):
            stats["total_files"] += 1
            video_id = f.stem  # video_id 추출
            with open(f, "r", encoding="utf-8") as file:
                for line in file:
                    try:
                        data = json.loads(line.strip())
                        transformed = transform_json_object(
                            data, "notSelection", channel, meta_dir, video_id
                        )

                        for record in transformed:
                            stats["total_records"] += 1
                            if record["trace_id"] not in existing_trace_ids:
                                with open(output_file, "a", encoding="utf-8") as out:
                                    out.write(
                                        json.dumps(record, ensure_ascii=False) + "\n"
                                    )
                                existing_trace_ids.add(record["trace_id"])
                                stats["new_records"] += 1
                            else:
                                stats["skipped_records"] += 1
                    except json.JSONDecodeError:
                        continue

    # map_url_crawling 처리 (정육왕 등 - 평가 스킵 데이터)
    if map_url_crawling_dir.exists():
        for f in map_url_crawling_dir.glob("*.jsonl"):
            stats["total_files"] += 1
            with open(f, "r", encoding="utf-8") as file:
                for line in file:
                    try:
                        data = json.loads(line.strip())
                        transformed = transform_map_url_crawling_object(
                            data, channel, meta_dir
                        )

                        for record in transformed:
                            stats["total_records"] += 1
                            if record["trace_id"] not in existing_trace_ids:
                                with open(output_file, "a", encoding="utf-8") as out:
                                    out.write(
                                        json.dumps(record, ensure_ascii=False) + "\n"
                                    )
                                existing_trace_ids.add(record["trace_id"])
                                stats["new_records"] += 1
                            else:
                                stats["skipped_records"] += 1
                    except json.JSONDecodeError:
                        continue


    # 결과 파일이 없으면 빈 파일 생성 (0건일 경우 대비)
    if not output_file.exists():
        output_file.touch()

    print(f"\n{'='*50}")
    print(f"✅ Transform 완료!")
    print(f"   총 파일: {stats['total_files']}개")
    print(f"   총 레코드: {stats['total_records']}개")
    print(f"   새로 추가: {stats['new_records']}개")
    print(f"   중복 건너뜀: {stats['skipped_records']}개")
    print(f"   출력 파일: {output_file}")
    print(f"{'='*50}")


if __name__ == "__main__":
    main()
