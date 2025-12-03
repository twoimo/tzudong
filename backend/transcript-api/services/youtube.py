#!/usr/bin/env python3
"""
YouTube Transcript 수집 서비스

youtube-transcript-api를 사용하여 YouTube 자막을 수집합니다.
GitHub API를 통해 원격 브랜치의 파일을 확인합니다.
"""

import json
import re
import sys
import os
import base64
import time
import random
import requests
from pathlib import Path
from typing import Optional, Tuple, List, Dict, Any
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv

# .env 파일 로드
env_path = Path(__file__).parent.parent / '.env'
load_dotenv(env_path)

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
CRAWLING_DATA_DIR = PROJECT_ROOT / "backend" / "geminiCLI-restaurant-crawling" / "data"
LOG_DIR = PROJECT_ROOT / "backend" / "log" / "geminiCLI-restaurant"

# GitHub 설정
GITHUB_TOKEN = os.getenv('GITHUB_PERSONAL_ACCESS_TOKEN_BYEON')
GITHUB_REPO = os.getenv('GITHUB_REPO', 'https://github.com/twoimo/tzudong')
GITHUB_BRANCH = 'github-actions-restaurant'

# GitHub API 설정
def parse_github_repo(repo_url: str) -> Tuple[str, str]:
    """GitHub URL에서 owner/repo 추출"""
    # https://github.com/twoimo/tzudong -> twoimo, tzudong
    match = re.search(r'github\.com/([^/]+)/([^/]+)', repo_url)
    if match:
        return match.group(1), match.group(2).replace('.git', '')
    return '', ''

GITHUB_OWNER, GITHUB_REPO_NAME = parse_github_repo(GITHUB_REPO)

# 로거 임포트 (utils 폴더에서)
sys.path.insert(0, str(PROJECT_ROOT / 'utils'))
try:
    from logger import PipelineLogger
except ImportError:
    # 로거를 찾지 못하면 간단한 대체 로거 사용
    class PipelineLogger:
        def __init__(self, phase, log_dir=None, **kwargs): 
            self.phase = phase
            self._timers = {}
        def info(self, msg, data=None, step=None): print(f"ℹ️ {msg}")
        def success(self, msg, data=None, step=None): print(f"✅ {msg}")
        def warning(self, msg, data=None, step=None): print(f"⚠️ {msg}")
        def error(self, msg, data=None, step=None): print(f"❌ {msg}")
        def debug(self, msg, data=None, step=None): print(f"🔍 {msg}")
        def add_stat(self, key, value): pass
        def add_statistic(self, key, value): pass
        def increment_stat(self, key, amount=1): pass
        def set_processed(self, count): pass
        def increment_success(self, count=1): pass
        def increment_error(self, count=1): pass
        def increment_skip(self, count=1): pass
        def timer(self, name): 
            from contextlib import contextmanager
            import time
            @contextmanager
            def _timer():
                start = time.time()
                try:
                    yield
                finally:
                    elapsed = time.time() - start
                    self._timers[name] = elapsed
            return _timer()
        def start_stage(self): pass
        def end_stage(self): pass
        def save_summary(self): return {}
        def save_json_log(self): pass
        def get_summary(self): return {}


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


# ============================
# GitHub API 함수
# ============================

def get_github_headers() -> Dict[str, str]:
    """GitHub API 헤더 생성"""
    headers = {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'transcript-api'
    }
    if GITHUB_TOKEN:
        headers['Authorization'] = f'token {GITHUB_TOKEN}'
    return headers


def list_github_directories(path: str) -> List[str]:
    """GitHub 브랜치에서 디렉토리 목록 조회"""
    if not GITHUB_OWNER or not GITHUB_REPO_NAME:
        return []
    
    url = f'https://api.github.com/repos/{GITHUB_OWNER}/{GITHUB_REPO_NAME}/contents/{path}'
    params = {'ref': GITHUB_BRANCH}
    
    try:
        response = requests.get(url, headers=get_github_headers(), params=params, timeout=10)
        if response.status_code == 200:
            items = response.json()
            return [item['name'] for item in items if item['type'] == 'dir']
        else:
            print(f"⚠️ GitHub API 디렉토리 조회 실패: {response.status_code}")
            return []
    except Exception as e:
        print(f"⚠️ GitHub API 오류: {e}")
        return []


