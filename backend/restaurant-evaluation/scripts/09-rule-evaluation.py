#!/usr/bin/env python3
"""
RULE 기반 평가 스크립트
selection 데이터를 읽어와 카테고리 유효성 및 위치 정합성을 평가합니다.

채널별 폴더 구조:
- 입력: data/{channel}/evaluation/selection/{video_id}.jsonl
- 출력: data/{channel}/evaluation/rule_results/{video_id}.jsonl

기존 backup 로직 그대로 유지:
- 네이버 검색 API로 name 검색
- NCP 지오코딩으로 address → 지번주소 변환
- 1단계: 지번주소 일치 비교
- 2단계: 20m 거리 기반 매칭
- naver_address에 검증된 주소/좌표 저장
- ★ 추가: naver_name (검증된 상호명) 저장
"""

import os
import json
import re
import math
import unicodedata
import time
import sys
import argparse
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime, timezone, timedelta
import requests
from dotenv import load_dotenv

# 한국 시간대
KST = timezone(timedelta(hours=9))

# 환경변수 로드
env_path = Path(__file__).parent.parent.parent / ".env"
if env_path.exists():
    load_dotenv(env_path)

# API 설정
NAVER_CLIENT_ID = os.getenv("NAVER_CLIENT_ID_BYEON", "")
NAVER_CLIENT_SECRET = os.getenv("NAVER_CLIENT_SECRET_BYEON", "")
NCP_KEY_ID = os.getenv("NCP_MAPS_KEY_ID_BYEON", "")
NCP_KEY = os.getenv("NCP_MAPS_KEY_BYEON", "")

LOCAL_URL = "https://openapi.naver.com/v1/search/local.json"
GEOCODE_URL = "https://maps.apigw.ntruss.com/map-geocode/v2/geocode"

HEADERS_LOCAL = {
    "X-Naver-Client-Id": NAVER_CLIENT_ID,
    "X-Naver-Client-Secret": NAVER_CLIENT_SECRET,
}
HEADERS_NCP = {
    "X-NCP-APIGW-API-KEY-ID": NCP_KEY_ID,
    "X-NCP-APIGW-API-KEY": NCP_KEY,
}

# =============================================================================
# [성능 최적화] HTTP 세션 재사용 + 지오코딩 캐시
# - 연결 풀링으로 TCP 핸드셰이크 오버헤드 제거
# - 동일 주소에 대한 중복 API 호출 제거 (캐시 적중률 40-70%)
# =============================================================================
_naver_session: Optional[requests.Session] = None
_ncp_session: Optional[requests.Session] = None
_geocode_jibun_cache: Dict[str, Optional[str]] = {}
_geocode_full_cache: Dict[str, Optional[List[Dict[str, Any]]]] = {}
_naver_search_cache: Dict[str, List[Dict[str, Any]]] = {}


def _get_naver_session() -> requests.Session:
    global _naver_session
    if _naver_session is None:
        _naver_session = requests.Session()
        _naver_session.headers.update(HEADERS_LOCAL)
        adapter = requests.adapters.HTTPAdapter(
            pool_connections=5, pool_maxsize=10,
            max_retries=requests.adapters.Retry(total=2, backoff_factor=0.5)
        )
        _naver_session.mount("https://", adapter)
    return _naver_session


def _get_ncp_session() -> requests.Session:
    global _ncp_session
    if _ncp_session is None:
        _ncp_session = requests.Session()
        _ncp_session.headers.update(HEADERS_NCP)
        adapter = requests.adapters.HTTPAdapter(
            pool_connections=5, pool_maxsize=10,
            max_retries=requests.adapters.Retry(total=2, backoff_factor=0.5)
        )
        _ncp_session.mount("https://", adapter)
    return _ncp_session


# 유효한 카테고리 목록
VALID_CATEGORIES = [
    "치킨",
    "중식",
    "돈까스·회",
    "피자",
    "패스트푸드",
    "찜·탕",
    "족발·보쌈",
    "분식",
    "카페·디저트",
    "한식",
    "고기",
    "양식",
    "아시안",
    "야식",
    "도시락",
]

# API 호출 통계
naver_api_calls = 0
ncp_api_calls = 0
naver_api_errors = 0
ncp_api_errors = 0


