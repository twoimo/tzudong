#!/usr/bin/env python3
"""
쯔양 YouTube 채널의 동영상 URL을 수집하는 스크립트
YouTube Data API v3 사용
중복 URL은 자동으로 제외하고 신규 URL만 추가합니다.

날짜별 폴더 구조: data/yy-mm-dd/tzuyang_youtubeVideo_urls.txt
"""

import os
import sys
from pathlib import Path
from datetime import datetime
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from dotenv import load_dotenv

# 유틸리티 모듈 경로 추가
sys.path.insert(0, str(Path(__file__).parent.parent.parent / 'utils'))
from logger import PipelineLogger, LogLevel
from data_utils import DataPathManager

# .env 파일 로드 (backend 루트의 .env)
env_path = Path(__file__).parent.parent.parent / '.env'
load_dotenv(env_path)

# 설정
YOUTUBE_API_KEY = os.getenv('YOUTUBE_API_KEY_BYEON')
TZUYANG_CHANNEL_ID = 'UCG3YWct4Wwy1PiT3q2Vg-HA'  # 쯔양 채널 ID

# 데이터 경로 관리자 초기화
PROJECT_ROOT = Path(__file__).parent.parent
data_manager = DataPathManager(PROJECT_ROOT)

# 출력 파일 경로 (오늘 날짜 폴더)
OUTPUT_FILE = data_manager.get_today_output_path('tzuyang_youtubeVideo_urls.txt')

# 로그 디렉토리 설정
LOG_DIR = Path(__file__).parent.parent.parent / 'log' / 'geminiCLI-restaurant'

# 로거 초기화
logger = PipelineLogger(
    stage_name="youtube-urls",
    log_dir=LOG_DIR
)


def load_existing_urls(file_path: Path) -> set:
    """
    모든 날짜 폴더에서 URL 목록을 읽어옵니다.
    중복 검사를 위해 전체 이력을 로드합니다.
    """
    # 모든 날짜 폴더에서 URL 수집 (중복 방지용)
    all_urls = data_manager.load_all_existing_data('tzuyang_youtubeVideo_urls.txt')
    
    if all_urls:
        logger.info(f"기존 URL 개수 (전체 이력): {len(all_urls)}개")
        logger.add_statistic("existing_urls_count", len(all_urls))
    else:
        logger.info(f"새 파일 생성 예정: {file_path}")
        logger.add_statistic("existing_urls_count", 0)
    
    return all_urls


def fetch_all_video_urls(api_key: str, channel_id: str) -> list:
    """YouTube 채널의 모든 동영상 URL을 가져옵니다."""
    if not api_key:
        logger.error("YOUTUBE_API_KEY_BYEON 환경변수가 설정되지 않았습니다")
        logger.add_statistic("api_error", "API_KEY_NOT_SET")
        sys.exit(1)
    
    youtube = build('youtube', 'v3', developerKey=api_key)
    video_urls = []
    api_call_count = 0
    
    try:
        logger.info('쯔양 채널의 동영상 목록을 가져오는 중...')
        
        # 채널의 업로드 플레이리스트 ID 가져오기
        with logger.timer("youtube_api_channel_list"):
            channel_response = youtube.channels().list(
                part='contentDetails',
                id=channel_id
            ).execute()
            api_call_count += 1
        
        if not channel_response.get('items'):
            logger.error('채널을 찾을 수 없습니다.')
            raise ValueError('채널을 찾을 수 없습니다.')
        
        uploads_playlist_id = (
            channel_response['items'][0]
            ['contentDetails']
            ['relatedPlaylists']
            ['uploads']
        )
        
        logger.info(f'업로드 플레이리스트 ID: {uploads_playlist_id}')
        
        # 플레이리스트의 모든 동영상 가져오기
        next_page_token = None
        page_count = 0
        
        while True:
            page_count += 1
            logger.debug(f'페이지 {page_count} 로딩 중...')
            
            with logger.timer(f"youtube_api_playlist_page_{page_count}"):
                playlist_response = youtube.playlistItems().list(
                    part='snippet',
                    playlistId=uploads_playlist_id,
                    maxResults=50,
                    pageToken=next_page_token
                ).execute()
                api_call_count += 1
            
            # 동영상 URL 추출
            items_count = len(playlist_response.get('items', []))
            for item in playlist_response.get('items', []):
                video_id = item['snippet']['resourceId']['videoId']
                video_url = f'https://www.youtube.com/watch?v={video_id}'
                video_urls.append(video_url)
            
            logger.debug(f'페이지 {page_count}: {items_count}개 동영상 URL 추출')
            
            # 다음 페이지 확인
            next_page_token = playlist_response.get('nextPageToken')
            
            if not next_page_token:
                break
        
        logger.success(f'총 {len(video_urls)}개의 동영상 URL 수집 완료')
        logger.add_statistic("total_videos_fetched", len(video_urls))
        logger.add_statistic("youtube_api_calls", api_call_count)
        logger.add_statistic("pages_processed", page_count)
        
        return video_urls
        
    except HttpError as e:
        logger.error(f'YouTube API 오류: {e}')
        logger.add_statistic("api_error", str(e))
        sys.exit(1)
    except Exception as e:
        logger.error(f'예상치 못한 오류: {e}')
        logger.add_statistic("unexpected_error", str(e))
        sys.exit(1)


