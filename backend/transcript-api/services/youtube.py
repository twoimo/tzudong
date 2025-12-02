#!/usr/bin/env python3
"""
YouTube Transcript 수집 서비스

youtube-transcript-api를 사용하여 YouTube 자막을 수집합니다.
"""

import json
import re
import sys
from pathlib import Path
from typing import Optional, Tuple, List, Dict, Any
from datetime import datetime, timezone, timedelta

# youtube-transcript-api 임포트
try:
    from youtube_transcript_api import YouTubeTranscriptApi
except ImportError:
    print("❌ youtube-transcript-api 패키지 필요:")
    print("   pip install youtube-transcript-api")
    sys.exit(1)

# 한국 시간대 (KST, UTC+9)
KST = timezone(timedelta(hours=9))

# 프로젝트 경로
PROJECT_ROOT = Path(__file__).parent.parent.parent.parent
CRAWLING_DATA_DIR = PROJECT_ROOT / "geminiCLI-restaurant-crawling" / "data"


def extract_video_id(url: str) -> Optional[str]:
    """YouTube URL에서 비디오 ID 추출"""
    patterns = [
        r'youtube\.com/watch\?v=([^&]+)',
        r'youtu\.be/([^?]+)',
        r'youtube\.com/embed/([^?]+)',
        r'youtube\.com/shorts/([^?]+)',
    ]
    
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    
    # URL이 아니라 ID 자체인 경우
    if re.match(r'^[a-zA-Z0-9_-]{11}$', url):
        return url
    
    return None


def get_transcript_for_video(video_id: str) -> Tuple[Optional[List[Dict]], Optional[str]]:
    """
    단일 영상의 자막 가져오기
    
    Returns:
        (transcript_data, error_message)
        - 성공: ([{start, text}, ...], None)
        - 실패: (None, 에러 메시지)
    """
    ytt_api = YouTubeTranscriptApi()
    
    # 언어 우선순위로 시도
    for langs in [['ko'], ['ko-KR'], ['en'], ['en-US']]:
        try:
            transcript_data = ytt_api.fetch(video_id, languages=langs)
            
            # {start: 초단위, text: 자막} 형식으로 변환
            result = []
            for entry in transcript_data:
                result.append({
                    "start": round(entry.start, 2),  # 소수점 2자리
                    "text": entry.text
                })
            
            return result, None
        except Exception:
            continue
    
    # 언어 지정 없이 시도
    try:
        transcript_data = ytt_api.fetch(video_id)
        
        result = []
        for entry in transcript_data:
            result.append({
                "start": round(entry.start, 2),
                "text": entry.text
            })
        
        return result, None
    except Exception as e:
        error_msg = str(e).lower()
        if 'disabled' in error_msg:
            return None, "자막 비활성화"
        elif 'unavailable' in error_msg or 'not found' in error_msg:
            return None, "영상 없음"
        elif 'ip' in error_msg and 'block' in error_msg:
            return None, "IP 차단"
        else:
            return None, f"자막 수집 실패: {str(e)[:100]}"


def get_pending_urls(date_folder: str) -> Tuple[List[str], Dict[str, Any]]:
    """
    수집 대기 중인 URL 목록 조회
    
    Args:
        date_folder: 날짜 폴더 (예: "25-12-02")
    
    Returns:
        (pending_urls, existing_transcripts)
    """
    # URL 파일 경로 (모든 날짜 폴더에서 검색)
    all_urls = set()
    
    # 모든 날짜 폴더에서 URL 수집
    if CRAWLING_DATA_DIR.exists():
        for folder in CRAWLING_DATA_DIR.iterdir():
            if folder.is_dir():
                url_file = folder / "tzuyang_youtubeVideo_urls.txt"
                if url_file.exists():
                    with open(url_file, 'r', encoding='utf-8') as f:
                        for line in f:
                            line = line.strip()
                            if line:
                                all_urls.add(line)
    
    # 이미 수집된 transcript 로드 (모든 날짜 폴더에서)
    existing_transcripts = {}
    if CRAWLING_DATA_DIR.exists():
        for folder in CRAWLING_DATA_DIR.iterdir():
            if folder.is_dir():
                transcript_file = folder / "tzuyang_restaurant_transcripts.json"
                if transcript_file.exists():
                    try:
                        with open(transcript_file, 'r', encoding='utf-8') as f:
                            data = json.load(f)
                            for item in data:
                                youtube_link = item.get("youtube_link")
                                if youtube_link:
                                    existing_transcripts[youtube_link] = item
                    except Exception:
                        pass
    
    # 아직 수집 안 된 URL 필터링
    pending_urls = [url for url in all_urls if url not in existing_transcripts]
    
    return pending_urls, existing_transcripts


