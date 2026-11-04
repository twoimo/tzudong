#!/usr/bin/env python3
"""
YouTube 채널 동영상 URL 수집 스크립트
YouTube Data API v3 사용
채널별로 동영상 URL을 수집하고 data/{channel}/urls.txt에 저장합니다.

사용법:
    python 01-collect-urls.py --channel tzuyang
    python 01-collect-urls.py --channel meatcreator
    python 01-collect-urls.py  # 모든 채널
"""

import os
import sys
import argparse
import re
import tempfile
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any, Set

# 유틸리티 모듈 경로 추가 (backend/)
BASE_BACKEND_ROOT = Path(__file__).resolve().parents[2]
if str(BASE_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BASE_BACKEND_ROOT))

from utils.config_loader import (
    get_channel_info,
    get_all_channels,
    get_channel_data_path,
    get_api_key,
    get_collection_config,
)
from utils.logger import PipelineLogger
from utils.runtime_paths import load_backend_env, get_backend_log_dir, resolve_backend_root
from utils.privacy_log import safe_error_name

try:
    from googleapiclient.discovery import build
    from googleapiclient.errors import HttpError
except ImportError:
    print("[ERROR] 필수 패키지 설치 필요:")
    print("   pip install google-api-python-client")
    sys.exit(1)

# .env 로드
BACKEND_ROOT = resolve_backend_root(Path(__file__).resolve())
load_backend_env(BACKEND_ROOT, prefer_local=True)

# 로그 디렉토리 (backend/log/restaurant-crawling/)
LOG_DIR = get_backend_log_dir(BACKEND_ROOT, "restaurant-crawling")


def _youtube_error_status(error: BaseException) -> int | None:
    """Read a provider status code without stringifying provider diagnostics."""
    try:
        for attribute in ("status", "status_code", "code"):
            value = getattr(error, attribute, None)
            if type(value) is int:
                return value
        response = getattr(error, "resp", None)
        value = getattr(response, "status", None)
        return value if type(value) is int else None
    except Exception:
        return None


def classify_youtube_failure(error: BaseException) -> str:
    """Map structured YouTube failures to stable, public-safe reason codes."""
    status = _youtube_error_status(error)
    if isinstance(error, InvalidPlaylistSnapshot):
        return "youtube_snapshot_invalid"
    if isinstance(error, ValueError):
        return "youtube_channel_not_found"
    if status in (401, 403):
        return "youtube_api_auth_failed"
    if status == 404:
        return "youtube_channel_not_found"
    if status == 429:
        return "youtube_api_rate_limited"
    return "youtube_api_request_failed"


class InvalidPlaylistSnapshot(ValueError):
    """An incomplete/malformed response has no absence or deletion authority."""


def _response_items(response: Any) -> List[dict]:
    if not isinstance(response, dict) or not isinstance(response.get("items"), list):
        raise InvalidPlaylistSnapshot("youtube_snapshot_invalid")
    if any(not isinstance(item, dict) for item in response["items"]):
        raise InvalidPlaylistSnapshot("youtube_snapshot_invalid")
    return response["items"]


def _publication_time(value: Any) -> float | None:
    """Only an explicitly offset, valid publication timestamp can rank a URL."""
    if not isinstance(value, str):
        return None
    try:
        published = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return published.timestamp() if published.tzinfo is not None else None
    except (ValueError, OverflowError, OSError):
        return None


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
    publication_times = {}
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

        channel_items = _response_items(channel_response)
        if not channel_items:
            raise ValueError("youtube_channel_not_found")
        try:
            uploads_playlist_id = channel_items[0]["contentDetails"]["relatedPlaylists"]["uploads"]
        except (KeyError, TypeError):
            raise InvalidPlaylistSnapshot("youtube_snapshot_invalid") from None
        if not isinstance(uploads_playlist_id, str) or not uploads_playlist_id.strip():
            raise InvalidPlaylistSnapshot("youtube_snapshot_invalid")
        logger.info("op=youtube_channel_response status=accepted")

        # 플레이리스트의 모든 동영상 가져오기
        next_page_token = None
        page_count = 0
        seen_tokens = set()

        while True:
            page_count += 1
            logger.debug(f"op=youtube_playlist_page_load page={page_count}")

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
            items = _response_items(playlist_response)
            for item in items:
                details = item.get("contentDetails")
                video_id = details.get("videoId") if isinstance(details, dict) else None
                if not isinstance(video_id, str) or re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id) is None:
                    raise InvalidPlaylistSnapshot("youtube_snapshot_invalid")
                urls.append(f"https://www.youtube.com/watch?v={video_id}")
                publication_times.setdefault(urls[-1], _publication_time(details.get("videoPublishedAt")))

            logger.debug(
                f"op=youtube_playlist_page_loaded page={page_count} "
                f"item_count={len(items)}"
            )

            # 다음 페이지 확인
            next_page_token = playlist_response.get("nextPageToken")
            if next_page_token is None or next_page_token == "":
                break
            if (not isinstance(next_page_token, str) or not next_page_token.strip()
                    or next_page_token in seen_tokens or not items):
                raise InvalidPlaylistSnapshot("youtube_snapshot_invalid")
            seen_tokens.add(next_page_token)

        logger.success(
            f"op=youtube_video_url_collection_completed fetched={len(urls)}"
        )
        logger.add_statistic("total_urls_fetched", len(urls))
        logger.add_statistic("youtube_api_calls", api_call_count)

        urls = list(dict.fromkeys(urls))
        dated_count = sum(publication_times[url] is not None for url in urls)
        # Rank known publication dates newest first. Equal dates and undated
        # entries retain provider order; an undated entry has unknown recency.
        urls.sort(key=lambda url: (publication_times[url] is None,
                                  -(publication_times[url] or 0)))
        logger.info(f"op=youtube_url_ordering dated_count={dated_count} "
                    f"provider_order_fallback_count={len(urls) - dated_count}")
        return urls

    except (HttpError, ValueError) as error:
        logger.error(
            f"op=youtube_video_url_collection_failed "
            f"reason={classify_youtube_failure(error)} "
            f"error={safe_error_name(error)}"
        )
        raise


