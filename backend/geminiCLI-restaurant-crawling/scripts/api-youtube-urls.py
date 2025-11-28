#!/usr/bin/env python3
"""
쯔양 YouTube 채널의 동영상 URL을 수집하는 스크립트
YouTube Data API v3 사용
중복 URL은 자동으로 제외하고 신규 URL만 추가합니다.
"""

import os
import sys
from pathlib import Path
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from dotenv import load_dotenv

# .env 파일 로드 (backend 루트의 .env)
env_path = Path(__file__).parent.parent.parent / '.env'
load_dotenv(env_path)

# 설정
YOUTUBE_API_KEY = os.getenv('YOUTUBE_API_KEY_BYEON')
TZUYANG_CHANNEL_ID = 'UCG3YWct4Wwy1PiT3q2Vg-HA'  # 쯔양 채널 ID
OUTPUT_FILE = Path(__file__).parent.parent / 'tzuyang_youtubeVideo_urls.txt'


def load_existing_urls(file_path: Path) -> set:
    """기존 파일에서 URL 목록을 읽어옵니다."""
    existing_urls = set()
    
    if file_path.exists():
        print(f"📂 기존 파일 발견: {file_path}")
        with open(file_path, 'r', encoding='utf-8') as f:
            for line in f:
                url = line.strip()
                if url:
                    existing_urls.add(url)
        print(f"   기존 URL 개수: {len(existing_urls)}개\n")
    else:
        print(f"📝 새 파일 생성 예정: {file_path}\n")
    
    return existing_urls


def fetch_all_video_urls(api_key: str, channel_id: str) -> list:
    """YouTube 채널의 모든 동영상 URL을 가져옵니다."""
    if not api_key:
        print("❌ YOUTUBE_API_KEY_BYEON 환경변수가 설정되지 않았습니다")
        sys.exit(1)
    
    youtube = build('youtube', 'v3', developerKey=api_key)
    video_urls = []
    
    try:
        print('🎬 쯔양 채널의 동영상 목록을 가져오는 중...\n')
        
        # 채널의 업로드 플레이리스트 ID 가져오기
        channel_response = youtube.channels().list(
            part='contentDetails',
            id=channel_id
        ).execute()
        
        if not channel_response.get('items'):
            raise ValueError('채널을 찾을 수 없습니다.')
        
        uploads_playlist_id = (
            channel_response['items'][0]
            ['contentDetails']
            ['relatedPlaylists']
            ['uploads']
        )
        
        print(f'📋 업로드 플레이리스트 ID: {uploads_playlist_id}\n')
        
        # 플레이리스트의 모든 동영상 가져오기
        next_page_token = None
        page_count = 0
        
        while True:
            page_count += 1
            print(f'📄 페이지 {page_count} 로딩 중...')
            
            playlist_response = youtube.playlistItems().list(
                part='snippet',
                playlistId=uploads_playlist_id,
                maxResults=50,
                pageToken=next_page_token
            ).execute()
            
            # 동영상 URL 추출
            for item in playlist_response.get('items', []):
                video_id = item['snippet']['resourceId']['videoId']
                video_url = f'https://www.youtube.com/watch?v={video_id}'
                video_urls.append(video_url)
            
            # 다음 페이지 확인
            next_page_token = playlist_response.get('nextPageToken')
            
            if not next_page_token:
                break
        
        print(f'\n✅ 총 {len(video_urls)}개의 동영상 URL 수집 완료\n')
        return video_urls
        
    except HttpError as e:
        print(f'❌ YouTube API 오류: {e}')
        sys.exit(1)
    except Exception as e:
        print(f'❌ 예상치 못한 오류: {e}')
        sys.exit(1)


def save_urls(file_path: Path, new_urls: list, existing_urls: set):
    """URL을 파일에 저장합니다."""
    # 디렉토리 생성
    file_path.parent.mkdir(parents=True, exist_ok=True)
    
    # 신규 URL만 필터링
    urls_to_add = [url for url in new_urls if url not in existing_urls]
    
    if not urls_to_add:
        print('ℹ️  추가할 신규 URL이 없습니다.\n')
        return
    
    # 파일에 추가
    with open(file_path, 'a', encoding='utf-8') as f:
        for url in urls_to_add:
            f.write(url + '\n')
    
    print(f'💾 {len(urls_to_add)}개의 신규 URL 추가 완료')
    print(f'📊 총 URL 개수: {len(existing_urls) + len(urls_to_add)}개\n')


def main():
    """메인 실행 함수"""
    print('=' * 60)
    print('  쯔양 YouTube 채널 동영상 URL 수집')
    print('=' * 60 + '\n')
    
    # 기존 URL 로드
    existing_urls = load_existing_urls(OUTPUT_FILE)
    
    # 동영상 URL 수집
    video_urls = fetch_all_video_urls(YOUTUBE_API_KEY, TZUYANG_CHANNEL_ID)
    
    # URL 저장
    save_urls(OUTPUT_FILE, video_urls, existing_urls)
    
    print('=' * 60)
    print('✅ 작업 완료!')
    print('=' * 60)


if __name__ == '__main__':
    main()
