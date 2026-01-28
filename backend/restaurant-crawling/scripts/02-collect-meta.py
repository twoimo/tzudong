#!/usr/bin/env python3
"""
YouTube 메타데이터 & 썸네일 수집 스크립트 (recollect_id 기반)
- API로 메타데이터 및 썸네일 확인
- 썸네일 변경 감지 (MD5 해시)
- 변경 사유 리스트 관리 (recollect_vars)
- 주기적 수집 스케줄링 적용

사용법:
    python 02-collect-meta.py --channel tzuyang
    python 02-collect-meta.py --channel meatcreator
    python 02-collect-meta.py  # 모든 채널
"""

import os
import sys
import json
import re
import argparse
import hashlib
import requests
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, Optional, List

# 유틸리티 모듈 경로 추가
sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from utils.config_loader import (
    get_channel_info,
    get_all_channels,
    get_channel_data_path,
    get_api_key,
    get_api_config,
)
from utils.logger import PipelineLogger
from utils.duplicate_checker import append_to_jsonl

try:
    from googleapiclient.discovery import build
    from openai import OpenAI
    from dotenv import load_dotenv
except ImportError:
    print("❌ 필수 패키지 설치 필요:")
    print("   pip install google-api-python-client openai python-dotenv requests")
    sys.exit(1)

# .env 로드
env_path = Path(__file__).parent.parent.parent / ".env.local"
if not env_path.exists():
    env_path = Path(__file__).parent.parent.parent / ".env"
load_dotenv(env_path)

# KST (UTC+9)
KST = timezone(timedelta(hours=9))

# 로그 디렉토리
LOG_DIR = Path(__file__).parent.parent.parent / "log" / "restaurant-crawling"


