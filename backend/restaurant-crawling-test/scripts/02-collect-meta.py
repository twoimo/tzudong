#!/usr/bin/env python3
"""
YouTube 메타데이터 수집 스크립트 (recollect_id 기반)
- YouTube Data API로 title, publishedAt, duration, stats 수집
- OpenAI GPT-4o-mini로 광고 주체 분석 (이전 데이터 있으면 재사용)
- recollect_id로 변경 추적, recollect_reason으로 변경 이유 기록

사용법:
    python 02-collect-meta.py --channel tzuyang
    python 02-collect-meta.py --channel meatcreator
    python 02-collect-meta.py  # 모든 채널
"""

import os
import sys
import json
import re
import argparse
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, Optional, List

# 유틸리티 모듈 경로 추가 (backend/)
sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from utils.config_loader import (
    get_channel_info,
    get_all_channels,
    get_channel_data_path,
    get_api_key,
    get_api_config,
)
from utils.logger import PipelineLogger
from utils.duplicate_checker import append_to_jsonl

try:
    from googleapiclient.discovery import build
    from openai import OpenAI
    from dotenv import load_dotenv
except ImportError:
    print("❌ 필수 패키지 설치 필요:")
    print("   pip install google-api-python-client openai python-dotenv")
    sys.exit(1)

# .env 파일 로드
env_path = Path(__file__).parent.parent / ".env"
if env_path.exists():
    load_dotenv(env_path)

# 한국 시간대 (KST, UTC+9)
KST = timezone(timedelta(hours=9))

# 로그 디렉토리 (restaurant-crawling-test/log/)
LOG_DIR = Path(__file__).parent.parent / "log"