def collect_transcripts_for_urls(
    date_folder: str,
    max_urls: Optional[int] = None
) -> Dict[str, Any]:
    """
    URL 목록에서 Transcript 수집
    
    Args:
        date_folder: 날짜 폴더 (예: "25-12-02")
        max_urls: 최대 처리할 URL 수 (None이면 전체)
    
    Returns:
        수집 결과 딕셔너리
    """
    # 날짜 폴더 경로
    data_dir = CRAWLING_DATA_DIR / date_folder
    data_dir.mkdir(parents=True, exist_ok=True)
    
    # 출력 파일
    output_file = data_dir / "tzuyang_restaurant_transcripts.json"
    
    # 대기 중인 URL 가져오기
    pending_urls, existing_transcripts = get_pending_urls(date_folder)
    
    if not pending_urls:
        return {
            "success": True,
            "message": "수집할 신규 URL이 없습니다",
            "total_urls": 0,
            "processed": 0,
            "success_count": 0,
            "failed_count": 0,
            "skipped_count": len(existing_transcripts),
            "output_file": str(output_file)
        }
    
    # 최대 URL 수 제한
    if max_urls:
        pending_urls = pending_urls[:max_urls]
    
    # 기존 데이터 로드 (이 날짜 폴더의)
    transcripts = []
    if output_file.exists():
        try:
            with open(output_file, 'r', encoding='utf-8') as f:
                transcripts = json.load(f)
        except Exception:
            transcripts = []
    
    # 이미 이 파일에 있는 URL 확인
    existing_in_file = {t.get("youtube_link") for t in transcripts}
    
    # 수집 시작
    success_count = 0
    failed_count = 0
    failed_urls = []
    
    total = len(pending_urls)
    print(f"📹 Transcript 수집 시작: {total}개 URL")
    
    for i, url in enumerate(pending_urls, 1):
        # 이미 이 파일에 있으면 스킵
        if url in existing_in_file:
            continue
        
        video_id = extract_video_id(url)
        if not video_id:
            failed_count += 1
            failed_urls.append({"url": url, "error": "비디오 ID 추출 실패"})
            continue
        
        print(f"  [{i}/{total}] {video_id}... ", end="", flush=True)
        
        transcript_data, error = get_transcript_for_video(video_id)
        
        if transcript_data:
            transcripts.append({
                "youtube_link": url,
                "transcript": transcript_data,
                "collected_at": datetime.now(KST).isoformat()
            })
            success_count += 1
            print(f"✅ ({len(transcript_data)} segments)")
        else:
            failed_count += 1
            failed_urls.append({"url": url, "error": error})
            print(f"❌ {error}")
    
    # 결과 저장
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(transcripts, f, ensure_ascii=False, indent=2)
    
    # 실패 로그 저장
    if failed_urls:
        failed_file = data_dir / "tzuyang_transcript_errors.json"
        with open(failed_file, 'w', encoding='utf-8') as f:
            json.dump(failed_urls, f, ensure_ascii=False, indent=2)
    
    print(f"\n✅ 수집 완료: 성공 {success_count}, 실패 {failed_count}")
    print(f"📁 저장 위치: {output_file}")
    
    return {
        "success": True,
        "message": f"수집 완료: 성공 {success_count}, 실패 {failed_count}",
        "total_urls": total,
        "processed": success_count + failed_count,
        "success_count": success_count,
        "failed_count": failed_count,
        "skipped_count": len(existing_transcripts),
        "output_file": str(output_file)
    }


# CLI 실행
if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="YouTube Transcript 수집")
    parser.add_argument("--date", "-d", help="날짜 폴더 (예: 25-12-02)")
    parser.add_argument("--max", "-m", type=int, help="최대 URL 수")
    
    args = parser.parse_args()
    
    date_folder = args.date or datetime.now(KST).strftime("%y-%m-%d")
    
    result = collect_transcripts_for_urls(
        date_folder=date_folder,
        max_urls=args.max
    )
    
    print(json.dumps(result, ensure_ascii=False, indent=2))