# ========= 유틸 함수 (기존 backup 그대로) =========
def _norm_space(s: str) -> str:
    if not s:
        return ""
    s = unicodedata.normalize("NFKC", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def address_core(addr: str) -> str:
    """지번주소 비교용 최소 정리"""
    if not addr:
        return ""
    a = _norm_space(re.sub(r"\(.*?\)", "", addr))
    a = re.sub(r"\d+", "", a)
    a = re.sub(r"\s*\S+(원|쇼핑|園)", "", a)
    return _norm_space(a)


def remove_floor_info(addr: str) -> str:
    """주소에서 층 정보 제거"""
    if not addr:
        return ""
    addr = re.sub(r"\s*(지하\s*\d+층|\d+층)\s*$", "", addr)
    return addr.strip()


def extract_region_from_address(addr: str) -> str:
    """주소에서 지역명 추출"""
    match = re.search(r"(\w+특별시|\w+광역시)", addr)
    if match:
        return match.group(1)
    match = re.search(r"(\w+도?\s*\w+시|\w+도?\s*\w+군|\w+도?\s*\w+구)", addr)
    if match:
        return match.group(1).strip()
    match = re.search(r"(\w+시|\w+군|\w+구)", addr)
    if match:
        return match.group(1)
    return ""


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """두 좌표 간 거리 (미터)"""
    R = 6371000.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlon / 2) ** 2
    )
    return 2 * R * math.asin(math.sqrt(a))


# ========= API 호출 (기존 backup 그대로) =========
def naver_local_search_one(query: str, display: int = 5) -> List[Dict[str, Any]]:
    """네이버 지역 검색 API (세션 재사용 + 캐시)"""
    global naver_api_calls, naver_api_errors

    # 캐시 확인
    cache_key = f"{_norm_space(query)}|{display}"
    if cache_key in _naver_search_cache:
        return _naver_search_cache[cache_key]

    session = _get_naver_session()
    for attempt in range(3):
        try:
            naver_api_calls += 1
            r = session.get(
                LOCAL_URL,
                params={
                    "query": _norm_space(query),
                    "display": min(5, max(1, display)),
                },
                timeout=8,
            )
            r.raise_for_status()
            j = r.json() if r.content else {}
            items = j.get("items", []) if isinstance(j, dict) else []
            results = []
            for it in items:
                title = re.sub(r"</?b>", "", (it.get("title") or ""))
                addr = it.get("address") or it.get("roadAddress") or ""
                raddr = it.get("roadAddress") or ""
                mapx = it.get("mapx")
                mapy = it.get("mapy")
                results.append(
                    {
                        "title": _norm_space(title),
                        "address": _norm_space(addr),
                        "roadAddress": _norm_space(raddr),
                        "mapx": mapx,
                        "mapy": mapy,
                    }
                )
            _naver_search_cache[cache_key] = results
            return results
        except Exception as e:
            naver_api_errors += 1
            print(f"⚠️ 네이버 검색 실패 (시도 {attempt+1}/3): {query} - {e}")
            if attempt < 2:
                time.sleep(2**attempt)
            else:
                return []


def ncp_geocode_to_jibun_address(query: str) -> Optional[str]:
    """NCP 지오코딩 → 지번주소 반환 (세션 재사용 + 캐시)"""
    global ncp_api_calls, ncp_api_errors

    # 캐시 확인
    norm_query = _norm_space(query)
    if norm_query in _geocode_jibun_cache:
        return _geocode_jibun_cache[norm_query]

    session = _get_ncp_session()
    for attempt in range(3):
        try:
            ncp_api_calls += 1
            r = session.get(
                GEOCODE_URL,
                params={"query": norm_query},
                timeout=8,
            )
            r.raise_for_status()
            j = r.json() if r.content else {}
            addresses = j.get("addresses", [])
            if addresses:
                addr = addresses[0].get("jibunAddress", "")
                if addr:
                    result = _norm_space(addr)
                    _geocode_jibun_cache[norm_query] = result
                    return result
            if attempt < 2:
                time.sleep(1)
        except Exception as e:
            ncp_api_errors += 1
            print(f"⚠️ 지오코딩 실패 (시도 {attempt+1}/3): {query} - {e}")
            if attempt < 2:
                time.sleep(2**attempt)
    _geocode_jibun_cache[norm_query] = None
    return None


