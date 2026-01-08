#!/usr/bin/env python3
"""
YouTube Data API를 이용한 쯔양 채널 URL 수집기
"""

import os
import sys
from pathlib import Path
from datetime import datetime

# dotenv 로드
try:
    from dotenv import load_dotenv
    env_path = Path(__file__).parent.parent / ".env"
    load_dotenv(env_path)
except ImportError:
    pass

try:
    from googleapiclient.discovery import build
    from googleapiclient.errors import HttpError
except ImportError:
    print("❌ google-api-python-client가 설치되어 있지 않습니다.")
    print("   설치 방법: pip install google-api-python-client")
    sys.exit(1)

# 경로 설정
SCRIPT_DIR = Path(__file__).parent
DATA_DIR = SCRIPT_DIR.parent / "data"
URLS_FILE = DATA_DIR / "urls" / "youtube-urls.txt"

# 쯔양 채널 ID
TZUYANG_CHANNEL_ID = 'UCfpaSruWW3S4dibonKXENjA'


def get_youtube_client():
    """YouTube Data API 클라이언트 생성"""
    api_key = os.environ.get("YOUTUBE_API_KEY_BYEON") or os.environ.get("YOUTUBE_API_KEY")
    if not api_key:
        raise ValueError("YOUTUBE_API_KEY_BYEON 환경변수가 설정되지 않았습니다.")
    return build("youtube", "v3", developerKey=api_key)


def load_existing_video_ids() -> set:
    """기존 URL 파일에서 video_id 목록 로드"""
    if not URLS_FILE.exists():
        return set()
    
    video_ids = set()
    with open(URLS_FILE, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#"):
                if "v=" in line:
                    vid = line.split("v=")[1].split("&")[0]
                    video_ids.add(vid)
    return video_ids


def fetch_channel_videos(max_results: int = 50) -> list[str]:
    """쯔양 채널의 영상 목록 수집"""
    print(f"📺 쯔양 채널 영상 수집 (최대 {max_results}개)")
    
    youtube = get_youtube_client()
    video_ids = []
    
    try:
        # 채널의 uploads 재생목록 ID 가져오기
        channel_response = youtube.channels().list(
            part="contentDetails",
            id=TZUYANG_CHANNEL_ID
        ).execute()
        
        if not channel_response.get("items"):
            print(f"❌ 채널을 찾을 수 없습니다: {TZUYANG_CHANNEL_ID}")
            return []
        
        uploads_playlist_id = channel_response["items"][0]["contentDetails"]["relatedPlaylists"]["uploads"]
        
        # 재생목록에서 영상 가져오기
        next_page_token = None
        while len(video_ids) < max_results:
            playlist_response = youtube.playlistItems().list(
                part="contentDetails",
                playlistId=uploads_playlist_id,
                maxResults=min(50, max_results - len(video_ids)),
                pageToken=next_page_token
            ).execute()
            
            for item in playlist_response.get("items", []):
                video_ids.append(item["contentDetails"]["videoId"])
            
            next_page_token = playlist_response.get("nextPageToken")
            if not next_page_token:
                break
        
        print(f"   📊 {len(video_ids)}개 영상 발견")
        return video_ids
        
    except HttpError as e:
        print(f"❌ API 오류: {e}")
        return []


def save_video_urls(video_ids: list[str]):
    """새 video_id들을 URL 파일에 추가"""
    existing_ids = load_existing_video_ids()
    new_ids = [vid for vid in video_ids if vid not in existing_ids]
    
    if not new_ids:
        print("ℹ️ 추가할 새 영상이 없습니다.")
        return 0
    
    URLS_FILE.parent.mkdir(parents=True, exist_ok=True)
    
    with open(URLS_FILE, "a", encoding="utf-8") as f:
        for vid in new_ids:
            f.write(f"https://www.youtube.com/watch?v={vid}\n")
    
    print(f"✅ {len(new_ids)}개 URL 추가됨")
    return len(new_ids)


def main():
    print("🎬 쯔양 채널 YouTube URL Collector\n")
    
    # 인자로 max_results 받기 (옵션)
    max_results = 50
    if len(sys.argv) > 1:
        try:
            max_results = int(sys.argv[1])
        except ValueError:
            pass
    
    try:
        video_ids = fetch_channel_videos(max_results)
        if video_ids:
            save_video_urls(video_ids)
    except ValueError as e:
        print(f"❌ 오류: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