def extract_video_id(url: str) -> Optional[str]:
    """YouTube URL에서 video_id 추출"""
    patterns = [
        r"youtube\.com/watch\?v=([^&]+)",
        r"youtu\.be/([^?]+)",
        r"youtube\.com/embed/([^?]+)",
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None


def parse_duration(duration: str) -> int:
    """ISO 8601 duration을 초 단위로 변환"""
    match = re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", duration)
    if not match:
        return 0
    hours, minutes, seconds = match.groups()
    total = 0
    if hours:
        total += int(hours) * 3600
    if minutes:
        total += int(minutes) * 60
    if seconds:
        total += int(seconds)
    return total


def get_latest_meta(channel_data_path: Path, video_id: str) -> Optional[Dict]:
    """video_id의 가장 최근 메타데이터 반환"""
    meta_file = channel_data_path / "meta" / f"{video_id}.jsonl"
    if not meta_file.exists():
        return None

    try:
        with open(meta_file, "r", encoding="utf-8") as f:
            lines = f.readlines()
            if lines:
                return json.loads(lines[-1].strip())
    except Exception:
        pass
    return None


def detect_changes(current: Dict, previous: Dict) -> Optional[str]:
    """이전 데이터와 비교하여 변경 사항 감지"""
    if previous is None:
        return None  # 신규

    if current.get("title") != previous.get("title"):
        return "title_changed"
    if current.get("duration") != previous.get("duration"):
        return "duration_changed"

    return None


def analyze_ad_content(
    openai_client: OpenAI, text: str, logger: PipelineLogger
) -> Optional[List[str]]:
    """광고/협찬 주체를 GPT-4o-mini로 분석"""
    text_preview = text[:100]

    try:
        api_config = get_api_config()
        model = api_config.get("openai", {}).get("model", "gpt-4o-mini")

        with logger.timer("openai_api_call"):
            response = openai_client.chat.completions.create(
                model=model,
                temperature=0.3,
                messages=[
                    {
                        "role": "system",
                        "content": """광고/협찬/지원을 한 **정확한 주체들의 전체 이름**을 **리스트** 형식으로 답변하세요.
예시: ['하이트진로', '영양군청']
주체를 찾을 수 없으면 'None'을 출력합니다.""",
                    },
                    {"role": "user", "content": text_preview},
                ],
            )

        content = response.choices[0].message.content.strip()

        if not content or content.lower() == "none":
            return None

        try:
            parsed = json.loads(content)
        except json.JSONDecodeError:
            try:
                import ast

                parsed = ast.literal_eval(content)
            except Exception:
                parsed = [content]

        if isinstance(parsed, str):
            parsed = [parsed]
        elif not isinstance(parsed, list):
            parsed = [str(parsed)]

        parsed = [str(x).strip() for x in parsed if str(x).strip()]
        return parsed if parsed else None

    except Exception as e:
        logger.warning(f"광고 분석 실패: {e}")
        return None


def get_video_meta(
    youtube,
    video_id: str,
    channel_name: str,
    logger: PipelineLogger,
) -> Dict[str, Any]:
    """YouTube 비디오 메타데이터 가져오기"""
    try:
        with logger.timer("youtube_api_video"):
            response = (
                youtube.videos()
                .list(part="snippet,contentDetails,statistics", id=video_id)
                .execute()
            )

        if not response.get("items"):
            logger.warning(f"비디오 정보 없음: {video_id}")
            return {}

        item = response["items"][0]
        snippet = item.get("snippet", {})
        content_details = item.get("contentDetails", {})
        statistics = item.get("statistics", {})

        duration_seconds = parse_duration(content_details.get("duration", "PT0S"))
        description = snippet.get("description", "")

        # Statistics
        view_count = (
            int(statistics.get("viewCount", 0)) if statistics.get("viewCount") else None
        )
        like_count = (
            int(statistics.get("likeCount", 0)) if statistics.get("likeCount") else None
        )
        comment_count = (
            int(statistics.get("commentCount", 0))
            if statistics.get("commentCount")
            else None
        )

        return {
            "youtube_link": f"https://www.youtube.com/watch?v={video_id}",
            "channel_name": channel_name,
            "title": snippet.get("title"),
            "published_at": snippet.get("publishedAt"),
            "duration": duration_seconds,
            "is_shorts": duration_seconds <= 180,
            "description": description[:500],
            "category": snippet.get("categoryId"),
            "tags": snippet.get("tags", []),
            "stats": {
                "view_count": view_count,
                "like_count": like_count,
                "comment_count": comment_count,
            },
        }

    except Exception as e:
        logger.error(f"메타데이터 수집 오류 ({video_id}): {e}")
        return {}


def load_urls_from_txt(channel_data_path: Path) -> List[str]:
    """urls.txt에서 video_id 목록 반환"""
    urls_file = channel_data_path / "urls.txt"
    video_ids = []

    if not urls_file.exists():
        return video_ids

    with open(urls_file, "r", encoding="utf-8") as f:
        for line in f:
            url = line.strip()
            if url:
                video_id = extract_video_id(url)
                if video_id:
                    video_ids.append(video_id)

    return video_ids


def collect_channel_meta(
    channel_name: str,
    youtube,
    openai_client: Optional[OpenAI],
    logger: PipelineLogger,
) -> Dict[str, Any]:
    """단일 채널의 메타데이터 수집 (recollect_id 기반)"""
    channel_info = get_channel_info(channel_name)
    channel_data_path = get_channel_data_path(channel_name)

    logger.info(f'채널 처리: {channel_info["name"]} ({channel_name})')

    # urls.txt에서 video_id 목록 로드
    video_ids = load_urls_from_txt(channel_data_path)
    logger.info(f"전체 URL: {len(video_ids)}개")

    if not video_ids:
        logger.info("수집 대상 없음")
        return {"channel_name": channel_name, "processed": 0, "success": 0}

    meta_dir = channel_data_path / "meta"
    meta_dir.mkdir(parents=True, exist_ok=True)

    success_count = 0
    error_count = 0
    ads_count = 0
    ads_reused = 0

    for idx, video_id in enumerate(video_ids, 1):
        logger.progress(idx, len(video_ids), video_id)

        # 이전 메타 로드
        previous_meta = get_latest_meta(channel_data_path, video_id)
        prev_recollect_id = previous_meta.get("recollect_id", 0) if previous_meta else 0

        # 현재 메타 수집
        meta = get_video_meta(youtube, video_id, channel_name, logger)

        if not meta:
            error_count += 1
            continue

        # 변경 사항 감지
        recollect_reason = detect_changes(meta, previous_meta)

        # 변경 사항 없으면 스킵
        if previous_meta and not recollect_reason:
            continue

        # recollect_id 설정: 첫 수집은 0, 재수집은 이전 +1
        if previous_meta:
            prev_recollect_id = previous_meta.get("recollect_id", 0)
            new_recollect_id = prev_recollect_id + 1
        else:
            new_recollect_id = 0

        # 메타에 recollect 정보 추가
        meta["recollect_id"] = new_recollect_id
        meta["recollect_reason"] = recollect_reason
        meta["collected_at"] = datetime.now(KST).isoformat()

        # 광고 분석: 이전 데이터 있으면 재사용
        ad_keywords = ["협찬", "광고", "지원"]
        description = meta.get("description", "")
        is_ads = any(keyword in description for keyword in ad_keywords)

        meta["ads_info"] = {"is_ads": is_ads, "what_ads": None}

        if is_ads:
            if previous_meta and previous_meta.get("ads_info", {}).get("what_ads"):
                meta["ads_info"]["what_ads"] = previous_meta["ads_info"]["what_ads"]
                ads_reused += 1
            elif openai_client:
                what_ads = analyze_ad_content(openai_client, description, logger)
                meta["ads_info"]["what_ads"] = what_ads
            ads_count += 1

        # 저장
        output_file = meta_dir / f"{video_id}.jsonl"
        append_to_jsonl(str(output_file), meta)
        success_count += 1

    logger.progress_done()

    logger.info(f"완료: 성공 {success_count}개, 실패 {error_count}개")
    logger.info(f"광고: {ads_count}개 (재사용 {ads_reused}개)")

    return {
        "channel_name": channel_name,
        "processed": len(video_ids),
        "success": success_count,
        "errors": error_count,
        "ads_detected": ads_count,
        "ads_reused": ads_reused,
    }


def main():
    """메인 실행 함수"""
    parser = argparse.ArgumentParser(
        description="YouTube 메타데이터 수집 (recollect_id)"
    )
    parser.add_argument("--channel", "-c", type=str, help="채널 이름")
    parser.add_argument("--skip-ads", action="store_true", help="광고 분석 스킵")
    args = parser.parse_args()

    # API 키 확인
    youtube_api_key = get_api_key("youtube")
    openai_api_key = get_api_key("openai")

    if not youtube_api_key:
        print("❌ YOUTUBE_API_KEY_BYEON 환경변수가 설정되지 않았습니다")
        sys.exit(1)

    youtube = build("youtube", "v3", developerKey=youtube_api_key)

    openai_client = None
    if not args.skip_ads and openai_api_key:
        openai_client = OpenAI(api_key=openai_api_key)

    logger = PipelineLogger(phase="collect-meta", log_dir=LOG_DIR)
    logger.start_stage()

    try:
        logger.info("=" * 60)
        logger.info("  YouTube 메타데이터 수집 (recollect_id)")
        logger.info("=" * 60)

        if args.channel:
            channel_names = [args.channel]
        else:
            channel_names = list(get_all_channels().keys())

        logger.info(f"대상 채널: {channel_names}")

        results = []
        for channel_name in channel_names:
            logger.info("")
            logger.info(f"--- {channel_name} 처리 시작 ---")
            result = collect_channel_meta(channel_name, youtube, openai_client, logger)
            results.append(result)

        logger.info("")
        logger.info("=" * 60)
        logger.success("모든 채널 처리 완료")
        for result in results:
            logger.info(
                f"  {result['channel_name']}: {result['success']}/{result['processed']}개"
            )
        logger.info("=" * 60)

    except Exception as e:
        logger.error(f"실행 중 오류: {e}")
        raise
    finally:
        logger.end_stage()
        logger.save_json_log()


if __name__ == "__main__":
    main()
