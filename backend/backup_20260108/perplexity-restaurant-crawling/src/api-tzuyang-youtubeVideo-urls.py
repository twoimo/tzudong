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

# .env 파일 로드
load_dotenv('../.env')

# 설정
YOUTUBE_API_KEY = os.getenv('YOUTUBE_API_KEY_BYEON')
TZUYANG_CHANNEL_ID = 'UCG3YWct4Wwy1PiT3q2Vg-HA'  # 쯔양 채널 ID
OUTPUT_FILE = Path(__file__).parent.parent / 'tzuyang_youtubeVideo_urls.txt'


def load_existing_urls(file_path: Path) -> set:
    """
    기존 파일에서 URL 목록을 읽어옵니다.
    
    Args:
        file_path: URL이 저장된 파일 경로
        
    Returns:
        기존 URL들의 set
    """
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
    """
    YouTube 채널의 모든 동영상 URL을 가져옵니다.
    
    Args:
        api_key: YouTube Data API 키
        channel_id: YouTube 채널 ID
        
    Returns:
        동영상 URL 리스트 (최신 순)
    """
    youtube = build('youtube', 'v3', developerKey=api_key)
    video_urls = []
    
    try:
        print('🎬 쯔양 채널의 동영상 목록을 가져오는 중...\n')
        
        # 1. 채널의 업로드 플레이리스트 ID 가져오기
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
        
        # 2. 플레이리스트의 모든 동영상 가져오기 (페이지네이션 처리)
        next_page_token = None
        page_count = 0
        
        while True:
            page_count += 1
            print(f'📄 페이지 {page_count} 로딩 중...')
            
            playlist_response = youtube.playlistItems().list(
                part='snippet',
                playlistId=uploads_playlist_id,
                maxResults=50,  # API 최대값
                pageToken=next_page_token
            ).execute()
            
            # 동영상 URL 추출
            for item in playlist_response.get('items', []):
                video_id = item['snippet']['resourceId']['videoId']
                video_url = f'https://www.youtube.com/watch?v={video_id}'
                title = item['snippet']['title']
                published_at = item['snippet']['publishedAt']
                
                video_urls.append({
                    'url': video_url,
                    'video_id': video_id,
                    'title': title,
                    'published_at': published_at
                })
            
            print(f'   ✅ {len(playlist_response.get("items", []))}개 동영상 추가 '
                  f'(누적: {len(video_urls)}개)')
            
            # 다음 페이지 토큰 확인
            next_page_token = playlist_response.get('nextPageToken')
            if not next_page_token:
                break
        
        print(f'\n🎉 총 {len(video_urls)}개의 동영상을 찾았습니다!\n')
        return video_urls
        
    except HttpError as e:
        print(f'❌ YouTube API 오류: {e}')
        raise
    except Exception as e:
        print(f'❌ 오류 발생: {e}')
        raise


def save_new_urls(video_urls: list, existing_urls: set, output_path: Path) -> None:
    """
    새로운 URL만 필터링하여 파일에 추가합니다.
    
    Args:
        video_urls: 가져온 동영상 정보 리스트
        existing_urls: 기존에 저장된 URL set
        output_path: 저장할 파일 경로
    """
    # 새로운 URL만 필터링
    new_videos = [
        video for video in video_urls 
        if video['url'] not in existing_urls
    ]
    
    if not new_videos:
        print('✨ 새로운 동영상이 없습니다. 모든 URL이 이미 존재합니다.')
        return
    
    print(f'📝 새로운 동영상 {len(new_videos)}개 발견!\n')
    
    # 최신 동영상 5개 미리보기
    print('🆕 최근 추가될 동영상 (최대 5개):')
    for i, video in enumerate(new_videos[:5], 1):
        print(f'{i}. {video["title"]}')
        print(f'   {video["url"]}')
        print(f'   업로드: {video["published_at"][:10]}\n')
    
    # 파일에 추가 (append 모드)
    with open(output_path, 'a', encoding='utf-8') as f:
        for video in new_videos:
            f.write(video['url'] + '\n')
    
    print(f'💾 {output_path}에 {len(new_videos)}개의 새 URL 추가 완료!')
    print(f'📊 전체 URL 개수: {len(existing_urls)} → {len(existing_urls) + len(new_videos)}개')


def main():
    """메인 실행 함수"""
    print('🍜 쯔양 YouTube 채널 URL 수집 시작!\n')
    print('=' * 60)
    print()
    
    # API 키 확인
    if not YOUTUBE_API_KEY:
        print('❌ YOUTUBE_API_KEY 환경변수가 설정되지 않았습니다.\n')
        print('📝 설정 방법:')
        print('1. .env 파일에 추가: YOUTUBE_API_KEY=your_api_key')
        print('2. 또는 export YOUTUBE_API_KEY=your_api_key\n')
        print('💡 API 키 발급: https://console.cloud.google.com/')
        sys.exit(1)
    
    try:
        # 1. 기존 URL 로드
        existing_urls = load_existing_urls(OUTPUT_FILE)
        
        # 2. YouTube에서 모든 동영상 URL 가져오기
        video_urls = fetch_all_video_urls(YOUTUBE_API_KEY, TZUYANG_CHANNEL_ID)
        
        # 3. 새로운 URL만 파일에 추가
        save_new_urls(video_urls, existing_urls, OUTPUT_FILE)
        
        print()
        print('=' * 60)
        print('✅ 모든 작업이 완료되었습니다!')
        
    except KeyboardInterrupt:
        print('\n\n⚠️  사용자에 의해 중단되었습니다.')
        sys.exit(0)
    except Exception as e:
        print(f'\n💥 치명적 오류 발생: {e}')
        sys.exit(1)


if __name__ == '__main__':
    main()
