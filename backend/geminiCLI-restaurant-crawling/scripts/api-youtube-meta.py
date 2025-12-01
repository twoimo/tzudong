#!/usr/bin/env python3
"""
YouTube 메타데이터 추가 스크립트
- JSONL 파일의 각 레코드에 youtube_meta 추가
- YouTube Data API v3 사용
- OpenAI GPT-4o-mini로 광고 주체 분석

날짜별 폴더 구조: data/yy-mm-dd/
- 입력: 인자로 받거나 오늘 폴더의 tzuyang_restaurant_results.jsonl
- 출력: 오늘 폴더의 tzuyang_restaurant_results_with_meta.jsonl
"""

import os
import sys
import json
import re
from pathlib import Path
from typing import Dict, Any, Optional, List
from datetime import datetime
from dotenv import load_dotenv

# 유틸리티 모듈 경로 추가
sys.path.insert(0, str(Path(__file__).parent.parent.parent / 'utils'))
from logger import PipelineLogger, LogLevel
from data_utils import DataPathManager

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

# 로그 디렉토리 설정
LOG_DIR = Path(__file__).parent.parent.parent / 'log' / 'geminiCLI-restaurant'

# 로거 초기화
logger = PipelineLogger(
    stage_name="youtube-meta",
    log_dir=LOG_DIR
)

# API 클라이언트 초기화
YOUTUBE_API_KEY = os.getenv('YOUTUBE_API_KEY_BYEON')
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY_BYEON')

if not YOUTUBE_API_KEY:
    logger.error("YOUTUBE_API_KEY_BYEON 환경변수가 설정되지 않았습니다")
    sys.exit(1)

if not OPENAI_API_KEY:
    logger.error("OPENAI_API_KEY_BYEON 환경변수가 설정되지 않았습니다")
    sys.exit(1)

youtube = build('youtube', 'v3', developerKey=YOUTUBE_API_KEY)
openai_client = OpenAI(api_key=OPENAI_API_KEY)

# API 호출 통계
youtube_api_calls = 0
openai_api_calls = 0
youtube_api_errors = 0
openai_api_errors = 0


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
    global openai_api_calls, openai_api_errors
    
    text_preview = text[:100]
    
    try:
        with logger.timer("openai_api_call"):
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
        openai_api_calls += 1
        
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
        openai_api_errors += 1
        logger.warning(f"광고 분석 실패: {e}")
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
    global youtube_api_calls, youtube_api_errors
    
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
            logger.debug(f"기존 메타 재사용: {video_id}")
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
            with logger.timer("youtube_api_call"):
                response = youtube.videos().list(
                    part=part,
                    id=video_id
                ).execute()
            youtube_api_calls += 1
            
            if not response.get('items'):
                logger.warning(f"비디오 정보 없음: {video_id}")
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
            youtube_api_errors += 1
            logger.error(f"YouTube API 오류 ({video_id}): {e}")
    
    return video_info


