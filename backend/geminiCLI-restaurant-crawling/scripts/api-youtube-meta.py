#!/usr/bin/env python3
"""
YouTube 메타데이터 추가 스크립트
- JSONL 파일의 각 레코드에 youtube_meta 추가
- YouTube Data API v3 사용
- OpenAI GPT-4o-mini로 광고 주체 분석
- 기존 api-youtube-meta.py와 동일한 기능
"""

import os
import sys
import json
import re
from pathlib import Path
from typing import Dict, Any, Optional, List
from dotenv import load_dotenv

try:
    from googleapiclient.discovery import build
    from openai import OpenAI
except ImportError:
    print("❌ 필수 패키지 설치 필요:")
    print("   pip install google-api-python-client openai python-dotenv")
    sys.exit(1)

# .env 로드 (geminiCLI-restaurant-crawling 폴더의 .env)
env_path = Path(__file__).parent.parent / '.env'
load_dotenv(env_path)

# API 클라이언트 초기화
YOUTUBE_API_KEY = os.getenv('YOUTUBE_API_KEY_BYEON')
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY_BYEON')

if not YOUTUBE_API_KEY:
    print("❌ YOUTUBE_API_KEY_BYEON 환경변수가 설정되지 않았습니다")
    sys.exit(1)

if not OPENAI_API_KEY:
    print("❌ OPENAI_API_KEY_BYEON 환경변수가 설정되지 않았습니다")
    sys.exit(1)

youtube = build('youtube', 'v3', developerKey=YOUTUBE_API_KEY)
openai_client = OpenAI(api_key=OPENAI_API_KEY)


def extract_video_id(url: str) -> Optional[str]:
    """YouTube URL에서 비디오 ID 추출"""
    patterns = [
        r'youtube\.com/watch\?v=([^&]+)',
        r'youtu\.be/([^?]+)',
        r'youtube\.com/embed/([^?]+)',
    ]
    
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None


def parse_duration(duration: str) -> int:
    """ISO 8601 duration을 초 단위로 변환"""
    match = re.match(r'PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?', duration)
    if not match:
        return 0
    
    hours, minutes, seconds = match.groups()
    total_seconds = 0
    if hours:
        total_seconds += int(hours) * 3600
    if minutes:
        total_seconds += int(minutes) * 60
    if seconds:
        total_seconds += int(seconds)
    return total_seconds


def analyze_ad_content(text: str) -> Optional[List[str]]:
    """
    광고/협찬 주체를 GPT-4o-mini로 분석
    
    Args:
        text: 비디오 설명 텍스트 (첫 100자)
        
    Returns:
        광고 주체 리스트 또는 None
    """
    text_preview = text[:100]
    
    try:
        response = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            temperature=0.3,
            messages=[
                {
                    "role": "system",
                    "content": """광고/협찬/지원을 한 **정확한 주체들의 전체 이름(기업명 + 브랜드명 조합 또는 기관명 형태)**을 **리스트** 형식으로 모아 답변하세요.
예시: ['하이트진로', '영양군청'], ['하림 멜팅피스']
반드시 추측하지 않고 **본문 내용에 쓰여 있는 주체들을 모두 작성**해야 합니다.
주체를 찾을 수 없거나 애매하면, 'None'을 출력합니다."""
                },
                {
                    "role": "user",
                    "content": text_preview
                }
            ]
        )
        
        content = response.choices[0].message.content.strip()
        
        if not content or content.lower() == 'none':
            return None
        
        # JSON 파싱 시도
        try:
            parsed = json.loads(content)
        except json.JSONDecodeError:
            # Python literal 파싱 시도
            try:
                import ast
                parsed = ast.literal_eval(content)
            except Exception:
                parsed = [content]
        
        # 리스트로 변환
        if isinstance(parsed, str):
            parsed = [parsed]
        elif not isinstance(parsed, list):
            parsed = [str(parsed)]
        
        # 문자열 정리
        parsed = [str(x).strip() for x in parsed if str(x).strip()]
        
        return parsed if parsed else None
        
    except Exception as e:
        print(f"⚠️  광고 분석 실패: {e}", file=sys.stderr)
        return None