def get_github_file_content(path: str) -> Optional[str]:
    """GitHub 브랜치에서 파일 내용 가져오기"""
    if not GITHUB_OWNER or not GITHUB_REPO_NAME:
        return None
    
    url = f'https://api.github.com/repos/{GITHUB_OWNER}/{GITHUB_REPO_NAME}/contents/{path}'
    params = {'ref': GITHUB_BRANCH}
    
    try:
        response = requests.get(url, headers=get_github_headers(), params=params, timeout=10)
        if response.status_code == 200:
            data = response.json()
            if data.get('encoding') == 'base64':
                content = base64.b64decode(data['content']).decode('utf-8')
                return content
        return None
    except Exception as e:
        print(f"⚠️ GitHub 파일 조회 오류: {e}")
        return None


def get_pending_urls_from_github() -> Tuple[List[str], Dict[str, Any]]:
    """
    GitHub 원격 브랜치에서 URL과 기존 transcript 확인
    
    Returns:
        (pending_urls, existing_transcripts)
    """
    all_urls = set()
    existing_transcripts = {}
    
    # GitHub에서 날짜 폴더 목록 가져오기
    data_path = 'backend/geminiCLI-restaurant-crawling/data'
    date_folders = list_github_directories(data_path)
    
    if not date_folders:
        print("⚠️ GitHub에서 날짜 폴더를 찾을 수 없습니다. 로컬 파일로 fallback합니다.")
        return get_pending_urls_from_local()
    
    print(f"📂 GitHub에서 {len(date_folders)}개 날짜 폴더 발견")
    
    for folder in date_folders:
        # URL 파일 가져오기
        url_file_path = f'{data_path}/{folder}/tzuyang_youtubeVideo_urls.txt'
        content = get_github_file_content(url_file_path)
        if content:
            for line in content.strip().split('\n'):
                line = line.strip()
                if line:
                    all_urls.add(line)
        
        # Transcript 파일 가져오기
        transcript_file_path = f'{data_path}/{folder}/tzuyang_restaurant_transcripts.json'
        content = get_github_file_content(transcript_file_path)
        if content:
            try:
                data = json.loads(content)
                for item in data:
                    youtube_link = item.get("youtube_link")
                    if youtube_link:
                        existing_transcripts[youtube_link] = item
            except json.JSONDecodeError:
                pass
    
    # 아직 수집 안 된 URL 필터링
    pending_urls = [url for url in all_urls if url not in existing_transcripts]
    
    print(f"📊 GitHub 조회 결과: 전체 URL {len(all_urls)}개, 기존 자막 {len(existing_transcripts)}개, 대기 {len(pending_urls)}개")
    
    return pending_urls, existing_transcripts