def ncp_geocode_addresses(addr: str) -> Optional[List[Dict[str, Any]]]:
    """NCP 지오코딩 → 전체 주소 정보 반환 (세션 재사용 + 캐시)"""
    global ncp_api_calls, ncp_api_errors

    # 캐시 확인
    norm_addr = _norm_space(addr)
    if norm_addr in _geocode_full_cache:
        return _geocode_full_cache[norm_addr]

    session = _get_ncp_session()
    for attempt in range(3):
        try:
            ncp_api_calls += 1
            r = session.get(
                GEOCODE_URL,
                params={"query": norm_addr},
                timeout=8,
            )
            r.raise_for_status()
            j = r.json()
            arr = j.get("addresses") if isinstance(j, dict) else None
            result = arr if isinstance(arr, list) else None
            _geocode_full_cache[norm_addr] = result
            return result
        except Exception as e:
            ncp_api_errors += 1
            print(f"⚠️ 주소 지오코딩 실패 (시도 {attempt+1}/3): {addr} - {e}")
            if attempt < 2:
                time.sleep(2**attempt)
    _geocode_full_cache[norm_addr] = None
    return None


# ========= 평가 로직 (기존 backup 그대로 + naver_name 추가) =========
def evaluate_category_validity(
    restaurants: List[Dict[str, Any]],
    location_match_results: List[Dict[str, Any]],
) -> tuple:
    """카테고리 유효성 평가
    location_match_TF 결과에서 naver_name을 가져와서 name 필드에 사용
    Returns: (category_validity_TF list, evaluation_name_source dict)
    """
    # origin_name -> naver_name 매핑 생성
    naver_name_map = {}
    for loc_item in location_match_results:
        origin_name = loc_item.get("origin_name")
        naver_name = loc_item.get("naver_name")
        if origin_name:
            naver_name_map[origin_name] = naver_name

    results = []
    evaluation_name_source = {}
    for restaurant in restaurants:
        origin_name = _norm_space(str(restaurant.get("origin_name", "")))
        # name: naver_name 있으면 naver_name, 없으면 origin_name
        name = naver_name_map.get(origin_name) or origin_name
        name_source = "naver_name" if naver_name_map.get(origin_name) else "origin_name"
        category = restaurant.get("category")
        is_valid = category is not None and category in VALID_CATEGORIES
        results.append({"name": name, "eval_value": is_valid})
        evaluation_name_source[origin_name] = name_source
    return results, evaluation_name_source


