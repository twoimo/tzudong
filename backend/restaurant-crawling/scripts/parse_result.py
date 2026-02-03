#!/usr/bin/env python3
"""
Gemini CLI 크롤링 도구 (통합)
- scan: 크롤링 대상(Pending) 영상 선별
- parse: Gemini 응답 파싱 및 저장

Merged from: tool_get_pending_crawling.py + parse_result.py
"""

import json
import sys
import argparse
from pathlib import Path
from typing import Dict, List, Any, Optional, Set

# ==============================================================================
# [CMD] scan: Pending Logic
# ==============================================================================

def extract_video_id(url: str) -> Optional[str]:
    """YouTube URL에서 video_id 추출"""
    if "v=" in url:
        return url.split("v=")[1].split("&")[0]
    elif "youtu.be/" in url:
        return url.split("youtu.be/")[1].split("?")[0]
    return None

def scan_pending(args: argparse.Namespace) -> None:
    """
    크롤링 대상(Pending) URL 스캔하여 stdout으로 출력
    """
    # 경로 설정 (backend/restaurant-crawling/scripts/parse_result.py 기준)
    SCRIPT_DIR = Path(__file__).parent.resolve()
    # data dir: scripts/../data
    DATA_ROOT = (SCRIPT_DIR / "../data").resolve()
    channel_dir = DATA_ROOT / args.channel
    
    urls_file = channel_dir / "urls.txt"
    
    if not urls_file.exists():
        print(f"❌ URLs file not found: {urls_file}", file=sys.stderr)
        return

    # 1. URLs 로드
    urls: List[str] = []
    with open(urls_file, 'r', encoding='utf-8') as f:
        urls = [line.strip() for line in f if line.strip()]

    # 2. 제외 필터 로드 (deleted_urls.txt)
    deleted_ids: Set[str] = set()
    deleted_file = channel_dir / "deleted_urls.txt"
    if deleted_file.exists():
        with open(deleted_file, 'r', encoding='utf-8') as f:
            for line in f:
                vid = extract_video_id(line)
                if vid: deleted_ids.add(vid)

    # 3. 상태 확인
    pending_urls: List[str] = []
    
    print(f"Scanning {len(urls)} videos for channel '{args.channel}'...", file=sys.stderr)
    
    for url in urls:
        vid = extract_video_id(url)
        if not vid: continue
        
        if vid in deleted_ids:
            continue

        crawling_file = channel_dir / "crawling" / f"{vid}.jsonl"
        map_crawling_file = channel_dir / "map_url_crawling" / f"{vid}.jsonl"
        error_file = channel_dir / "crawling_errors" / f"{vid}.jsonl"
        meta_file = channel_dir / "meta" / f"{vid}.jsonl"
        transcript_file = channel_dir / "transcript" / f"{vid}.jsonl"

        # (1) 이미 처리됨 (crawling 완료)
        if crawling_file.exists():
            continue
        
        # (2) 이미 처리됨 (map_url_crawling 완료)
        if map_crawling_file.exists():
            continue
            
        # (3) 에러 파일 있음 -> 재시도 대상 (Bash 스크립트에서 처리)
        if error_file.exists():
            pending_urls.append(url)
            continue
            
        # (4) 메타 또는 자막 없음 -> 처리 불가 (Skip)
        if not meta_file.exists() or not transcript_file.exists():
            continue

        # (5) 자막 내용 확인 (빈 자막이면 스킵)
        try:
            with open(transcript_file, 'r', encoding='utf-8') as tf:
                # 최신 라인 로드
                lines = tf.readlines()
                if not lines:
                    continue
                last_data = json.loads(lines[-1])
                transcript_list = last_data.get("transcript", [])
                if not transcript_list:
                    # 자막이 비어있으면 크롤링 불가하므로 스킵
                    continue
        except (json.JSONDecodeError, IOError, IndexError):
            continue

        # 여기까지 오면 pending
        pending_urls.append(url)

    print(f"Found {len(pending_urls)} pending videos.", file=sys.stderr)
    
    # stdout으로 URL 출력 (Bash 배열로 로드됨)
    for url in pending_urls:
        print(url)


# ==============================================================================
# [CMD] parse: Parsing Logic
# ==============================================================================