def extract_video_id(url: str) -> Optional[str]:
    patterns = [
        r"youtube\.com/watch\?v=([^&]+)",
        r"youtu\.be/([^?]+)",
        r"youtube\.com/embed/([^?]+)",
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None


def parse_duration(duration: str) -> int:
    match = re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", duration)
    if not match:
        return 0
    hours, minutes, seconds = match.groups()
    total = 0
    if hours:
        total += int(hours) * 3600
    if minutes:
        total += int(minutes) * 60
    if seconds:
        total += int(seconds)
    return total


def get_latest_meta(channel_data_path: Path, video_id: str) -> Optional[Dict]:
    meta_file = channel_data_path / "meta" / f"{video_id}.jsonl"
    if not meta_file.exists():
        return None
    try:
        with open(meta_file, "r", encoding="utf-8") as f:
            lines = f.readlines()
            if lines:
                return json.loads(lines[-1].strip())
    except Exception:
        pass
    return None


def get_image_hash(url: str) -> Optional[str]:
    """썸네일 이미지의 MD5 해시 계산"""
    try:
        response = requests.get(url, timeout=5)
        if response.status_code == 200:
            return hashlib.md5(response.content).hexdigest()
    except Exception:
        pass
    return None



def check_thumbnail_exists(channel_data_path: Path, video_id: str, recollect_id: int) -> bool:
    """해당 버전의 썸네일 파일 존재 여부 확인"""
    thumb_dir = channel_data_path / "thumbnails"
    # 확장자를 모르므로 glob 패턴 사용 (jpg, png, webp 등)
    pattern = f"{video_id}-{recollect_id}.*"
    return any(thumb_dir.glob(pattern))


def get_schedule_frequency(published_at_str: str) -> Optional[str]:
    """
    영상 age에 따른 수집 주기 결정 (KST 기준)
    - D+0 ~ D+5: 수집 대기 (숙성기)
    - D+5 ~ D+14: 매일 확인 (scheduled_daily) -> 최초 히트맵 포착을 위해 집중 모니터링
    - D+14 ~ ∞ : 월 1회 (scheduled_monthly) -> 장기 변화 감지 (전수 검사)
    """
    if not published_at_str:
        return "scheduled_monthly" # fallback

    pub_date = datetime.fromisoformat(published_at_str.replace("Z", "+00:00")).astimezone(KST)
    now = datetime.now(KST)
    
    # safe delta calculation
    delta = now - pub_date
    days_diff = delta.days
    
    if days_diff < 0:
        return None 
        
    if days_diff < 5:
        # 5일 미만은 대기 (숙성)
        return None
        
    elif days_diff < 14:
        # 5일 ~ 14일: 최초 히트맵 확보를 위해 매일 체크
        return "scheduled_daily"
        
    else:
        # 14일 이후: 월 1회 전수 검사 (변화 없으면 스킵됨)
        return "scheduled_monthly"


def check_schedule_condition(frequency: str, video_id: str) -> bool:
    """
    frequency에 따라 오늘 수집해야 하는지 결정
    해싱을 사용하여 부하 분산
    """
    if not frequency:
        return False # None이면 수집 안함
        
    if frequency == "scheduled_daily":
        return True # 매일

    today = datetime.now(KST).date()
    # video_id 해싱 -> 0~99
    vid_hash = int(hashlib.md5(video_id.encode()).hexdigest(), 16) % 100
    
    if frequency == "scheduled_weekly":
        return (vid_hash % 7) == today.weekday()
        
    if frequency == "scheduled_biweekly":
        days_since_epoch = (today - datetime(2024, 1, 1).date()).days
        return (days_since_epoch % 14) == (vid_hash % 14)
    
    if frequency == "scheduled_monthly":
        days_since_epoch = (today - datetime(2024, 1, 1).date()).days
        # 해시 충돌 분산 (30일 주기)
        return (days_since_epoch % 30) == (vid_hash % 30)
        
    return False


def get_meta_history(channel_path: Path, video_id: str, max_records: int = 7) -> List[Dict]:
    """JSONL 파일에서 최근 N개의 메타데이터 히스토리 로드"""
    meta_file = channel_path / "meta" / f"{video_id}.jsonl"
    if not meta_file.exists():
        return []
    try:
        lines = meta_file.read_text().strip().split('\n')
        return [json.loads(line) for line in lines[-max_records:] if line]
    except Exception:
        return []





def detect_changes(current: Dict, previous: Dict, channel_path: Path = None, video_id: str = None) -> List[str]:
    """변경 사항 감지 및 리스트 반환 (recollect_vars)"""
    changes = []
    
    if previous is None:
        return ["new_video"]

    # 1. 제목
    if current.get("title") != previous.get("title"):
        changes.append("title_changed")

    # 2. 재생 시간 (1초 이상 차이)
    curr_dur = current.get("duration", 0)
    prev_dur = previous.get("duration", 0)
    if abs(curr_dur - prev_dur) > 1:
        changes.append("duration_changed")

    # 3. 썸네일 (해시 비교)
    # 참고: YouTube API는 항상 URL을 반환합니다. 해시 확인을 통해 실제 이미지 변경 여부를 확인합니다.
    curr_thumb_hash = current.get("thumbnail_hash")
    prev_thumb_hash = previous.get("thumbnail_hash")
    
    if curr_thumb_hash and prev_thumb_hash and curr_thumb_hash != prev_thumb_hash:
        changes.append("thumbnail_changed")
    


    return changes


def analyze_ad_content(
    openai_client: OpenAI, text: str, logger: PipelineLogger
) -> Optional[List[str]]:
    """광고/협찬 주체를 GPT-4o-mini로 분석"""
    text_preview = text[:100]

    try:
        api_config = get_api_config()
        model = api_config.get("openai", {}).get("model", "gpt-4o-mini")

        # 타이머는 생략하거나 PipelineLogger 특성에 맞게 사용 (여기선 try-except 내 단순 호출)
        response = openai_client.chat.completions.create(
            model=model,
            temperature=0.3,
            messages=[
                {
                    "role": "system",
                    "content": """광고/협찬/지원을 한 **정확한 주체들의 전체 이름**을 **리스트** 형식으로 답변하세요.
예시: ['하이트진로', '영양군청']
주체를 찾을 수 없으면 'None'을 출력합니다.""",
                },
                {"role": "user", "content": text_preview},
            ],
        )

        content = response.choices[0].message.content.strip()

        if not content or content.lower() == "none":
            return None

        try:
            parsed = json.loads(content)
        except json.JSONDecodeError:
            try:
                import ast
                parsed = ast.literal_eval(content)
            except Exception:
                parsed = [content]

        if isinstance(parsed, str):
            parsed = [parsed]
        elif not isinstance(parsed, list):
            parsed = [str(parsed)]

        parsed = [str(x).strip() for x in parsed if str(x).strip()]
        return parsed if parsed else None

    except Exception as e:
        logger.warning(f"광고 분석 실패: {e}")
        return None


def get_video_meta_batch(youtube, video_ids: List[str]) -> Dict[str, Dict]:
    """YouTube API 배치 요청 (최대 50개)"""
    results = {}
    try:
        response = youtube.videos().list(
            part="snippet,contentDetails,statistics",
            id=','.join(video_ids)
        ).execute()

        for item in response.get("items", []):
            vid = item["id"]
            snippet = item.get("snippet", {})
            content_details = item.get("contentDetails", {})
            statistics = item.get("statistics", {})

            duration_seconds = parse_duration(content_details.get("duration", "PT0S"))
            
            # 썸네일 처리
            thumbnails = snippet.get("thumbnails", {})
            # 최고 화질 선택
            thumb_url = (
                thumbnails.get("maxres", {}).get("url") or 
                thumbnails.get("standard", {}).get("url") or 
                thumbnails.get("high", {}).get("url") or 
                thumbnails.get("medium", {}).get("url") or 
                thumbnails.get("default", {}).get("url")
            )
            
            # 해시 계산 (비용이 높지만 감지에 필수)
            thumb_hash = get_image_hash(thumb_url) if thumb_url else None

            results[vid] = {
                "youtube_link": f"https://www.youtube.com/watch?v={vid}",
                "title": snippet.get("title"),
                "published_at": snippet.get("publishedAt"),
                "duration": duration_seconds,
                "is_shorts": duration_seconds <= 180,
                "description": snippet.get("description", "")[:500],
                "category": snippet.get("categoryId"),
                "tags": snippet.get("tags", []),
                "thumbnail_url": thumb_url,
                "thumbnail_hash": thumb_hash,
                "stats": {
                    "view_count": int(statistics.get("viewCount", 0)) if statistics.get("viewCount") else None,
                    "like_count": int(statistics.get("likeCount", 0)) if statistics.get("likeCount") else None,
                    "comment_count": int(statistics.get("commentCount", 0)) if statistics.get("commentCount") else None,
                },
            }
    except Exception as e:
        print(f"배치 API 오류: {e}")
    
    return results

def save_thumbnail_file(channel_data_path: Path, video_id: str, recollect_id: int, url: str):
    """버전 관리가 적용된 썸네일 이미지 파일 저장"""
    if not url: return
    
    thumb_dir = channel_data_path / "thumbnails"
    thumb_dir.mkdir(parents=True, exist_ok=True)
    
    try:
        resp = requests.get(url, timeout=10)
        if resp.status_code == 200:
            ext = url.split('.')[-1]
            if len(ext) > 4 or '?' in ext: ext = 'jpg' # 간단한 대체 처리
            
            # 파일 형식: {video_id}-{recollect_id}.{ext}
            filename = f"{video_id}-{recollect_id}.{ext}"
            filepath = thumb_dir / filename
            
            with open(filepath, "wb") as f:
                f.write(resp.content)
    except Exception:
        pass

def collect_channel_meta(
    channel_name: str,
    youtube,
    openai_client: Optional[OpenAI],
    logger: PipelineLogger,
) -> Dict[str, Any]:
    
    channel_path = Path(__file__).parent.parent / "data" / channel_name
    urls_path = channel_path / "urls.txt"
    deleted_path = channel_path / "deleted_urls.txt"

    if not urls_path.exists():
        logger.warning(f"  ❌ URL 파일 없음: {urls_path}")
        return {}

    # 1. 수집 대상 비디오 ID 로드
    video_ids = []
    with open(urls_path, "r", encoding="utf-8") as f:
        for line in f:
            url = line.strip()
            if url:
                vid = extract_video_id(url)
                if vid:
                    video_ids.append(vid)

    # 2. 삭제된 비디오 필터링 (명시적 체크)
    deleted_ids = set()
    if deleted_path.exists():
        with open(deleted_path, "r", encoding="utf-8") as f:
            for line in f:
                # Format: URL\tTIMESTAMP or just URL
                parts = line.strip().split('\t')
                if parts:
                    vid = extract_video_id(parts[0])
                    if vid:
                        deleted_ids.add(vid)
    
    # urls.txt에는 없지만 혹시 남아있을 수 있는 것들 필터링
    original_count = len(video_ids)
    video_ids = [vid for vid in video_ids if vid not in deleted_ids]
    if len(video_ids) < original_count:
        logger.warning(f"  ⚠️ 삭제된 영상 {original_count - len(video_ids)}개 필터링됨")

    logger.info(f"  🔍 수집 대상: {len(video_ids)}개")
    if not video_ids:
        return {"processed": 0}

    meta_dir = channel_path / "meta"
    meta_dir.mkdir(parents=True, exist_ok=True)

    success_count = 0
    
    # 배치 처리
    BATCH_SIZE = 50
    for i in range(0, len(video_ids), BATCH_SIZE):
        batch_ids = video_ids[i:i+BATCH_SIZE]
        logger.progress(i, len(video_ids), f"Batch {i//BATCH_SIZE + 1}")
        
        # 1. 배치의 현재 메타데이터 가져오기
        current_metas = get_video_meta_batch(youtube, batch_ids)
        
        for vid in batch_ids:
            if vid not in current_metas: continue
            
            current_meta = current_metas[vid]
            previous_meta = get_latest_meta(channel_path, vid)
            
            # 2. 변경 사항 감지 -> List[str] (viral 포함)
            recollect_vars = detect_changes(current_meta, previous_meta, channel_path, vid)
            is_changed = bool(recollect_vars)

            # [수정] 오늘 이미 수집되었는지 확인 (중복 수집 방지)
            already_collected_today = False
            if previous_meta and previous_meta.get("collected_at"):
                try:
                    last_collected_str = previous_meta.get("collected_at")
                    # 타임존 처리 (ISO 포맷)
                    last_dt = datetime.fromisoformat(last_collected_str.replace("Z", "+00:00")).astimezone(KST)
                    if last_dt.date() == datetime.now(KST).date():
                        already_collected_today = True
                except Exception:
                    pass
            
            # 3. 스케줄링 결정
            schedule_reason = None
            
            # 신규 영상은 무조건 수집 (previous_meta 없음)
            if not previous_meta:
                 recollect_vars = ["new_video"]
                 schedule_reason = "new_video"
            else:
                # 변경사항 없으면 스케줄 확인
                frequency = get_schedule_frequency(current_meta.get("published_at"))
                
                # Viral은 스케줄 무시하고 수집 (detect_changes에서 이미 추가됨)
                # [Removed] viral logic
                
                if frequency:
                    if check_schedule_condition(frequency, vid):
                        schedule_reason = frequency
                
                # [수정] frequency가 None인 경우(D+5 미만 등)는 정기 수집 스케줄 없음.
                # 단, is_changed(제목 변경 등)인 경우는 수집됨.

            is_scheduled = (schedule_reason is not None or "scheduled_weekly" in recollect_vars or "daily_collection" in recollect_vars)

            # 4. 최종 수집 여부 결정
            # 변경사항이 있거나(is_changed) OR 스케줄에 걸렸거나(is_scheduled)
            # 단, D+5 미만 신규 영상(schedule_reason is None and not is_changed)은 여기서 걸러질 수 있음.
            # 하지만 new_video는 is_changed에 포함되지 않으므로(recollect_vars=["new_video"]),
            # new_video인 경우 위에서 schedule_reason="new_video"로 처리됨.
            
            if not (is_changed or is_scheduled):
                # 수집 안 함. 하지만 썸네일 백필 체크
                prev_id = previous_meta.get("recollect_id", 0)
                if not check_thumbnail_exists(channel_path, vid, prev_id):
                    save_thumbnail_file(channel_path, vid, prev_id, current_meta.get("thumbnail_url"))
                continue

            # [수정] 변경사항 없이 스케줄링에 의한 수집인 경우, 하루 1회만 허용
            if not is_changed and is_scheduled and already_collected_today:
                logger.debug(f"  ⏭️ 오늘 이미 수집됨 (스킵): {vid}")
                continue

            # 5. 수집 확정 -> ID 계산
            prev_id = previous_meta.get("recollect_id", 0) if previous_meta else 0
            # previous_meta가 없으면(신규) 0, 있으면 +1
            new_id = prev_id + 1 if previous_meta else 0
            
            # schedule_reason이 있으면 recollect_vars에 추가 (daily_collection 제외)
            if schedule_reason and schedule_reason != "daily_collection":
                if schedule_reason not in recollect_vars:
                    recollect_vars.append(schedule_reason)

            # 6. 필요시 썸네일 저장
            if "new_video" in recollect_vars or "thumbnail_changed" in recollect_vars:
                save_thumbnail_file(channel_path, vid, new_id, current_meta.get("thumbnail_url"))

            # OpenAI 분석 (옵션)
            ad_keywords = ["협찬", "광고", "지원"]
            description = current_meta.get("description", "")
            is_ads = any(keyword in description for keyword in ad_keywords)
            
            what_ads = None
            if is_ads:
                # 이전 데이터 재사용 확인
                if previous_meta and previous_meta.get("ads_info", {}).get("what_ads"):
                    what_ads = previous_meta["ads_info"]["what_ads"]
                elif openai_client:
                    # 신규 분석
                    what_ads = analyze_ad_content(openai_client, description, logger)
            
            current_meta["ads_info"] = {"is_ads": is_ads, "what_ads": what_ads}

            # 7. 메타데이터 추가
            current_meta["recollect_id"] = new_id
            current_meta["recollect_vars"] = recollect_vars
            current_meta["collected_at"] = datetime.now(KST).isoformat()
            
            output_file = meta_dir / f"{vid}.jsonl"
            append_to_jsonl(str(output_file), current_meta)
            logger.info(f"  [Meta Updated] {vid} - {current_meta.get('title', 'No Title')[:30]}...")
            success_count += 1

    logger.progress_done()
    logger.info(f"완료: 업데이트 {success_count}개")
    return {"success": success_count}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--channel", "-c", type=str)
    parser.add_argument("--skip-ads", action="store_true", help="광고 분석 스킵")
    args = parser.parse_args()

    youtube_api_key = get_api_key("youtube")
    openai_api_key = get_api_key("openai")

    if not youtube_api_key:
        print("❌ YOUTUBE_API_KEY 누락됨")
        sys.exit(1)

    youtube = build("youtube", "v3", developerKey=youtube_api_key)
    
    openai_client = None
    if not args.skip_ads and openai_api_key:
        openai_client = OpenAI(api_key=openai_api_key)

    logger = PipelineLogger(phase="collect-meta", log_dir=LOG_DIR)
    logger.start_stage()

    try:
        if args.channel:
            collect_channel_meta(args.channel, youtube, openai_client, logger)
        else:
            for ch in get_all_channels():
                collect_channel_meta(ch, youtube, openai_client, logger)
    except Exception as e:
        logger.error(f"Error: {e}")
    finally:
        logger.end_stage()

if __name__ == "__main__":
    main()