def enrich_jsonl_with_youtube_meta(input_file: Path, output_file: Path) -> None:
    """
    JSONL 파일의 각 레코드에 youtube_meta 추가
    
    Args:
        input_file: 입력 JSONL 파일 (크롤링 결과)
        output_file: 출력 JSONL 파일 (메타 추가)
    """
    global youtube_api_calls, openai_api_calls
    
    if not input_file.exists():
        logger.error(f"입력 파일 없음: {input_file}")
        sys.exit(1)
    
    # 기존 데이터 읽기
    existing_data = {}
    reused_meta_count = 0
    if output_file.exists():
        logger.info("기존 출력 파일 발견, youtube_meta 재사용")
        with open(output_file, 'r', encoding='utf-8') as f:
            for line in f:
                if not line.strip():
                    continue
                try:
                    record = json.loads(line)
                    video_id = extract_video_id(record.get('youtube_link', ''))
                    if video_id and 'youtube_meta' in record:
                        existing_data[video_id] = record['youtube_meta']
                        reused_meta_count += 1
                except Exception:
                    pass
        logger.info(f"재사용 가능한 메타: {reused_meta_count}개")
    
    # 입력 파일 읽기
    with open(input_file, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    total = len(lines)
    logger.info(f"총 {total}개 레코드 처리 시작")
    logger.add_statistic("total_records", total)
    
    # 출력 파일 쓰기
    success_count = 0
    error_count = 0
    ads_detected = 0
    shorts_count = 0
    
    with logger.timer("process_all_records"):
        with open(output_file, 'w', encoding='utf-8') as f:
            for idx, line in enumerate(lines, 1):
                if not line.strip():
                    continue
                
                try:
                    record = json.loads(line)
                    youtube_url = record.get('youtube_link')
                    
                    if not youtube_url:
                        logger.warning(f"[{idx}/{total}] youtube_link 없음")
                        f.write(json.dumps(record, ensure_ascii=False) + '\n')
                        error_count += 1
                        continue
                    
                    video_id = extract_video_id(youtube_url)
                    if not video_id:
                        logger.warning(f"[{idx}/{total}] 비디오 ID 추출 실패: {youtube_url}")
                        f.write(json.dumps(record, ensure_ascii=False) + '\n')
                        error_count += 1
                        continue
                    
                    # 기존 메타 확인
                    existing_meta = existing_data.get(video_id, record.get('youtube_meta'))
                    
                    # 메타 정보 가져오기
                    logger.debug(f"[{idx}/{total}] 처리중: {video_id}")
                    with logger.timer(f"get_video_info_{idx}"):
                        video_info = get_video_info(video_id, existing_meta)
                    
                    # 통계 수집
                    if video_info.get('ads_info', {}).get('is_ads'):
                        ads_detected += 1
                    if video_info.get('is_shorts'):
                        shorts_count += 1
                    
                    # 레코드에 추가
                    record['youtube_meta'] = video_info
                    f.write(json.dumps(record, ensure_ascii=False) + '\n')
                    success_count += 1
                    
                    # 진행률 출력 (10개마다)
                    if idx % 10 == 0:
                        logger.info(f"진행률: {idx}/{total} ({idx*100//total}%)")
                    
                except Exception as e:
                    logger.error(f"[{idx}/{total}] 처리 실패: {e}")
                    f.write(line)
                    error_count += 1
    
    # 통계 저장
    logger.add_statistic("success_count", success_count)
    logger.add_statistic("error_count", error_count)
    logger.add_statistic("reused_meta_count", reused_meta_count)
    logger.add_statistic("youtube_api_calls", youtube_api_calls)
    logger.add_statistic("openai_api_calls", openai_api_calls)
    logger.add_statistic("youtube_api_errors", youtube_api_errors)
    logger.add_statistic("openai_api_errors", openai_api_errors)
    logger.add_statistic("ads_detected", ads_detected)
    logger.add_statistic("shorts_count", shorts_count)
    
    if total > 0:
        success_rate = success_count * 100 / total
        logger.add_statistic("success_rate", f"{success_rate:.1f}%")
    
    logger.success(f"완료: {success_count}개 성공, {error_count}개 실패")


def main():
    """메인 실행 함수"""
    logger.start_stage()
    
    # 데이터 경로 관리자 초기화
    project_root = Path(__file__).parent.parent
    data_manager = DataPathManager(project_root)
    
    # 인자가 있으면 사용, 없으면 오늘 폴더 경로 사용
    if len(sys.argv) >= 3:
        input_file = Path(sys.argv[1])
        output_file = Path(sys.argv[2])
    else:
        # 오늘 날짜 폴더에서 입출력
        today_folder = data_manager.get_today_folder()
        input_file = today_folder / 'tzuyang_restaurant_results.jsonl'
        output_file = today_folder / 'tzuyang_restaurant_results_with_meta.jsonl'
    
    logger.info("=" * 60)
    logger.info("  YouTube 메타데이터 추가")
    logger.info("=" * 60)
    logger.info(f"입력 파일: {input_file}")
    logger.info(f"출력 파일: {output_file}")
    
    try:
        enrich_jsonl_with_youtube_meta(input_file, output_file)
    except Exception as e:
        logger.error(f"실행 중 오류 발생: {e}")
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
        logger.info("=" * 60)
        
        # JSON 로그 저장
        logger.save_json_log()


if __name__ == '__main__':
    main()
