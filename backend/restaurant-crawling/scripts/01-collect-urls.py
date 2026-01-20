#!/usr/bin/env python3
"""
YouTube 채널 동영상 URL 수집 스크립트
YouTube Data API v3 사용
채널별로 동영상 URL을 수집하고 data/{channel}/urls.txt에 저장합니다.

사용법:
    python3 01-collect-urls.py --channel tzuyang
    python3 01-collect-urls.py --channel meatcreator
    python3 01-collect-urls.py  # 모든 채널
"""

import os
import sys
import argparse
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Set

# 유틸리티 모듈 경로 추가 (backend/)
sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from utils.config_loader import (
    get_channel_info,
    get_all_channels,
    get_channel_data_path,
    get_api_key,
    get_collection_config,
)
from utils.logger import PipelineLogger

try:
    from googleapiclient.discovery import build
    from googleapiclient.errors import HttpError
    from dotenv import load_dotenv
except ImportError:
    print("❌ 필수 패키지 설치 필요:")
    print("   pip install google-api-python-client python-dotenv")
    sys.exit(1)

# .env 로드
env_path = Path(__file__).parent.parent.parent / ".env.local"
if not env_path.exists():
    env_path = Path(__file__).parent.parent.parent / ".env"
load_dotenv(env_path)

# 한국 시간대 (KST, UTC+9)
KST = timezone(timedelta(hours=9))

# 로그 디렉토리 (backend/log/restaurant-crawling/)
LOG_DIR = Path(__file__).parent.parent.parent / "log" / "restaurant-crawling"


def load_existing_urls(urls_file: Path) -> Set[str]:
    """
    urls.txt에서 이미 수집된 URL 목록 반환
    """
    existing_urls = set()

    if not urls_file.exists():
        return existing_urls

    with open(urls_file, "r", encoding="utf-8") as f:
        for line in f:
            url = line.strip()
            if url and url.startswith("http"):
                existing_urls.add(url)

    return existing_urls


def fetch_all_video_urls(
    api_key: str, channel_id: str, logger: PipelineLogger
) -> List[str]:
    """
    YouTube 채널의 모든 동영상 URL을 가져옵니다.

    Returns:
        ['https://www.youtube.com/watch?v=abc123', ...]
    """
    youtube = build("youtube", "v3", developerKey=api_key)
    urls = []
    api_call_count = 0
    config = get_collection_config()

    try:
        # 채널의 업로드 플레이리스트 ID 가져오기
        with logger.timer("youtube_api_channel_list"):
            channel_response = (
                youtube.channels()
                .list(part="contentDetails,snippet", id=channel_id)
                .execute()
            )
            api_call_count += 1

        if not channel_response.get("items"):
            raise ValueError(f"채널을 찾을 수 없습니다: {channel_id}")

        channel_info = channel_response["items"][0]
        channel_title = channel_info["snippet"]["title"]
        uploads_playlist_id = channel_info["contentDetails"]["relatedPlaylists"][
            "uploads"
        ]

        logger.info(f"채널: {channel_title}")
        logger.info(f"업로드 플레이리스트 ID: {uploads_playlist_id}")

        # 플레이리스트의 모든 동영상 가져오기
        next_page_token = None
        page_count = 0

        while True:
            page_count += 1
            logger.debug(f"페이지 {page_count} 로딩 중...")

            with logger.timer(f"youtube_api_playlist_page_{page_count}"):
                playlist_response = (
                    youtube.playlistItems()
                    .list(
                        part="contentDetails",
                        playlistId=uploads_playlist_id,
                        maxResults=config.get("batch_size", 50),
                        pageToken=next_page_token,
                    )
                    .execute()
                )
                api_call_count += 1

            # URL 추출
            for item in playlist_response.get("items", []):
                video_id = item["contentDetails"]["videoId"]
                urls.append(f"https://www.youtube.com/watch?v={video_id}")

            logger.debug(
                f'페이지 {page_count}: {len(playlist_response.get("items", []))}개'
            )

            # 다음 페이지 확인
            next_page_token = playlist_response.get("nextPageToken")
            if not next_page_token:
                break

        logger.success(f"총 {len(urls)}개 URL 수집 완료")
        logger.add_statistic("total_urls_fetched", len(urls))
        logger.add_statistic("youtube_api_calls", api_call_count)

        return urls

    except HttpError as e:
        logger.error(f"YouTube API 오류: {e}")
        raise


def save_urls(
    urls: List[str],
    urls_file: Path,
    existing_urls: Set[str],
    logger: PipelineLogger,
    dry_run: bool = False,
) -> int:
    """
    신규 URL을 urls.txt에 추가

    Returns:
        신규 저장된 URL 수
    """
    # 폴더 생성
    urls_file.parent.mkdir(parents=True, exist_ok=True)

    new_urls = [url for url in urls if url not in existing_urls]
    skip_count = len(urls) - len(new_urls)

    if not dry_run and new_urls:
        with open(urls_file, "a", encoding="utf-8") as f:
            for url in new_urls:
                f.write(url + "\n")

    logger.info(f"신규 저장: {len(new_urls)}개, 스킵 (기존): {skip_count}개")
    logger.add_statistic("new_urls_saved", len(new_urls))
    logger.add_statistic("skipped_existing", skip_count)

    return len(new_urls)


