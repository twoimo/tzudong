import os
import sys
from dotenv import load_dotenv
from googleapiclient.discovery import build
import json
from datetime import datetime
import re
from openai import OpenAI

# 공통 유틸리티 함수 import
sys.path.append(os.path.join(os.path.dirname(__file__), '../../utils'))
from duplicate_checker import load_processed_urls, append_to_jsonl

# Load environment variables
load_dotenv('../.env')

# Initialize OpenAI client
client = OpenAI(api_key=os.getenv('OPENAI_API_KEY_BYEON'))

# YouTube API setup
YOUTUBE_API_KEY = os.getenv('YOUTUBE_API_KEY_BYEON')
youtube = build('youtube', 'v3', developerKey=YOUTUBE_API_KEY)

def extract_video_id(url):
    """Extract video ID from YouTube URL."""
    # Patterns for different types of YouTube URLs
    patterns = [
        r'youtube\.com/watch\?v=([^&]+)',  # Standard watch URL
        r'youtu\.be/([^?]+)',              # Shortened URL
        r'youtube\.com/embed/([^?]+)',      # Embed URL
    ]
    
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None

def parse_duration(duration):
    """Convert ISO 8601 duration to seconds."""
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

import json, ast

def analyze_ad_content(text):
    """
    광고/협찬 주체를 분석하는 함수
    """
    text_preview = text[:100]  # 설명의 첫 100자만 사용
    try:
        response = client.chat.completions.create(
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

        # 응답이 비어있거나 'None'이면 바로 None 반환
        if not content or content.lower() == 'none':
            return None

        # 문자열을 실제 리스트로 안전하게 파싱
        parsed = None
        try:
            # JSON 형태일 경우
            parsed = json.loads(content)
        except json.JSONDecodeError:
            try:
                # Python literal 형태일 경우
                parsed = ast.literal_eval(content)
            except Exception:
                # 그냥 문자열 하나인 경우
                parsed = [content]

        # 리스트로 강제 변환
        if isinstance(parsed, str):
            parsed = [parsed]
        elif not isinstance(parsed, list):
            parsed = [str(parsed)]

        # 문자열 정리 (공백 제거 + 빈 항목 제외)
        parsed = [str(x).strip() for x in parsed if str(x).strip()]

        return parsed if parsed else None

    except Exception as e:
        print(f"Error analyzing ad content: {str(e)}")
        return None  # API 호출 실패 시 기본값


def get_video_info(video_id, existing_meta=None):
    """YouTube API를 사용하여 비디오 정보를 가져오는 함수"""
    try:
        # 반환할 데이터 구조 초기화
        video_info = {
            'title': None,
            'publishedAt': None,
            'is_shorts': None,
            'duration': None,
            'ads_info': {'is_ads': None, 'what_ads': None}
        }

        # API 호출 필요성 체크를 위한 플래그
        needs_youtube_api = False
        needs_description = False

        if existing_meta:
            # 기존 메타데이터 활용
            if all(key in existing_meta for key in ['title', 'publishedAt', 'duration']):
                video_info.update({
                    'title': existing_meta['title'],
                    'publishedAt': existing_meta['publishedAt'],
                    'duration': existing_meta['duration'],
                    'is_shorts': existing_meta['duration'] <= 180 or video_id == 'h6Lf1PG3kT8'
                })
            else:
                needs_youtube_api = True

            # 광고 정보 확인
            if 'ads_info' in existing_meta:
                video_info['ads_info'] = existing_meta['ads_info']
                if video_info['ads_info'].get('what_ads') is None:
                    needs_description = True
            else:
                needs_description = True
        else:
            needs_youtube_api = True
            needs_description = True

        # YouTube API 호출이 필요한 경우
        if needs_youtube_api or needs_description:
            request = youtube.videos().list(
                part="snippet,contentDetails,status",
                id=video_id
            )
            response = request.execute()

            if not response['items']:
                return None

            video_data = response['items'][0]
            snippet = video_data['snippet']

            if needs_youtube_api:
                content_details = video_data['contentDetails']
                duration = parse_duration(content_details['duration'])
                video_info.update({
                    'title': snippet['title'],
                    'publishedAt': snippet['publishedAt'],
                    'duration': duration,
                    'is_shorts': duration <= 180 or video_id == 'h6Lf1PG3kT8'
                })

            if needs_description:
                description = snippet.get('description', '')
                description_lower = description.lower()
                ad_keywords = ['유료', '광고', '지원', '협찬']
                is_ads = any(keyword in description_lower for keyword in ad_keywords)
                
                video_info['ads_info'] = {
                    'is_ads': is_ads,
                    'what_ads': analyze_ad_content(description) if is_ads else None
                }

        return video_info
    except Exception as e:
        print(f"Error fetching data for video {video_id}: {str(e)}")
        return None

def process_jsonl_file(input_file, output_file):
    """
    JSONL 파일의 각 레코드에 대해 YouTube 메타데이터를 처리하는 함수
    중복된 youtube_link는 건너뛰고 새로운 항목만 append 모드로 추가합니다.
    """
    import time
    import os

    # 1. 기존 output 파일에서 처리된 URL 로드
    print(f"🔍 기존 처리 내역 확인 중...")
    processed_urls = load_processed_urls(output_file)
    print(f"✅ 이미 처리된 URL: {len(processed_urls)}개\n")

    # 2. 기존 출력 파일이 있는 경우 메타데이터 캐시 구성
    existing_data = {}
    if os.path.exists(output_file):
        print(f"📂 기존 메타데이터 파일 발견: {output_file}")
        with open(output_file, 'r', encoding='utf-8') as f:
            for line in f:
                record = json.loads(line.strip())
                if 'youtube_link' in record and record['youtube_link']:
                    video_id = extract_video_id(record['youtube_link'])
                    if video_id and 'youtube_meta' in record:
                        existing_data[video_id] = record['youtube_meta']
        print(f"📊 로드된 비디오 메타데이터: {len(existing_data)}개\n")

    # 3. 입력 파일 읽기
    with open(input_file, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    # 4. 중복 제외한 새로운 레코드만 필터링
    new_records = []
    duplicate_count = 0
    
    for line in lines:
        record = json.loads(line.strip())
        youtube_link = record.get('youtube_link')
        
        if youtube_link and youtube_link not in processed_urls:
            new_records.append(record)
        elif youtube_link:
            duplicate_count += 1
    
    print(f"📋 처리 대상:")
    print(f"   - 전체 입력 항목: {len(lines)}개")
    print(f"   - 중복 제외: {duplicate_count}개")
    print(f"   - 새로 처리할 항목: {len(new_records)}개\n")
    
    if len(new_records) == 0:
        print("✅ 모든 항목이 이미 처리되었습니다!")
        return
    
    # 5. 새로운 레코드 처리 및 append
    processed_count = 0
    failed_count = 0
    
    try:
        for i, record in enumerate(new_records):
            if 'youtube_link' in record and record['youtube_link']:
                video_id = extract_video_id(record['youtube_link'])
                if video_id:
                    # 캐시된 메타데이터 확인 후, 없으면 기존 레코드에서 확인
                    existing_meta = existing_data.get(video_id, record.get('youtube_meta', {}))
                    if i > 0:
                        time.sleep(1)  # API 호출 간 1초 간격 유지
                    
                    print(f"🎬 처리 중 {i+1}/{len(new_records)}: {video_id}")
                    video_info = get_video_info(video_id, existing_meta)
                    
                    if video_info:
                        record['youtube_meta'] = video_info
                        print(f"   ✅ 메타데이터: {video_info.get('title', 'N/A')[:50]}...")
                        
                        # 즉시 append (안전성 보장)
                        append_to_jsonl(output_file, record)
                        processed_urls.add(record['youtube_link'])
                        processed_count += 1
                    else:
                        print(f"   ⚠️  메타데이터 가져오기 실패")
                        failed_count += 1

        # 6. 최종 통계
        print(f"\n{'='*60}")
        print(f"📊 처리 완료!")
        print(f"{'='*60}")
        print(f"✅ 성공: {processed_count}개")
        print(f"❌ 실패: {failed_count}개")
        print(f"💾 결과 저장: {output_file}")
        print(f"{'='*60}\n")
    
    except Exception as e:
        print(f"\n❌ 처리 중 오류 발생: {str(e)}")
        print(f"📊 처리 완료: {processed_count}개")
        raise

if __name__ == "__main__":
    input_file = "../tzuyang_restaurant_results.jsonl"
    output_file = "../tzuyang_restaurant_results_with_meta.jsonl"
    
    if not YOUTUBE_API_KEY:
        print("Error: YOUTUBE_API_KEY not found in environment variables")
        exit(1)
    
    try:
        process_jsonl_file(input_file, output_file)
        print("Processing completed. Results saved to:", output_file)
    except Exception as e:
        print(f"Error occurred: {str(e)}")