def get_pending_urls_from_local() -> Tuple[List[str], Dict[str, Any]]:
    """
    로컬 파일 시스템에서 URL과 기존 transcript 확인 (fallback)
    """
    all_urls = set()
    existing_transcripts = {}
    
    if CRAWLING_DATA_DIR.exists():
        for folder in CRAWLING_DATA_DIR.iterdir():
            if folder.is_dir():
                # URL 파일
                url_file = folder / "tzuyang_youtubeVideo_urls.txt"
                if url_file.exists():
                    with open(url_file, 'r', encoding='utf-8') as f:
                        for line in f:
                            line = line.strip()
                            if line:
                                all_urls.add(line)
                
                # Transcript 파일
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
    
    pending_urls = [url for url in all_urls if url not in existing_transcripts]
    return pending_urls, existing_transcripts


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
    GitHub API 우선, 실패 시 로컬 fallback
    
    Args:
        date_folder: 날짜 폴더 (예: "25-12-02")
    
    Returns:
        (pending_urls, existing_transcripts)
    """
    # GitHub API로 조회 시도
    if GITHUB_TOKEN and GITHUB_OWNER and GITHUB_REPO_NAME:
        print(f"🔍 GitHub 브랜치 '{GITHUB_BRANCH}'에서 파일 확인 중...")
        return get_pending_urls_from_github()
    else:
        print("⚠️ GitHub 토큰이 없습니다. 로컬 파일로 확인합니다.")
        return get_pending_urls_from_local()


def collect_transcripts_for_urls(
    date_folder: str,
    max_urls: Optional[int] = None,
    logger: Optional[PipelineLogger] = None
) -> Dict[str, Any]:
    """
    URL 목록에서 Transcript 수집
    
    Args:
        date_folder: 날짜 폴더 (예: "25-12-02")
        max_urls: 최대 처리할 URL 수 (None이면 전체)
        logger: PipelineLogger 인스턴스 (None이면 새로 생성)
    
    Returns:
        수집 결과 딕셔너리
    """
    # 로거 생성 (없으면 새로 생성)
    if logger is None:
        logger = PipelineLogger(phase="transcript-collect", log_dir=LOG_DIR)
    
    logger.start_stage()
    logger.info(f"📅 날짜 폴더: {date_folder}")
    
    # 날짜 폴더 경로
    data_dir = CRAWLING_DATA_DIR / date_folder
    data_dir.mkdir(parents=True, exist_ok=True)
    
    # 출력 파일
    output_file = data_dir / "tzuyang_restaurant_transcripts.json"
    logger.info(f"📁 출력 파일: {output_file}")
    
    # 대기 중인 URL 가져오기
    with logger.timer("get_pending_urls"):
        pending_urls, existing_transcripts = get_pending_urls(date_folder)
    
    logger.add_stat("existing_transcripts", len(existing_transcripts))
    logger.add_stat("pending_urls", len(pending_urls))
    
    if not pending_urls:
        logger.warning("수집할 신규 URL이 없습니다")
        logger.end_stage()
        logger.save_json_log()
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
        logger.info(f"🔢 최대 URL 제한: {max_urls}개")
    
    # 기존 데이터 로드 (이 날짜 폴더의)
    transcripts = []
    if output_file.exists():
        try:
            with open(output_file, 'r', encoding='utf-8') as f:
                transcripts = json.load(f)
            logger.info(f"📂 기존 데이터 로드: {len(transcripts)}개")
        except Exception as e:
            logger.warning(f"기존 데이터 로드 실패: {e}")
            transcripts = []
    
    # 이미 이 파일에 있는 URL 확인
    existing_in_file = {t.get("youtube_link") for t in transcripts}
    
    # 수집 시작
    success_count = 0
    failed_count = 0
    failed_urls = []
    
    total = len(pending_urls)
    logger.info(f"📹 Transcript 수집 시작: {total}개 URL")
    logger.add_stat("total_urls_to_process", total)
    
    for i, url in enumerate(pending_urls, 1):
        # 이미 이 파일에 있으면 스킵
        if url in existing_in_file:
            continue
        
        video_id = extract_video_id(url)
        if not video_id:
            failed_count += 1
            failed_urls.append({"url": url, "error": "비디오 ID 추출 실패"})
            logger.warning(f"[{i}/{total}] 비디오 ID 추출 실패: {url[:50]}...")
            continue
        
        logger.debug(f"[{i}/{total}] {video_id} 처리 중...")
        
        with logger.timer(f"fetch_transcript_{video_id}"):
            transcript_data, error = get_transcript_for_video(video_id)
        
        if transcript_data:
            transcripts.append({
                "youtube_link": url,
                "transcript": transcript_data,
                "collected_at": datetime.now(KST).isoformat()
            })
            success_count += 1
            logger.success(f"[{i}/{total}] {video_id} ✅ ({len(transcript_data)} segments)")
        else:
            failed_count += 1
            failed_urls.append({"url": url, "error": error})
            logger.error(f"[{i}/{total}] {video_id} ❌ {error}")
        
        # 3개 URL마다 2~5초 랜덤 대기 (IP 차단 방지)
        if i % 3 == 0:
            delay = random.uniform(2, 5)
            logger.debug(f"⏳ {delay:.1f}초 대기 (IP 차단 방지)...")
            time.sleep(delay)
        
        # 20개 URL마다 5~10초 추가 대기 (장기 차단 방지)
        if i % 20 == 0:
            long_delay = random.uniform(5, 10)
            logger.info(f"⏳ {long_delay:.1f}초 장기 대기 ({i}개 처리 완료)...")
            time.sleep(long_delay)
    
    # 결과 저장
    with logger.timer("save_transcripts"):
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(transcripts, f, ensure_ascii=False, indent=2)
    logger.success(f"📁 Transcript 저장 완료: {output_file}")
    
    # 실패 로그 저장
    if failed_urls:
        failed_file = data_dir / "tzuyang_transcript_errors.json"
        with open(failed_file, 'w', encoding='utf-8') as f:
            json.dump(failed_urls, f, ensure_ascii=False, indent=2)
        logger.warning(f"📁 에러 로그 저장: {failed_file} ({len(failed_urls)}개)")
    
    # 통계 추가
    logger.add_stat("success_count", success_count)
    logger.add_stat("failed_count", failed_count)
    logger.add_stat("total_transcripts_in_file", len(transcripts))
    logger.add_stat("output_file", str(output_file))
    
    # 완료 로그
    logger.info(f"✅ 수집 완료: 성공 {success_count}, 실패 {failed_count}")
    logger.end_stage()
    logger.save_json_log()
    
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
