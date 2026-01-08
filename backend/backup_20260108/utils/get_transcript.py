#!/usr/bin/env python3
"""
YouTube 자막(Transcript) 가져오기 유틸리티
- youtube-transcript-api 사용 (v1.x 호환)
- 한국어 자막 우선, 없으면 영어, 자동 생성 자막 순서로 시도
"""

import re
import sys
from typing import Optional, Tuple

try:
    from youtube_transcript_api import YouTubeTranscriptApi
except ImportError:
    print("❌ youtube-transcript-api 패키지 필요:")
    print("   pip install youtube-transcript-api")
    sys.exit(1)


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


def get_transcript(video_id_or_url: str, max_chars: int = 50000, with_timestamps: bool = True) -> Tuple[Optional[str], Optional[str]]:
    """
    YouTube 자막 가져오기 (v1.x API 호환)
    
    Args:
        video_id_or_url: YouTube 비디오 ID 또는 URL
        max_chars: 최대 문자 수 (기본 50000자, 약 12,500 토큰)
        with_timestamps: 타임스탬프 포함 여부 (기본 True)
        
    Returns:
        (transcript_text, error_message)
        - 성공: (자막 텍스트, None)
        - 실패: (None, 에러 메시지)
    """
    video_id = extract_video_id(video_id_or_url)
    if not video_id:
        return None, f"비디오 ID 추출 실패: {video_id_or_url}"
    
    # 자막 언어 우선순위
    language_priorities = ['ko', 'ko-KR', 'en', 'en-US']
    
    ytt_api = YouTubeTranscriptApi()
    
    try:
        # 사용 가능한 자막 목록 가져오기
        transcript_list = ytt_api.list(video_id)
    except Exception as e:
        error_msg = str(e).lower()
        if 'disabled' in error_msg:
            return None, "자막이 비활성화된 영상입니다"
        elif 'unavailable' in error_msg or 'not found' in error_msg:
            return None, "영상을 찾을 수 없습니다"
        else:
            return None, f"자막 목록 조회 실패: {str(e)}"
    
    # 수동 자막 먼저 시도
    transcript = None
    
    for lang in language_priorities:
        try:
            transcript = transcript_list.find_transcript([lang])
            break
        except Exception:
            continue
    
    # 수동 자막 없으면 자동 생성 자막 시도
    if transcript is None:
        try:
            # 자동 생성 자막 중 한국어/영어 찾기
            for t in transcript_list:
                if t.is_generated and (t.language_code.startswith('ko') or t.language_code.startswith('en')):
                    transcript = t
                    break
            
            # 그래도 없으면 아무 자막이나
            if transcript is None:
                for t in transcript_list:
                    transcript = t
                    break
                    
        except Exception:
            pass
    
    if transcript is None:
        return None, "사용 가능한 자막이 없습니다"
    
    # 자막 품질 정보
    is_auto_generated = getattr(transcript, 'is_generated', False)
    
    try:
        # 자막 데이터 가져오기
        transcript_data = transcript.fetch()
        
        # 헤더 추가 (자동 생성 여부)
        header = ""
        if is_auto_generated:
            header = "⚠️ 자동 생성 자막 (품질이 낮을 수 있음)\n---\n"
        
        if with_timestamps:
            # 타임스탬프 포함 형식: [MM:SS] 텍스트
            lines = []
            for entry in transcript_data:
                minutes = int(entry.start // 60)
                seconds = int(entry.start % 60)
                lines.append(f'[{minutes:02d}:{seconds:02d}] {entry.text}')
            full_text = header + '\n'.join(lines)
        else:
            # 텍스트만 추출하여 합치기
            texts = [entry.text for entry in transcript_data]
            full_text = header + ' '.join(texts)
            # 줄바꿈 정리
            full_text = re.sub(r'\s+', ' ', full_text).strip()
        
        # 최대 길이 제한
        if len(full_text) > max_chars:
            full_text = full_text[:max_chars] + "\n... (자막 일부 생략)"
        
        return full_text, None
        
    except Exception as e:
        return None, f"자막 가져오기 실패: {str(e)}"


def get_transcript_simple(video_id_or_url: str, max_chars: int = 50000, with_timestamps: bool = True) -> Tuple[Optional[str], Optional[str]]:
    """
    YouTube 자막 가져오기 (간단 버전 - fetch 직접 사용)
    
    Args:
        video_id_or_url: YouTube 비디오 ID 또는 URL
        max_chars: 최대 문자 수
        with_timestamps: 타임스탬프 포함 여부
        
    Returns:
        (transcript_text, error_message)
    """
    video_id = extract_video_id(video_id_or_url)
    if not video_id:
        return None, f"비디오 ID 추출 실패: {video_id_or_url}"
    
    ytt_api = YouTubeTranscriptApi()
    
    # 언어 우선순위로 시도
    for langs in [['ko'], ['ko-KR'], ['en'], ['en-US']]:
        try:
            transcript_data = ytt_api.fetch(video_id, languages=langs)
            
            if with_timestamps:
                lines = []
                for entry in transcript_data:
                    minutes = int(entry.start // 60)
                    seconds = int(entry.start % 60)
                    lines.append(f'[{minutes:02d}:{seconds:02d}] {entry.text}')
                full_text = '\n'.join(lines)
            else:
                texts = [entry.text for entry in transcript_data]
                full_text = ' '.join(texts)
                full_text = re.sub(r'\s+', ' ', full_text).strip()
            
            if len(full_text) > max_chars:
                full_text = full_text[:max_chars] + "\n... (자막 일부 생략)"
            
            return full_text, None
        except Exception:
            continue
    
    # 언어 지정 없이 시도
    try:
        transcript_data = ytt_api.fetch(video_id)
        
        if with_timestamps:
            lines = []
            for entry in transcript_data:
                minutes = int(entry.start // 60)
                seconds = int(entry.start % 60)
                lines.append(f'[{minutes:02d}:{seconds:02d}] {entry.text}')
            full_text = '\n'.join(lines)
        else:
            texts = [entry.text for entry in transcript_data]
            full_text = ' '.join(texts)
            full_text = re.sub(r'\s+', ' ', full_text).strip()
        
        if len(full_text) > max_chars:
            full_text = full_text[:max_chars] + "\n... (자막 일부 생략)"
        
        return full_text, None
    except Exception as e:
        error_msg = str(e).lower()
        if 'disabled' in error_msg:
            return None, "자막이 비활성화된 영상입니다"
        elif 'unavailable' in error_msg or 'not found' in error_msg:
            return None, "영상을 찾을 수 없습니다"
        else:
            return None, f"자막 가져오기 실패: {str(e)}"


def main():
    """CLI 실행"""
    if len(sys.argv) < 2:
        print("사용법: get_transcript.py <youtube_url_or_id> [max_chars]")
        print("예시: get_transcript.py https://www.youtube.com/watch?v=QuwlZxZHHq0")
        print("      get_transcript.py QuwlZxZHHq0 30000")
        sys.exit(1)
    
    video_input = sys.argv[1]
    max_chars = int(sys.argv[2]) if len(sys.argv) > 2 else 50000
    
    # 상세 버전 사용 (자동 생성 여부 포함)
    transcript, error = get_transcript(video_input, max_chars, with_timestamps=True)
    
    if error:
        # 실패하면 간단 버전 시도
        transcript, error = get_transcript_simple(video_input, max_chars, with_timestamps=True)
    
    if error:
        print(f"❌ 에러: {error}", file=sys.stderr)
        sys.exit(1)
    
    print(transcript)


if __name__ == '__main__':
    main()
