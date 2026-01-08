#!/usr/bin/env python3
"""
RULE 기반 평가 스크립트
evaluation_selection.jsonl에서 데이터를 읽어와 
카테고리 유효성 및 위치 정합성을 평가합니다.

GeminiCLI 버전
날짜별 폴더 구조: data/yy-mm-dd/
"""

import os, json, re, math, unicodedata, time, sys
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime
import requests
from dotenv import load_dotenv

# 공통 유틸리티 함수 import
sys.path.append(os.path.join(os.path.dirname(__file__), '../../utils'))
from duplicate_checker import load_processed_urls, append_to_jsonl
from logger import PipelineLogger, LogLevel
from data_utils import DataPathManager

# 환경변수 우선, .env는 보조로 사용 (GitHub Actions 환경변수가 우선됨)
load_dotenv(os.path.join(os.path.dirname(__file__), '../.env'), override=False)

# 프로젝트 루트 및 데이터 경로 관리자
PROJECT_ROOT = Path(__file__).parent.parent
data_manager = DataPathManager(PROJECT_ROOT)

# 로그 디렉토리 설정
LOG_DIR = Path(__file__).parent.parent.parent / 'log' / 'geminiCLI-restaurant'

# 로거 초기화
logger = PipelineLogger(
    phase="evaluation-rule",
    log_dir=LOG_DIR
)

# API 호출 통계
naver_api_calls = 0
ncp_api_calls = 0
naver_api_errors = 0
ncp_api_errors = 0

# ========= 설정 (날짜별 폴더) =========
# 입력: 오늘 또는 최신 폴더의 selection 파일
today_folder = data_manager.get_today_folder()
latest_folder = data_manager.get_latest_folder()

INPUT_PATH = today_folder / "tzuyang_restaurant_evaluation_selection.jsonl"
if not INPUT_PATH.exists() and latest_folder:
    INPUT_PATH = latest_folder / "tzuyang_restaurant_evaluation_selection.jsonl"

# 출력: 오늘 폴더에 저장
OUTPUT_PATH = today_folder / "tzuyang_restaurant_evaluation_rule_results.jsonl"

NAVER_CLIENT_ID     = os.getenv("NAVER_CLIENT_ID_BYEON", "")
NAVER_CLIENT_SECRET = os.getenv("NAVER_CLIENT_SECRET_BYEON", "")
NCP_KEY_ID          = os.getenv("NCP_MAPS_KEY_ID_BYEON", "")
NCP_KEY             = os.getenv("NCP_MAPS_KEY_BYEON", "")

# 디버그: API 키 로드 확인
print(f"[DEBUG] NAVER_CLIENT_ID_BYEON 길이: {len(NAVER_CLIENT_ID)}")
print(f"[DEBUG] NAVER_CLIENT_SECRET_BYEON 길이: {len(NAVER_CLIENT_SECRET)}")
print(f"[DEBUG] NCP_MAPS_KEY_ID_BYEON 길이: {len(NCP_KEY_ID)}")
print(f"[DEBUG] NCP_MAPS_KEY_BYEON 길이: {len(NCP_KEY)}")

LOCAL_URL   = "https://openapi.naver.com/v1/search/local.json"  # name/address 검색
GEOCODE_URL = "https://maps.apigw.ntruss.com/map-geocode/v2/geocode"  # addresses 얻기

HEADERS_LOCAL = {
    "X-Naver-Client-Id": NAVER_CLIENT_ID,
    "X-Naver-Client-Secret": NAVER_CLIENT_SECRET,
}
HEADERS_NCP = {
    "X-NCP-APIGW-API-KEY-ID": NCP_KEY_ID,
    "X-NCP-APIGW-API-KEY": NCP_KEY,
}

# 유효한 카테고리 목록
VALID_CATEGORIES = [
    "치킨", "중식", "돈까스·회", "피자", "패스트푸드", "찜·탕",
    "족발·보쌈", "분식", "카페·디저트", "한식", "고기", "양식",
    "아시안", "야식", "도시락"
]