def parse_gemini_response(response_text: str) -> Optional[Dict[str, Any]]:
    """Gemini CLI 응답에서 JSON 추출"""
    try:
        # 1. 전체가 JSON인지 확인
        try:
            wrapper = json.loads(response_text)
            if isinstance(wrapper, dict) and "response" in wrapper:
                response_text = wrapper["response"]
        except json.JSONDecodeError:
            pass

        # 2. Markdown Code Block 제거
        json_text = response_text.strip()
        if "```json" in response_text:
            start = response_text.find("```json") + 7
            end = response_text.rfind("```")
            if end > start:
                json_text = response_text[start:end].strip()
        elif "```" in response_text:
            start = response_text.find("```") + 3
            end = response_text.rfind("```")
            if end > start:
                json_text = response_text[start:end].strip()

        data = json.loads(json_text)
        return data
    except json.JSONDecodeError as e:
        print(f"❌ JSON 파싱 실패: {e}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"❌ 예상치 못한 오류: {e}", file=sys.stderr)
        return None


def validate_restaurant_data(data: Dict[str, Any]) -> bool:
    """음식점 데이터 유효성 검증"""
    if not isinstance(data, dict):
        print("❌ 최상위 객체가 dict가 아닙니다", file=sys.stderr)
        return False

    if "restaurants" not in data:
        print("❌ 'restaurants' 필드가 없습니다", file=sys.stderr)
        return False

    if not isinstance(data["restaurants"], list):
        print("❌ 'restaurants'가 배열이 아닙니다", file=sys.stderr)
        return False

    required_fields = ["origin_name", "address", "category"]
    for idx, restaurant in enumerate(data["restaurants"]):
        for field in required_fields:
            if field not in restaurant:
                print(f"❌ restaurants[{idx}]에 '{field}' 필드가 없습니다", file=sys.stderr)
                return False
    return True


def save_to_jsonl(
    youtube_link: str,
    restaurants: List[Dict[str, Any]],
    output_path: Path,
    meta_recollect_id: Optional[int] = None,
    transcript_recollect_id: Optional[int] = None,
    channel_name: Optional[str] = None,
) -> None:
    """JSONL 형식으로 저장"""
    record = {"youtube_link": youtube_link, "restaurants": restaurants}

    if channel_name:
        record["channel_name"] = channel_name

    recollect_version = {}
    if meta_recollect_id is not None:
        recollect_version["meta"] = meta_recollect_id
    if transcript_recollect_id is not None:
        recollect_version["transcript"] = transcript_recollect_id
    if recollect_version:
        record["recollect_version"] = recollect_version

    with open(output_path, "a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")

    print(f"✅ 저장 완료: {len(restaurants)}개 음식점")


def parse_result(args: argparse.Namespace) -> None:
    """
    Gemini 응답 파싱 및 저장 (Main Logic)
    """
    youtube_url = args.youtube_url
    response_file = Path(args.response_file)
    output_file = Path(args.output_file)

    if not response_file.exists():
        print(f"❌ 응답 파일 없음: {response_file}", file=sys.stderr)
        sys.exit(1)

    with open(response_file, "r", encoding="utf-8") as f:
        response_text = f.read()

    data = parse_gemini_response(response_text)
    if not data:
        sys.exit(1)

    if not validate_restaurant_data(data):
        sys.exit(1)

    try:
        save_to_jsonl(
            youtube_link=youtube_url,
            restaurants=data["restaurants"],
            output_path=output_file,
            meta_recollect_id=args.meta_id,
            transcript_recollect_id=args.trans_id,
            channel_name=args.channel,
        )
        print(f"✅ 완료: {youtube_url}")
    except Exception as e:
        print(f"❌ 저장 실패: {e}", file=sys.stderr)
        sys.exit(1)


# ==============================================================================
# Main Entry Point
# ==============================================================================

def main():
    parser = argparse.ArgumentParser(description="Gemini Crawling Helper Tool (Scan & Parse)")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # Subcommand: scan
    cmd_scan = subparsers.add_parser("scan", help="Scan pending videos")
    cmd_scan.add_argument("--channel", required=True, help="Channel name")
    cmd_scan.set_defaults(func=scan_pending)

    # Subcommand: parse
    cmd_parse = subparsers.add_parser("parse", help="Parse Gemini response")
    cmd_parse.add_argument("youtube_url", help="YouTube URL")
    cmd_parse.add_argument("response_file", help="Gemini Response JSON file")
    cmd_parse.add_argument("output_file", help="Output JSONL file")
    cmd_parse.add_argument("meta_id", nargs="?", type=int, help="Meta Recollect ID")
    cmd_parse.add_argument("trans_id", nargs="?", type=int, help="Transcript Recollect ID")
    cmd_parse.add_argument("channel", nargs="?", help="Channel Name")
    cmd_parse.set_defaults(func=parse_result)

    args = parser.parse_args()
    args.func(args)

if __name__ == "__main__":
    main()