def get_video_info(video_id: str, existing_meta: Optional[Dict] = None) -> Dict[str, Any]:
    """
    YouTube 비디오 메타데이터 가져오기
    
    Args:
        video_id: YouTube 비디오 ID
        existing_meta: 기존 메타데이터 (있으면 재사용)
        
    Returns:
        비디오 메타데이터 딕셔너리
    """
    video_info = {
        'title': None,
        'publishedAt': None,
        'is_shorts': None,
        'duration': None,
        'ads_info': {'is_ads': None, 'what_ads': None}
    }
    
    # 기존 메타 확인
    needs_youtube_api = False
    needs_description = False
    
    if existing_meta:
        if all(key in existing_meta for key in ['title', 'publishedAt', 'duration']):
            video_info.update({
                'title': existing_meta['title'],
                'publishedAt': existing_meta['publishedAt'],
                'duration': existing_meta['duration'],
                'is_shorts': existing_meta.get('duration', 0) <= 180
            })
        else:
            needs_youtube_api = True
        
        if 'ads_info' in existing_meta and existing_meta['ads_info'].get('what_ads') is not None:
            video_info['ads_info'] = existing_meta['ads_info']
        else:
            needs_description = True
    else:
        needs_youtube_api = True
        needs_description = True
    
    # YouTube API 호출
    if needs_youtube_api or needs_description:
        try:
            part = 'snippet,contentDetails'
            response = youtube.videos().list(
                part=part,
                id=video_id
            ).execute()
            
            if not response.get('items'):
                print(f"⚠️  비디오 정보 없음: {video_id}", file=sys.stderr)
                return video_info
            
            item = response['items'][0]
            snippet = item.get('snippet', {})
            content_details = item.get('contentDetails', {})
            
            # 기본 정보
            if needs_youtube_api:
                duration_seconds = parse_duration(content_details.get('duration', 'PT0S'))
                video_info.update({
                    'title': snippet.get('title'),
                    'publishedAt': snippet.get('publishedAt'),
                    'duration': duration_seconds,
                    'is_shorts': duration_seconds <= 180
                })
            
            # 광고 정보
            if needs_description:
                description = snippet.get('description', '')
                
                # "협찬", "광고", "지원" 키워드 확인
                ad_keywords = ['협찬', '광고', '지원']
                is_ads = any(keyword in description for keyword in ad_keywords)
                video_info['ads_info']['is_ads'] = is_ads
                
                if is_ads:
                    what_ads = analyze_ad_content(description)
                    video_info['ads_info']['what_ads'] = what_ads
                else:
                    video_info['ads_info']['what_ads'] = None
        
        except Exception as e:
            print(f"⚠️  YouTube API 오류 ({video_id}): {e}", file=sys.stderr)
    
    return video_info


def enrich_jsonl_with_youtube_meta(input_file: Path, output_file: Path) -> None:
    """
    JSONL 파일의 각 레코드에 youtube_meta 추가
    
    Args:
        input_file: 입력 JSONL 파일 (크롤링 결과)
        output_file: 출력 JSONL 파일 (메타 추가)
    """
    if not input_file.exists():
        print(f"❌ 입력 파일 없음: {input_file}", file=sys.stderr)
        sys.exit(1)
    
    # 기존 데이터 읽기
    existing_data = {}
    if output_file.exists():
        print(f"📂 기존 출력 파일 발견, youtube_meta 재사용")
        with open(output_file, 'r', encoding='utf-8') as f:
            for line in f:
                if not line.strip():
                    continue
                try:
                    record = json.loads(line)
                    video_id = extract_video_id(record.get('youtube_link', ''))
                    if video_id and 'youtube_meta' in record:
                        existing_data[video_id] = record['youtube_meta']
                except Exception:
                    pass
    
    # 입력 파일 읽기
    with open(input_file, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    total = len(lines)
    print(f"📊 총 {total}개 레코드 처리 시작")
    
    # 출력 파일 쓰기
    success_count = 0
    error_count = 0
    
    with open(output_file, 'w', encoding='utf-8') as f:
        for idx, line in enumerate(lines, 1):
            if not line.strip():
                continue
            
            try:
                record = json.loads(line)
                youtube_url = record.get('youtube_link')
                
                if not youtube_url:
                    print(f"⚠️  [{idx}/{total}] youtube_link 없음", file=sys.stderr)
                    f.write(json.dumps(record, ensure_ascii=False) + '\n')
                    error_count += 1
                    continue
                
                video_id = extract_video_id(youtube_url)
                if not video_id:
                    print(f"⚠️  [{idx}/{total}] 비디오 ID 추출 실패: {youtube_url}", file=sys.stderr)
                    f.write(json.dumps(record, ensure_ascii=False) + '\n')
                    error_count += 1
                    continue
                
                # 기존 메타 확인
                existing_meta = existing_data.get(video_id, record.get('youtube_meta'))
                
                # 메타 정보 가져오기
                print(f"[{idx}/{total}] 처리중: {video_id}")
                video_info = get_video_info(video_id, existing_meta)
                
                # 레코드에 추가
                record['youtube_meta'] = video_info
                f.write(json.dumps(record, ensure_ascii=False) + '\n')
                success_count += 1
                
            except Exception as e:
                print(f"❌ [{idx}/{total}] 처리 실패: {e}", file=sys.stderr)
                f.write(line)
                error_count += 1
    
    print(f"\n✅ 완료: {success_count}개 성공, {error_count}개 실패")


def main():
    """메인 실행 함수"""
    if len(sys.argv) < 3:
        print("사용법: fetch_youtube_meta.py <input_jsonl> <output_jsonl>", file=sys.stderr)
        sys.exit(1)
    
    input_file = Path(sys.argv[1])
    output_file = Path(sys.argv[2])
    
    enrich_jsonl_with_youtube_meta(input_file, output_file)


if __name__ == '__main__':
    main()