def save_deleted_urls(
    deleted_urls: List[str],
    channel_data_path: Path,
    urls_file: Path,
    remaining_urls: List[str],
    logger: PipelineLogger,
    dry_run: bool = False,
):
    """
    삭제된 URL을 deleted_urls.txt에 기록하고 urls.txt를 갱신
    """
    if not deleted_urls:
        return

    deleted_file = channel_data_path / "deleted_urls.txt"
    timestamp = datetime.now(KST).isoformat()
    
    if not dry_run:
        # 1. deleted_urls.txt에 추가
        with open(deleted_file, "a", encoding="utf-8") as f:
            for url in deleted_urls:
                f.write(f"{url}\t{timestamp}\n")
        
        # 2. urls.txt 갱신 (삭제된 것 제외)
        with open(urls_file, "w", encoding="utf-8") as f:
            for url in remaining_urls:
                f.write(url + "\n")

    logger.warning(f"삭제된 영상 감지: {len(deleted_urls)}개 -> deleted_urls.txt 이동")
    logger.add_statistic("deleted_urls_count", len(deleted_urls))


def collect_channel_urls(
    channel_name: str, api_key: str, logger: PipelineLogger, dry_run: bool = False
) -> Dict[str, Any]:
    """
    단일 채널의 URL 수집
    """
    channel_info = get_channel_info(channel_name)
    channel_id = channel_info["channel_id"]
    channel_data_path = get_channel_data_path(channel_name)
    urls_file = channel_data_path / "urls.txt"

    logger.info(f'채널 처리: {channel_info["name"]} ({channel_name})')
    logger.info(f"채널 ID: {channel_id}")
    logger.info(f"URL 파일: {urls_file}")

    # 기존 URL 로드
    with logger.timer("load_existing_urls"):
        existing_urls = load_existing_urls(urls_file)
    logger.info(f"기존 수집된 URL: {len(existing_urls)}개")

    # 동영상 URL 수집
    with logger.timer("fetch_all_video_urls"):
        urls = fetch_all_video_urls(api_key, channel_id, logger)

    # 저장 (신규 추가)
    with logger.timer("save_urls"):
        new_count = save_urls(urls, urls_file, existing_urls, logger, dry_run)
    
    # 삭제된 영상 처리
    # existing_urls에는 있지만, 방금 수집한 urls에는 없는 것
    current_url_set = set(urls)
    deleted_urls = [url for url in existing_urls if url not in current_url_set]
    
    if deleted_urls:
        save_deleted_urls(
            deleted_urls, 
            channel_data_path, 
            urls_file, 
            urls, # 이번에 수집된 전체 목록이 곧 remaining_urls가 됨 (정렬 여부는 API 순서 따름)
            logger, 
            dry_run
        )

    return {
        "channel_name": channel_name,
        "channel_id": channel_id,
        "total_fetched": len(urls),
        "new_saved": new_count,
        "deleted_count": len(deleted_urls),
        "existing_count": len(existing_urls),
    }


def main():
    """메인 실행 함수"""
    parser = argparse.ArgumentParser(description="YouTube 채널 동영상 URL 수집")
    parser.add_argument(
        "--channel",
        "-c",
        type=str,
        help="채널 이름 (tzuyang, meatcreator). 미지정시 모든 채널",
    )
    parser.add_argument("--dry-run", action="store_true", help="실제 저장 없이 테스트")
    args = parser.parse_args()

    # API 키 확인
    api_key = get_api_key("youtube")
    if not api_key:
        print("❌ YOUTUBE_API_KEY_BYEON 환경변수가 설정되지 않았습니다")
        sys.exit(1)

    # 로거 초기화
    logger = PipelineLogger(phase="collect-urls", log_dir=LOG_DIR)
    logger.start_stage()

    try:
        logger.info("=" * 60)
        logger.info("  YouTube 채널 동영상 URL 수집")
        logger.info("=" * 60)

        # 채널 목록 결정
        if args.channel:
            channel_names = [args.channel]
        else:
            channel_names = list(get_all_channels().keys())

        logger.info(f"대상 채널: {channel_names}")

        if args.dry_run:
            logger.warning("DRY-RUN 모드: 실제 저장하지 않음")

        results = []
        for channel_name in channel_names:
            logger.info("")
            logger.info(f"--- {channel_name} 처리 시작 ---")
            result = collect_channel_urls(channel_name, api_key, logger, args.dry_run)
            results.append(result)

        # 최종 결과 요약
        logger.info("")
        logger.info("=" * 60)
        logger.success("모든 채널 처리 완료")
        logger.info("=" * 60)

        for result in results:
            logger.info(
                f"  {result['channel_name']}: 신규 {result['new_saved']}개 / 삭제 {result.get('deleted_count', 0)}개 / 전체 {result['total_fetched']}개"
            )

    except Exception as e:
        logger.error(f"실행 중 오류 발생: {e}")
        raise
    finally:
        logger.end_stage()
        logger.save_json_log()


if __name__ == "__main__":
    main()