# ========= 유틸 =========
def _norm_space(s: str) -> str:
    if not s: return ""
    s = unicodedata.normalize("NFKC", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s

def address_core(addr: str) -> str:
    """지번주소 비교용 최소 정리: 괄호 제거 + 공백 정리 + 숫자 제거 + 건물명/상호명 제거 (동/호/지번 차이 무시)"""
    if not addr:
        return ""
    a = _norm_space(re.sub(r"\(.*?\)", "", addr))
    a = re.sub(r'\d+', '', a)  # 숫자 제거
    a = re.sub(r'\s*\S+(원|쇼핑|園)', '', a)  # 건물명 제거 (한자 포함)
    return _norm_space(a)

def remove_floor_info(addr: str) -> str:
    """주소에서 층 정보 제거 (예: 3층, 지하1층, 지하 2층)"""
    if not addr:
        return ""
    # 지하 N층, 지하N층, N층 패턴 제거 (맨 뒤에 있는 경우)
    addr = re.sub(r'\s*(지하\s*\d+층|\d+층)\s*$', '', addr)
    return addr.strip()

def extract_region_from_address(addr: str) -> str:
    """주소에서 지역명 추출 (줄임말 지원)"""
    # 1. 특별시/광역시 패턴 (ex: 서울특별시, 부산광역시)
    match = re.search(r'(\w+특별시|\w+광역시)', addr)
    if match:
        return match.group(1)
    
    # 2. 도(옵션) + 시/군/구 패턴 (ex: 충북 제천시, 충청북도 제천시)
    match = re.search(r'(\w+도?\s*\w+시|\w+도?\s*\w+군|\w+도?\s*\w+구)', addr)
    if match:
        return match.group(1).strip()
    
    # 3. 시/군/구만 패턴 (ex: 제천시)
    match = re.search(r'(\w+시|\w+군|\w+구)', addr)
    if match:
        return match.group(1)
    
    return ""

def address_region_match(addr1: str, addr2: str) -> bool:
    """두 주소의 시/군/구 단위 일치 여부 확인"""
    region1 = extract_region_from_address(addr1)
    region2 = extract_region_from_address(addr2)
    return region1 and region2 and (region1 == region2)

def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371000.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    return 2 * R * math.asin(math.sqrt(a))

def convert_mapx_mapy_to_wgs84(mapx: Any, mapy: Any) -> Optional[Tuple[float, float]]:
    """mapx/mapy (WGS84 × 1e7) → (lat, lon)"""
    try:
        x = float(mapx); y = float(mapy)
    except Exception:
        return None
    if abs(x) > 1e8 and abs(y) > 1e8:
        lon = x / 1e7
        lat = y / 1e7
        return (lat, lon)
    return None

# ========= API 호출 =========
def naver_local_search_one(query: str, display: int = 5) -> List[Dict[str, Any]]:
    global naver_api_calls, naver_api_errors
    for attempt in range(3):  # 재시도 3번
        try:
            naver_api_calls += 1
            r = requests.get(
                LOCAL_URL,
                headers=HEADERS_LOCAL,
                params={"query": _norm_space(query), "display": min(5, max(1, display))},
                timeout=8,
            )
            r.raise_for_status()
            j = r.json() if r.content else {}
            items = j.get("items", []) if isinstance(j, dict) else []
            results = []
            for it in items:
                title = re.sub(r"</?b>", "", (it.get("title") or ""))
                addr  = it.get("address") or it.get("roadAddress") or ""       # 지번주소 우선, 없으면 도로명주소
                raddr = it.get("roadAddress") or ""   # 도로명주소
                mapx  = it.get("mapx"); mapy = it.get("mapy")
                results.append({
                    "title": _norm_space(title),
                    "address": _norm_space(addr),
                    "roadAddress": _norm_space(raddr),
                    "mapx": mapx, "mapy": mapy
                })
            return results
        except Exception as e:
            naver_api_errors += 1
            logger.warning(f"네이버 검색 실패 (시도 {attempt+1}/3): {query} - {e}")
            if attempt < 2:
                time.sleep(2 ** attempt)  # 지수 백오프: 1초, 2초, 4초
            else:
                return []  # 실패 시 빈 리스트 반환

def ncp_geocode_to_jibun_address(query: str) -> Optional[str]:
    """NCP 지오코딩 API로 주소 검색하여 지번주소 반환"""
    global ncp_api_calls, ncp_api_errors
    for attempt in range(3):  # 재시도 3번
        try:
            ncp_api_calls += 1
            r = requests.get(
                GEOCODE_URL,
                headers=HEADERS_NCP,
                params={"query": _norm_space(query)},
                timeout=8,
            )
            r.raise_for_status()
            j = r.json() if r.content else {}

            addresses = j.get("addresses", [])
            if addresses:
                # 첫 번째 결과의 지번주소 반환
                addr = addresses[0].get("jibunAddress", "")
                if addr:
                    return _norm_space(addr)
            # 결과가 없으면 다음 시도
            if attempt < 2:
                time.sleep(1)
                continue
        except Exception as e:
            ncp_api_errors += 1
            logger.warning(f"지오코딩 실패 (시도 {attempt+1}/3): {query} - {e}")
            if attempt < 2:
                time.sleep(2 ** attempt)  # 지수 백오프
    return None

def try_pick_single_by_address_core(cands: List[Dict[str, Any]], addr_core_str: str) -> Optional[Dict[str, Any]]:
    """
    후보가 여러 개인 경우: 입력 주소 핵심 토큰이 후보 지번/도로명에 '포함'된 1개만 남김.
    그래도 1개가 아니면 None → 1단계 실패 처리.
    """
    if not cands:
        return None
    if len(cands) == 1:
        return cands[0]
    ac = _norm_space(addr_core_str)
    filtered = []
    for c in cands:
        a = address_core(c.get("address") or "")
        r = address_core(c.get("roadAddress") or "")
        if ac and (ac in a or a in ac or ac in r or r in ac):
            filtered.append(c)
    if len(filtered) == 1:
        return filtered[0]
    return None

def ncp_geocode_addresses(addr: str) -> Optional[List[Dict[str, Any]]]:
    """성공 시 addresses 배열 그대로 반환 (통과 케이스에만 저장)"""
    global ncp_api_calls, ncp_api_errors
    for attempt in range(3):  # 재시도 3번
        try:
            ncp_api_calls += 1
            r = requests.get(GEOCODE_URL, headers=HEADERS_NCP, params={"query": _norm_space(addr)}, timeout=8)
            r.raise_for_status()
            j = r.json()
            arr = j.get("addresses") if isinstance(j, dict) else None
            return arr if isinstance(arr, list) else None
        except Exception as e:
            ncp_api_errors += 1
            logger.warning(f"주소 지오코딩 실패 (시도 {attempt+1}/3): {addr} - {e}")
            if attempt < 2:
                time.sleep(2 ** attempt)  # 지수 백오프
    return None

# ========= 평가 로직 =========
def evaluate_category_validity(restaurants: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    카테고리 유효성 평가: 지정된 카테고리 목록에 포함되는지 확인
    """
    results = []
    for restaurant in restaurants:
        name = _norm_space(str(restaurant.get("name", "")))
        category = restaurant.get("category")

        # null이거나 VALID_CATEGORIES에 없으면 False
        is_valid = category is not None and category in VALID_CATEGORIES

        results.append({
            "name": name,
            "eval_value": is_valid
        })

    return results

def evaluate_one_restaurant(rec: Dict[str, Any]) -> Dict[str, Any]:
    """
    수정된 요구사항:
    1) name 쿼리로 최대 3개 결과 받아오기
    2) origin_address를 NCP 지오코딩으로 지번주소 변환
    3) 3개 결과 중 지번주소가 일치하는 결과 찾기
    4) 일치하는 경우 naver_address에 지번주소, 도로명주소, lat, lng 저장
    """
    name = _norm_space(str(rec.get("name", "")))
    origin_address_raw = _norm_space(str(rec.get("address", "")))
    # 층 정보 제거 (지오코딩 비교용)
    origin_address = remove_floor_info(origin_address_raw)

    # --- name 쿼리로 최대 5개 결과 받아오기 ---
    name_cands = naver_local_search_one(name, display=5)

    # --- name + address 쿼리로 검색해보기 ---
    name_addr_query = f"{name} {_norm_space(origin_address)}"
    name_addr_cands = naver_local_search_one(name_addr_query, display=3)

    # --- name + 지역 쿼리로 검색해보기 (지역 추출) ---
    region = extract_region_from_address(origin_address)
    name_region_cands = []
    if region:
        name_region_query = f"{name} {region}"
        name_region_cands = naver_local_search_one(name_region_query, display=5)

    # --- origin_address를 NCP 지오코딩하여 지번주소 얻기 ---
    geocoded_jibun = ncp_geocode_to_jibun_address(origin_address)
    if not geocoded_jibun:
        return {
            "name": name, "eval_value": False,
            "origin_address": origin_address,
            "naver_address": None,
            "falseMessage": "1단계 실패: 주소 지오코딩 실패"
        }

    geocoded_addr_norm = _norm_space(geocoded_jibun)

    print(f"[DEBUG] {name}: geocoded_jibun = {geocoded_jibun}")

    # --- 검색 결과 합치기 ---
    all_candidates = name_cands + name_addr_cands + name_region_cands
    if not all_candidates:
        return {
            "name": name, "eval_value": False,
            "origin_address": origin_address,
            "naver_address": None,
            "falseMessage": "1단계 실패: 검색 결과 없음"
        }

    # 주소로 중복 제거 (같은 주소의 식당은 하나만)
    seen_addresses = set()
    unique_candidates = []
    for cand in all_candidates:
        addr_key = _norm_space(cand.get("address") or "")
        if addr_key and addr_key not in seen_addresses:
            seen_addresses.add(addr_key)
            unique_candidates.append(cand)
    
    print(f"[DEBUG] {name}: unique_candidates addresses = {[cand.get('address') for cand in unique_candidates]}")
    
    matched_result = None
    for cand in unique_candidates:
        cand_addr = cand.get("address") or ""
        if cand_addr:
            # address가 roadAddress이면, geocode해서 jibunAddress 얻기
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

    if not matched_result:
        # --- 2단계: 거리 기반 매칭 시도 ---
        geocoded_addresses = ncp_geocode_addresses(origin_address)
        if not geocoded_addresses or len(geocoded_addresses) == 0:
            return {
                "name": name, "eval_value": False,
                "origin_address": origin_address,
                "naver_address": None,
                "falseMessage": "2단계 실패: 지오코딩 정보 없음"
            }
        geocoded_lat = float(geocoded_addresses[0].get("y", 0))
        geocoded_lng = float(geocoded_addresses[0].get("x", 0))
        print(f"[DEBUG] {name}: 2단계 geocoded lat={geocoded_lat}, lng={geocoded_lng}")
        
        best_cand = None
        min_dist = float('inf')
        for cand in unique_candidates:
            cand_jibun = cand.get("address") or ""
            if not cand_jibun:
                continue
            cand_geocoded = ncp_geocode_addresses(cand_jibun)
            if cand_geocoded and len(cand_geocoded) > 0:
                cand_lat = float(cand_geocoded[0].get("y", 0))
                cand_lng = float(cand_geocoded[0].get("x", 0))
                dist = haversine_m(geocoded_lat, geocoded_lng, cand_lat, cand_lng)
                print(f"[DEBUG] {name}: 2단계 cand_jibun={cand_jibun}, cand_lat={cand_lat}, cand_lng={cand_lng}, dist={dist}")
                if dist <= 20.0 and dist < min_dist:  # 20m 이내, 가장 가까운 것
                    min_dist = dist
                    best_cand = cand
        
        if not best_cand:
            return {
                "name": name, "eval_value": False,
                "origin_address": origin_address,
                "naver_address": None,
                "falseMessage": "2단계 실패: 20m 이내 후보 없음"
            }
        
        matched_result = best_cand

    # --- 일치하는 결과의 상세 정보 저장 ---
    # matched_result의 주소로 지오코딩해서 정확한 좌표 얻기
    matched_addr = matched_result.get("address") or matched_result.get("roadAddress") or ""
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
            "distance": min_dist if 'min_dist' in locals() else 0.0
        }
    else:
        # 지오코딩 실패시 빈값으로 저장 (주소와 좌표는 한 세트)
        naver_address = {
            "roadAddress": "",
            "jibunAddress": "",
            "englishAddress": "",
            "addressElements": [],
            "x": "",
            "y": "",
            "distance": min_dist if 'min_dist' in locals() else 0.0
        }

    return {
        "name": name,
        "eval_value": True,
        "origin_address": origin_address,
        "naver_address": [naver_address],  # 배열 형태로 유지
        "falseMessage": None
    }

def process_one_line(obj: Dict[str, Any]) -> Dict[str, Any]:
    youtube_link = obj.get("youtube_link")
    evaluation_target = obj.get("evaluation_target", {})
    restaurants  = obj.get("restaurants", [])

    # 1. 카테고리 유효성 평가
    category_eval_list = evaluate_category_validity(restaurants)

    # 2. 위치 정합성 평가 (네이버 API)
    location_eval_list: List[Dict[str, Any]] = []
    for r in restaurants:
        try:
            res = evaluate_one_restaurant(r)
        except Exception:
            res = {
                "name": _norm_space(str(r.get("name", ""))),
                "eval_value": False,
                "origin_address": _norm_space(str(r.get("address", ""))),
                "naver_address": None,
                "falseMessage": "평가 실패"
            }
        location_eval_list.append(res)
        time.sleep(0.5)  # API rate-limit 완화

    return {
        "youtube_link": youtube_link,
        "evaluation_target": evaluation_target,
        "evaluation_results": {
            "category_validity_TF": category_eval_list,
            "location_match_TF": location_eval_list
        },
        "restaurants": restaurants
    }

def main():
    logger.start_stage()
    
    logger.info("=" * 60)
    logger.info("  RULE 기반 평가 시작")
    logger.info("=" * 60)
    logger.info(f"입력 파일: {INPUT_PATH}")
    logger.info(f"출력 파일: {OUTPUT_PATH}")
    
    if not INPUT_PATH.exists():
        logger.error(f"입력 파일 없음: {INPUT_PATH}")
        sys.exit(1)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    
    # 1. 모든 날짜 폴더에서 처리된 youtube_link 로드 (유틸리티 함수 사용)
    logger.info("기존 처리 내역 확인 중 (전체 이력)...")
    processed_links = set()
    
    # 모든 날짜 폴더의 rule_results 파일 확인
    for result_file in data_manager.get_all_file_paths('tzuyang_restaurant_evaluation_rule_results.jsonl'):
        links = load_processed_urls(str(result_file))
        processed_links.update(links)
    
    logger.info(f"이미 처리된 레코드 (전체 이력): {len(processed_links)}개")
    
    count = 0
    skipped_count = 0
    total_restaurants = 0
    success_restaurants = []
    fail_restaurants = []
    
    # 2. 입력 파일 읽기
    with logger.timer("process_all_records"):
        with INPUT_PATH.open("r", encoding="utf-8") as fin:
            for line in fin:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue

                youtube_link = obj.get("youtube_link")
                
                # 3. 이미 처리된 youtube_link 확인
                if youtube_link in processed_links:
                    skipped_count += 1
                    if skipped_count % 100 == 1:
                        logger.debug(f"{skipped_count}개 건너뜀 (중복)")
                    continue

                # evaluation_target에 true 값이 있는 경우에만 평가 진행
                evaluation_target = obj.get("evaluation_target", {})
                if not any(value for value in evaluation_target.values() if value is True):
                    continue

                with logger.timer(f"process_record_{count + 1}"):
                    result = process_one_line(obj)
                
                # 4. append 모드로 즉시 저장 (유틸리티 함수)
                append_to_jsonl(str(OUTPUT_PATH), result)
                processed_links.add(youtube_link)
                
                # 통계 계산
                location_evals = result["evaluation_results"]["location_match_TF"]
                for eval_item in location_evals:
                    total_restaurants += 1
                    if eval_item["eval_value"]:
                        success_restaurants.append(eval_item["name"])
                    else:
                        fail_restaurants.append(eval_item["name"])
                
                count += 1
                if count % 10 == 0:
                    logger.info(f"진행 중... {count}개 처리 완료")

    # 통계 저장
    logger.add_statistic("total_records_processed", count)
    logger.add_statistic("skipped_records", skipped_count)
    logger.add_statistic("total_restaurants", total_restaurants)
    logger.add_statistic("success_restaurants", len(success_restaurants))
    logger.add_statistic("failed_restaurants", len(fail_restaurants))
    logger.add_statistic("naver_api_calls", naver_api_calls)
    logger.add_statistic("ncp_api_calls", ncp_api_calls)
    logger.add_statistic("naver_api_errors", naver_api_errors)
    logger.add_statistic("ncp_api_errors", ncp_api_errors)
    
    if total_restaurants > 0:
        success_rate = len(success_restaurants) * 100 / total_restaurants
        logger.add_statistic("success_rate", f"{success_rate:.1f}%")

    # 스테이지 종료 및 로그 저장
    logger.end_stage()
    summary = logger.get_summary()
    
    # 요약 출력
    logger.info("")
    logger.info("=" * 60)
    logger.info("  📊 실행 요약")
    logger.info("=" * 60)
    logger.info(f"  시작 시간: {summary.get('started_at', 'N/A')}")
    logger.info(f"  종료 시간: {summary.get('ended_at', 'N/A')}")
    logger.info(f"  총 소요 시간: {summary.get('duration_formatted', 'N/A')}")
    logger.info("")
    logger.success(f"처리 완료: {count}개 객체 처리")
    logger.warning(f"건너뛴 레코드: {skipped_count}개")
    logger.info(f"총 음식점: {total_restaurants}개")
    logger.success(f"성공: {len(success_restaurants)}개")
    logger.error(f"실패: {len(fail_restaurants)}개")
    logger.info("")
    logger.info("📡 API 통계:")
    logger.info(f"  네이버 API 호출: {naver_api_calls}회 (에러: {naver_api_errors})")
    logger.info(f"  NCP API 호출: {ncp_api_calls}회 (에러: {ncp_api_errors})")
    logger.info("")
    logger.info(f"결과 저장: {OUTPUT_PATH}")
    logger.info("=" * 60)
    
    # JSON 로그 저장
    logger.save_json_log()

if __name__ == "__main__":
    main()
