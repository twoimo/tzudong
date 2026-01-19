#!/usr/bin/env python3
"""
YouTube 메타데이터 & 썸네일 수집 스크립트 (recollect_id 기반)
- API로 메타데이터 및 썸네일 확인
- 썸네일 변경 감지 (MD5 해시)
- 변경 사유 리스트 관리 (recollect_vars)
- 주기적 수집 스케줄링 적용
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


def calculate_schedule_reason(published_at_str: str, last_collected_at_str: str) -> Optional[str]:
    """
    주기적 수집 스케줄링 로직
    - published_at 기준 경과 시간에 따라 주기 결정
    """
    if not published_at_str or not last_collected_at_str:
        return "new_video"

    now = datetime.now(KST)
    
    # ISO 포맷 파싱 (KST 호환)
    try:
        published_at = datetime.fromisoformat(published_at_str.replace('Z', '+00:00'))
        last_collected = datetime.fromisoformat(last_collected_at_str.replace('Z', '+00:00'))
    except ValueError:
        return None

    days_since_published = (now - published_at).days
    days_since_collected = (now - last_collected).days
    
    months_since_published = days_since_published / 30.0

    # 1. 5일 미만: 매일 (혹은 수집 즉시) -> 여기서는 변경 감지 로직에 맡김 (기본 스킵, 변경시만)
    if days_since_published < 5:
        return None # 스케줄링에 의한 강제 수집 없음

    # 2. 6개월 이상: 스킵
    if months_since_published >= 6:
        return None

    # 3. 3~6개월: 1달마다
    if months_since_published >= 3 and days_since_collected >= 30:
        return "scheduled_monthly"

    # 4. 1~3개월: 2주마다
    if months_since_published >= 1 and days_since_collected >= 14:
        return "scheduled_biweekly"

    # 5. 14일 ~ 1개월: 매주
    if days_since_published >= 14 and days_since_collected >= 7:
        return "scheduled_weekly"

    # 6. 5일 ~ 14일: 3일마다 (신규 로직)
    if days_since_published >= 5 and days_since_collected >= 3:
        return "scheduled_3days"

    return None


def detect_changes(current: Dict, previous: Dict) -> List[str]:
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
    
    # 4. 스케줄 확인
    schedule_reason = calculate_schedule_reason(
        current.get("published_at"), 
        previous.get("collected_at")
    )
    if schedule_reason:
        changes.append(schedule_reason)

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
        print(f"Batch API Error: {e}")
    
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
    
    channel_data_path = get_channel_data_path(channel_name)
    logger.info(f"채널 처리: {channel_name}")

    video_ids = []
    urls_file = channel_data_path / "urls.txt"
    if urls_file.exists():
        with open(urls_file, "r", encoding="utf-8") as f:
            for line in f:
                vid = extract_video_id(line.strip())
                if vid: video_ids.append(vid)

    logger.info(f"전체 URL: {len(video_ids)}개")
    if not video_ids:
        return {"processed": 0}

    meta_dir = channel_data_path / "meta"
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
            previous_meta = get_latest_meta(channel_data_path, vid)
            
            # 2. 변경 사항 감지 -> List[str]
            recollect_vars = detect_changes(current_meta, previous_meta)
            
            # 3. 신규 영상 처리 (항상 수집)
            if not previous_meta:
                recollect_vars = ["new_video"]
            elif not recollect_vars:
                # 변경 사항 없음. 하지만 썸네일 파일이 없는지 확인 (백필)
                prev_id = previous_meta.get("recollect_id", 0)
                if not check_thumbnail_exists(channel_data_path, vid, prev_id):
                    # 썸네일이 없으면 현재(이전 버전) ID로 저장
                    save_thumbnail_file(channel_data_path, vid, prev_id, current_meta.get("thumbnail_url"))
                
                # 메타데이터 업데이트 불필요 -> 건너뛰기
                continue

            # 4. 수집 ID 결정
            prev_id = previous_meta.get("recollect_id", 0) if previous_meta else 0
            new_id = prev_id + 1 if previous_meta else 0
            
            # 5. 필요시 썸네일 저장
            # 신규 영상이거나, 썸네일이 변경되었으면 저장
            if "new_video" in recollect_vars or "thumbnail_changed" in recollect_vars:
                save_thumbnail_file(channel_data_path, vid, new_id, current_meta.get("thumbnail_url"))

            # 6. 메타데이터 추가
            current_meta["recollect_id"] = new_id
            current_meta["recollect_vars"] = recollect_vars # 리스트
            current_meta["collected_at"] = datetime.now(KST).isoformat()
            
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
            
            output_file = meta_dir / f"{vid}.jsonl"
            append_to_jsonl(str(output_file), current_meta)
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