def evaluate_one_restaurant(rec: Dict[str, Any]) -> Dict[str, Any]:
    """
    음식점 위치 검증 (기존 backup 로직 그대로)
    + naver_name 추가
    """
    name = _norm_space(str(rec.get("origin_name", "")))
    origin_address_raw = _norm_space(str(rec.get("address", "")))
    origin_address = remove_floor_info(origin_address_raw)

    # name 쿼리로 최대 5개 결과 받아오기
    name_cands = naver_local_search_one(name, display=5)

    # name + address 쿼리로 검색
    name_addr_query = f"{name} {_norm_space(origin_address)}"
    name_addr_cands = naver_local_search_one(name_addr_query, display=3)

    # name + 지역 쿼리로 검색
    region = extract_region_from_address(origin_address)
    name_region_cands = []
    if region:
        name_region_query = f"{name} {region}"
        name_region_cands = naver_local_search_one(name_region_query, display=5)

    # origin_address를 NCP 지오코딩하여 지번주소 얻기
    geocoded_jibun = ncp_geocode_to_jibun_address(origin_address)
    if not geocoded_jibun:
        return {
            "origin_name": name,
            "naver_name": None,  # ★ 추가
            "eval_value": False,
            "origin_address": origin_address,
            "naver_address": None,
            "falseMessage": "1단계 실패: 주소 지오코딩 실패",
        }

    geocoded_addr_norm = _norm_space(geocoded_jibun)

    # 검색 결과 합치기
    all_candidates = name_cands + name_addr_cands + name_region_cands
    if not all_candidates:
        return {
            "origin_name": name,
            "naver_name": None,  # ★ 추가
            "eval_value": False,
            "origin_address": origin_address,
            "naver_address": None,
            "falseMessage": "1단계 실패: 검색 결과 없음",
        }

    # 주소로 중복 제거
    seen_addresses = set()
    unique_candidates = []
    for cand in all_candidates:
        addr_key = _norm_space(cand.get("address") or "")
        if addr_key and addr_key not in seen_addresses:
            seen_addresses.add(addr_key)
            unique_candidates.append(cand)

    matched_result = None
    min_dist = float("inf")

    # 1단계: 지번주소 일치
    for cand in unique_candidates:
        cand_addr = cand.get("address") or ""
        if cand_addr:
            if cand.get("roadAddress") and cand_addr == cand.get("roadAddress"):
                cand_jibun = ncp_geocode_to_jibun_address(cand_addr)
                if cand_jibun:
                    cand_addr_norm = _norm_space(cand_jibun)
                else:
                    cand_addr_norm = _norm_space(cand_addr)
            else:
                cand_addr_norm = _norm_space(cand_addr)
            if cand_addr_norm == geocoded_addr_norm:
                matched_result = cand
                break

    # 2단계: 거리 기반 매칭
    if not matched_result:
        geocoded_addresses = ncp_geocode_addresses(origin_address)
        if not geocoded_addresses or len(geocoded_addresses) == 0:
            return {
                "origin_name": name,
                "naver_name": None,  # ★ 추가
                "eval_value": False,
                "origin_address": origin_address,
                "naver_address": None,
                "falseMessage": "2단계 실패: 지오코딩 정보 없음",
            }
        geocoded_lat = float(geocoded_addresses[0].get("y", 0))
        geocoded_lng = float(geocoded_addresses[0].get("x", 0))

        best_cand = None
        for cand in unique_candidates:
            cand_jibun = cand.get("address") or ""
            if not cand_jibun:
                continue
            cand_geocoded = ncp_geocode_addresses(cand_jibun)
            if cand_geocoded and len(cand_geocoded) > 0:
                cand_lat = float(cand_geocoded[0].get("y", 0))
                cand_lng = float(cand_geocoded[0].get("x", 0))
                dist = haversine_m(geocoded_lat, geocoded_lng, cand_lat, cand_lng)
                if dist <= 20.0 and dist < min_dist:
                    min_dist = dist
                    best_cand = cand

        if not best_cand:
            return {
                "origin_name": name,
                "naver_name": None,  # ★ 추가
                "eval_value": False,
                "origin_address": origin_address,
                "naver_address": None,
                "falseMessage": "2단계 실패: 20m 이내 후보 없음",
            }

        matched_result = best_cand

    # 일치하는 결과의 상세 정보 저장
    matched_addr = (
        matched_result.get("address") or matched_result.get("roadAddress") or ""
    )
    matched_geocoded = ncp_geocode_addresses(matched_addr)
    if matched_geocoded and len(matched_geocoded) > 0:
        addr_info = matched_geocoded[0]
        naver_address = {
            "roadAddress": addr_info.get("roadAddress", ""),
            "jibunAddress": addr_info.get("jibunAddress", ""),
            "englishAddress": addr_info.get("englishAddress", ""),
            "addressElements": addr_info.get("addressElements", []),
            "x": addr_info.get("x", ""),
            "y": addr_info.get("y", ""),
            "distance": min_dist if min_dist != float("inf") else 0.0,
        }
    else:
        naver_address = {
            "roadAddress": "",
            "jibunAddress": "",
            "englishAddress": "",
            "addressElements": [],
            "x": "",
            "y": "",
            "distance": min_dist if min_dist != float("inf") else 0.0,
        }

    return {
        "origin_name": name,
        "naver_name": matched_result.get("title"),  # ★ 추가: 네이버 검색 결과 상호명
        "eval_value": True,
        "origin_address": origin_address,
        "naver_address": [naver_address],
        "falseMessage": None,
    }


def process_one_line(obj: Dict[str, Any]) -> Dict[str, Any]:
    """하나의 selection 데이터 처리"""
    youtube_link = obj.get("youtube_link")
    channel_name = obj.get("channel_name")
    evaluation_target = obj.get("evaluation_target", {})
    restaurants = obj.get("restaurants", [])

    # 1. 위치 정합성 평가 (네이버 API) - 먼저 실행하여 naver_name 획득
    location_eval_list: List[Dict[str, Any]] = []
    for r in restaurants:
        # evaluation_target[name] == True인 것만 평가
        name = _norm_space(str(r.get("origin_name", "")))
        if not evaluation_target.get(name, False):
            # address가 null인 경우 등은 평가 스킵
            location_eval_list.append(
                {
                    "origin_name": name,
                    "naver_name": None,
                    "eval_value": False,
                    "origin_address": r.get("address"),
                    "naver_address": None,
                    "falseMessage": "평가 대상 아님 (address null)",
                }
            )
            continue

        try:
            res = evaluate_one_restaurant(r)
        except Exception as e:
            res = {
                "origin_name": name,
                "naver_name": None,
                "eval_value": False,
                "origin_address": _norm_space(str(r.get("address", ""))),
                "naver_address": None,
                "falseMessage": f"평가 실패: {str(e)}",
            }
        location_eval_list.append(res)
        time.sleep(0.5)  # API rate-limit 완화

    # 2. 카테고리 유효성 평가 (location_match_TF 결과에서 naver_name 활용)
    category_eval_list, evaluation_name_source = evaluate_category_validity(
        restaurants, location_eval_list
    )

    return {
        "youtube_link": youtube_link,
        "channel_name": channel_name,
        "evaluation_target": evaluation_target,
        "evaluation_results": {
            "evaluation_name_source": evaluation_name_source,
            "category_validity_TF": category_eval_list,
            "location_match_TF": location_eval_list,
        },
        "restaurants": restaurants,
        "recollect_version": obj.get("recollect_version", {}),
    }