def save_urls(
    urls: List[str],
    urls_file: Path,
    existing_urls: Set[str],
    logger: PipelineLogger,
    dry_run: bool = False,
) -> int:
    """
    최신 스냅샷 먼저, 기존 이력은 순서를 보존한 꼬리로 저장.

    Returns:
        신규 저장된 URL 수
    """
    urls = list(dict.fromkeys(urls))
    historical = urls_file.read_text(encoding="utf-8").splitlines() if urls_file.exists() else []
    merged = list(dict.fromkeys(urls + [line.strip() for line in historical if line.strip()]))
    new_urls = [url for url in urls if url not in existing_urls]
    skip_count = len(urls) - len(new_urls)

    if not dry_run:
        urls_file.parent.mkdir(parents=True, exist_ok=True)
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=urls_file.parent,
                                             prefix=".urls-", delete=False) as f:
                temporary = Path(f.name)
                f.write("".join(url + "\n" for url in merged))
            os.replace(temporary, urls_file)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)

    logger.info(
        f"op=youtube_url_storage_completed new_count={len(new_urls)} "
        f"existing_count={skip_count}"
    )
    logger.add_statistic("new_urls_saved", len(new_urls))
    logger.add_statistic("skipped_existing", skip_count)

    return len(new_urls)


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

    logger.info("op=youtube_channel_collection_started")

    # 기존 URL 로드
    with logger.timer("load_existing_urls"):
        existing_urls = load_existing_urls(urls_file)
    logger.info(f"op=youtube_existing_urls_loaded count={len(existing_urls)}")

    # 동영상 URL 수집
    with logger.timer("fetch_all_video_urls"):
        urls = fetch_all_video_urls(api_key, channel_id, logger)

    # 저장 (신규 추가)
    with logger.timer("save_urls"):
        new_count = save_urls(urls, urls_file, existing_urls, logger, dry_run)
    
    # Playlist absence is not confirmed deletion. Preserve the historical tail
    # and the existing permanent skip ledger without adding inferred entries.
    absent_count = len(existing_urls - set(urls))

    return {
        "channel_name": channel_name,
        "channel_id": channel_id,
        "total_fetched": len(urls),
        "new_saved": new_count,
        "deleted_count": 0,
        "absent_count": absent_count,
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
        print("[ERROR] YOUTUBE_API_KEY_BYEON 환경변수가 설정되지 않았습니다")
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

        logger.info(f"op=collect_urls_started channel_count={len(channel_names)}")

        if args.dry_run:
            logger.warning("DRY-RUN 모드: 실제 저장하지 않음")

        results = []
        for channel_name in channel_names:
            logger.info("op=youtube_channel_collection_started")
            result = collect_channel_urls(channel_name, api_key, logger, args.dry_run)
            results.append(result)

        # 최종 결과 요약
        logger.info("")
        logger.info("=" * 60)
        logger.success("모든 채널 처리 완료")
        logger.info("=" * 60)

        for result in results:
            logger.info(
                f"op=youtube_channel_collection_summary "
                f"new_count={result['new_saved']} "
                f"deleted_count={result.get('deleted_count', 0)} "
                f"total_count={result['total_fetched']}"
            )

    except Exception as error:
        logger.error(
            f"op=collect_urls_failed reason=unexpected_failure "
            f"error={safe_error_name(error)}"
        )
        raise SystemExit(1) from None
    finally:
        logger.end_stage()
        logger.save_json_log()


if __name__ == "__main__":
    main()