def save_urls(file_path: Path, new_urls: list, existing_urls: set):
    """URL을 파일에 저장합니다."""
    # 디렉토리 생성 (data_manager가 이미 처리하지만 안전하게)
    file_path.parent.mkdir(parents=True, exist_ok=True)
    
    # 신규 URL만 필터링 (전체 이력과 비교)
    urls_to_add = [url for url in new_urls if url not in existing_urls]
    duplicate_count = len(new_urls) - len(urls_to_add)
    
    logger.info(f"중복 URL 제외: {duplicate_count}개")
    logger.add_statistic("duplicate_urls_filtered", duplicate_count)
    
    if not urls_to_add:
        logger.warning('추가할 신규 URL이 없습니다.')
        logger.add_statistic("new_urls_added", 0)
        return
    
    # 오늘 날짜 폴더의 파일에 새 URL 저장 (새 파일로 작성)
    with logger.timer("save_urls_to_file"):
        with open(file_path, 'w', encoding='utf-8') as f:
            for url in urls_to_add:
                f.write(url + '\n')
    
    logger.success(f'{len(urls_to_add)}개의 신규 URL 저장 완료')
    logger.info(f'저장 위치: {file_path}')
    logger.add_statistic("new_urls_added", len(urls_to_add))
    logger.add_statistic("output_file", str(file_path))


def main():
    """메인 실행 함수"""
    logger.start_stage()
    
    logger.info('=' * 60)
    logger.info('  쯔양 YouTube 채널 동영상 URL 수집')
    logger.info('=' * 60)
    
    try:
        # 기존 URL 로드
        with logger.timer("load_existing_urls"):
            existing_urls = load_existing_urls(OUTPUT_FILE)
        
        # 동영상 URL 수집
        with logger.timer("fetch_all_video_urls"):
            video_urls = fetch_all_video_urls(YOUTUBE_API_KEY, TZUYANG_CHANNEL_ID)
        
        # URL 저장
        save_urls(OUTPUT_FILE, video_urls, existing_urls)
        
        logger.info('=' * 60)
        logger.success('작업 완료!')
        logger.info('=' * 60)
        
    except Exception as e:
        logger.error(f'실행 중 오류 발생: {e}')
        logger.add_statistic("fatal_error", str(e))
        raise
    finally:
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
        logger.info("  📈 통계:")
        for key, value in summary.get('statistics', {}).items():
            logger.info(f"    - {key}: {value}")
        logger.info("")
        logger.info("  ⏱️ 타이머:")
        for timer_name, timer_data in summary.get('timers', {}).items():
            logger.info(f"    - {timer_name}: {timer_data.get('formatted', 'N/A')}")
        logger.info("=" * 60)
        
        # JSON 로그 저장
        logger.save_json_log()


if __name__ == '__main__':
    main()