def main():
    parser = argparse.ArgumentParser(description="Rule 기반 평가")
    parser.add_argument("--channel", "-c", required=True, help="채널 이름")
    parser.add_argument("--evaluation-path", required=True, help="평가 데이터 경로")
    args = parser.parse_args()

    channel = args.channel
    evaluation_path = Path(args.evaluation_path)

    print(f"\n[{datetime.now(KST).strftime('%H:%M:%S')}] Rule 평가 시작: {channel}")
    print(f"평가 경로: {evaluation_path}")

    # 입출력 폴더
    selection_dir = evaluation_path / "evaluation" / "selection"
    output_dir = evaluation_path / "evaluation" / "rule_results"
    output_dir.mkdir(parents=True, exist_ok=True)

    if not selection_dir.exists():
        print(f"❌ selection 폴더 없음: {selection_dir}")
        return

    # video_id 수집
    video_ids = set()
    for f in selection_dir.glob("*.jsonl"):
        video_ids.add(f.stem)

    print(f"대상 비디오: {len(video_ids)}개")

    # 통계
    stats = {
        "total": len(video_ids),
        "processed": 0,
        "skipped": 0,
        "total_restaurants": 0,
        "success_restaurants": 0,
        "fail_restaurants": 0,
    }

    for video_id in sorted(video_ids):
        input_file = selection_dir / f"{video_id}.jsonl"
        output_file = output_dir / f"{video_id}.jsonl"

        # 중복 검사: 이미 처리됨
        if output_file.exists():
            stats["skipped"] += 1
            if stats["skipped"] % 50 == 1:
                print(f"⏭️ 이미 처리됨 (스킵 {stats['skipped']}개)")
            continue

        # [최적화] 마지막 줄만 효율적으로 읽기 (seek 기반)
        data = None
        try:
            file_size = input_file.stat().st_size
            if file_size == 0:
                continue
            with open(input_file, "rb") as f:
                pos = file_size - 1
                while pos > 0:
                    f.seek(pos)
                    if f.read(1) not in (b"\n", b"\r"):
                        break
                    pos -= 1
                while pos > 0:
                    pos -= 1
                    f.seek(pos)
                    if f.read(1) == b"\n":
                        break
                if pos > 0:
                    pos += 1
                f.seek(pos)
                data = json.loads(f.readline().decode("utf-8").strip())
        except Exception:
            continue

        if not data:
            continue

        # evaluation_target에 true 값이 있는 경우에만 평가 진행
        evaluation_target = data.get("evaluation_target", {})
        if not any(value for value in evaluation_target.values() if value is True):
            continue

        # 처리
        result = process_one_line(data)

        # 저장
        with open(output_file, "w", encoding="utf-8") as f:
            f.write(json.dumps(result, ensure_ascii=False) + "\n")

        # 통계
        location_evals = result["evaluation_results"]["location_match_TF"]
        for eval_item in location_evals:
            stats["total_restaurants"] += 1
            if eval_item["eval_value"]:
                stats["success_restaurants"] += 1
            else:
                stats["fail_restaurants"] += 1

        stats["processed"] += 1
        if stats["processed"] % 10 == 0:
            print(f"✓ {stats['processed']}개 처리 완료...")

    print(f"\n{'='*50}")
    print(f"✅ Rule 평가 완료!")
    print(f"   총 비디오: {stats['total']}개")
    print(f"   처리됨: {stats['processed']}개")
    print(f"   건너뜀: {stats['skipped']}개")
    print(f"   총 음식점: {stats['total_restaurants']}개")
    print(f"   성공: {stats['success_restaurants']}개")
    print(f"   실패: {stats['fail_restaurants']}개")
    print(f"   네이버 API 호출: {naver_api_calls}회 (에러: {naver_api_errors})")
    print(f"   NCP API 호출: {ncp_api_calls}회 (에러: {ncp_api_errors})")
    print(f"   캐시 적중: 검색 {len(_naver_search_cache)}건, 지번 {len(_geocode_jibun_cache)}건, 주소 {len(_geocode_full_cache)}건")
    print(f"{'='*50}")


if __name__ == "__main__":
    main()
