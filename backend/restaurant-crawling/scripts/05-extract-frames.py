#!/usr/bin/env python3
"""
YouTube 히트맵 기반 프레임 추출 스크립트 (05-extract-frames.py)

기능:
1. YouTube 영상의 히트맵(가장 많이 다시 본 장면) 데이터를 수집 및 저장 (04-collect-heatmap.js 기능 통합)
2. 저장된 데이터를 기반으로 피크 구간 식별
3. `yt-dlp`를 사용하여 해당 영상 다운로드 (화질 설정 가능)
4. OpenCV를 사용하여 피크 구간 전후의 프레임을 정해진 FPS로 추출
5. VLM(Vision-Language Model) 분석을 위한 최적화된 WebP 포맷으로 저장

사용법:
    # 1. 단일 URL 처리 (테스트용)
    python 05-extract-frames.py --url https://www.youtube.com/watch?v=VIDEO_ID --fps 4 --buffer 5 --quality 1080p

    # 2. 채널 전체 처리 (urls.txt 기반)
    python 05-extract-frames.py --channel tzuyang --fps 4

선행 조건:
    pip install opencv-python yt-dlp requests numpy
    ffmpeg 설치 필요
"""

import os
import sys
import json
import re
import argparse
import time
import shutil
import logging
from pathlib import Path
from typing import List, Dict, Optional, Tuple, Any
from datetime import datetime

import cv2
import requests
import yt_dlp

# 로깅 설정
logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

# 경로 설정
SCRIPT_DIR = Path(__file__).resolve().parent
BASE_DATA_DIR = SCRIPT_DIR.parent / "data"

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9,ko;q=0.8',
}

def extract_video_id(url: str) -> Optional[str]:
    """YouTube URL에서 Video ID 추출"""
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

def get_channel_dir(channel_name: str) -> Path:
    """채널 데이터 디렉토리 반환"""
    return BASE_DATA_DIR / channel_name

def get_frames_output_dir(channel_name: str, video_id: str, recollect_id: int, quality: str, fps: float) -> Path:
    """프레임 저장 경로 반환 (output > video_id > recollect_id > quality_fps)"""
    return get_channel_dir(channel_name) / "high_res_frames" / video_id / str(recollect_id) / f"{quality}_{fps}fps"

def get_heatmap_output_path(channel_name: str, video_id: str) -> Path:
    """히트맵 데이터 저장 경로 반환"""
    heatmap_dir = get_channel_dir(channel_name) / "heatmap"
    heatmap_dir.mkdir(parents=True, exist_ok=True)
    return heatmap_dir / f"{video_id}.jsonl"

def parse_heatmap_from_html(html: str) -> Dict[str, Any]:
    """HTML에서 히트맵 데이터 전체 파싱 (Markers + Most Replayed)"""
    
    # ytInitialData 추출
    match = re.search(r'var\s+ytInitialData\s*=\s*({.*?});', html, re.DOTALL)
    if not match:
        return {}

    try:
        data = json.loads(match.group(1))
    except json.JSONDecodeError:
        return {}

    # 재귀적으로 키 찾기 함수
    def find_key(obj, key):
        if key in obj: return obj[key]
        if isinstance(obj, dict):
            for k, v in obj.items():
                if isinstance(v, (dict, list)):
                    found = find_key(v, key)
                    if found: return found
        elif isinstance(obj, list):
            for item in obj:
                if isinstance(item, (dict, list)):
                    found = find_key(item, key)
                    if found: return found
        return None

    # 1. "가장 많이 다시 본 장면" 마커 추출
    markers_decoration = find_key(data, 'timedMarkerDecorations')
    most_replayed = []
    
    if markers_decoration:
        for marker in markers_decoration:
            label = ""
            try:
                label = marker.get('label', {}).get('runs', [{}])[0].get('text', '')
            except:
                pass
            
            # "가장 많이 다시 본 장면" 또는 "Most replayed" 확인
            if '가장 많이 다시 본 장면' in label or 'Most replayed' in label.lower():
                most_replayed.append({
                    'startMillis': marker['visibleTimeRangeStartMillis'],
                    'endMillis': marker['visibleTimeRangeEndMillis'],
                    'peakMillis': marker['decorationTimeMillis'],
                    'label': label
                })

    # 2. 일반 히트맵 데이터 추출 (markers)
    markers = find_key(data, 'markers')
    raw_markers = []
    
    if markers and isinstance(markers, list) and len(markers) > 0:
        raw_markers = markers
    else:
        marker_graph = find_key(data, 'markerGraph')
        if marker_graph and 'markers' in marker_graph and isinstance(marker_graph['markers'], list):
            raw_markers = marker_graph['markers']

    return {
        'most_replayed_markers': most_replayed,
        'interaction_data': raw_markers
    }

def fetch_and_save_heatmap(channel_name: str, video_id: str, youtube_link: str, recollect_id: int) -> Optional[List[Dict]]:
    """YouTube 페이지에서 히트맵 데이터 수집 및 저장"""
    url = youtube_link
    try:
        response = requests.get(url, headers=HEADERS, timeout=10)
        if response.status_code != 200:
            logger.warning(f"페이지 로드 실패: {response.status_code}")
            return None
        
        parsed_data = parse_heatmap_from_html(response.text)
        
        if not parsed_data.get('most_replayed_markers') and not parsed_data.get('interaction_data'):
            logger.warning(f"⚠️ {video_id}: 히트맵 데이터 없음")
            # 데이터 없어도 빈 상태로라도 저장할 수 있으나, 여기서는 None 리턴
            return None

        # 데이터 포맷팅 (04-collect-heatmap.js 스타일)
        formatted_interaction = []
        if parsed_data.get('interaction_data'):
            for item in parsed_data['interaction_data']:
                try:
                    seconds = int(item.get('startMillis', 0) / 1000)
                    mm = str(seconds // 60).zfill(2)
                    ss = str(seconds % 60).zfill(2)
                    formatted_interaction.append({
                        **item,
                        'formatted_time': f"{mm}:{ss}"
                    })
                except:
                    continue

        save_data = {
            'youtube_link': youtube_link,
            'video_id': video_id,
            'interaction_data': formatted_interaction,
            'most_replayed_markers': parsed_data.get('most_replayed_markers', []),
            'status': 'success',
            'collected_at': datetime.now().isoformat(),
            'recollect_id': recollect_id # recollect_id 추가
        }

        # 파일 저장
        output_path = get_heatmap_output_path(channel_name, video_id)
        with open(output_path, 'a', encoding='utf-8') as f: # jsonl이므로 append
            f.write(json.dumps(save_data, ensure_ascii=False) + '\n')
            
        logger.info(f"💾 히트맵 저장 완료: {output_path}")
        
        # 피크 구간 정보 가공해서 반환
        return [
            {
                'start_sec': m['startMillis'] / 1000.0,
                'end_sec': m['endMillis'] / 1000.0,
                'peak_sec': m['peakMillis'] / 1000.0
            }
            for m in parsed_data.get('most_replayed_markers', [])
        ]

    except Exception as e:
        logger.error(f"히트맵 수집/저장 오류: {e}")
        return None

def download_video(video_id: str, output_path: Path, quality: str = "1080p"):
    """yt-dlp를 사용하여 비디오 다운로드"""
    
    # 화질 선택 로직
    res_match = re.search(r'\d+', quality)
    target_height = int(res_match.group(0)) if res_match else 1080
    
    # format string: mp4 중 target_height 이하 최고 화질 + 오디오
    format_str = f"bestvideo[height<={target_height}][ext=mp4]+bestaudio[ext=m4a]/best[height<={target_height}][ext=mp4]/best[ext=mp4]"

    ydl_opts = {
        'format': format_str,
        'outtmpl': str(output_path),
        'quiet': True,
        'no_warnings': True,
    }

    logger.info(f"📥 다운로드 시작: {video_id} (목표화질: {target_height}p)")
    
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([f"https://www.youtube.com/watch?v={video_id}"])
        return True
    except Exception as e:
        logger.error(f"❌ 다운로드 실패: {e}")
        return False

def extract_frames(
    video_path: Path, 
    segments: List[Dict], 
    output_base_dir: Path, 
    fps: float = 4.0, 
    buffer_sec: float = 5.0
):
    """지정된 구간의 프레임 추출"""
    
    if not video_path.exists():
        logger.error("비디오 파일이 없습니다.")
        return

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        logger.error("비디오를 열 수 없습니다.")
        return

    video_fps = cap.get(cv2.CAP_PROP_FPS)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = total_frames / video_fps
    
    logger.info(f"🎞️ 비디오 정보: {duration:.1f}초, {video_fps} FPS")

    frame_step = int(video_fps / fps)
    if frame_step < 1: frame_step = 1

    for idx, seg in enumerate(segments):
        start_time = max(0, seg['peak_sec'] - buffer_sec)
        end_time = min(duration, seg['peak_sec'] + buffer_sec)
        
        seg_dir_name = f"{idx+1}_{int(start_time)}_{int(end_time)}"
        seg_dir = output_base_dir / seg_dir_name
        seg_dir.mkdir(parents=True, exist_ok=True)
        
        logger.info(f"   ✂️ 추출 중: 구간 {idx+1} ({start_time:.1f}s ~ {end_time:.1f}s) -> {seg_dir_name}")

        start_frame = int(start_time * video_fps)
        end_frame = int(end_time * video_fps)
        
        cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
        
        current_frame = start_frame
        saved_count = 0
        
        while current_frame <= end_frame:
            ret, frame = cap.read()
            if not ret:
                break
                
            if (current_frame - start_frame) % frame_step == 0:
                timestamp = current_frame / video_fps
                out_name = f"{timestamp:.2f}.webp"
                out_path = seg_dir / out_name
                
                # WebP Quality 80
                cv2.imwrite(str(out_path), frame, [cv2.IMWRITE_WEBP_QUALITY, 80])
                saved_count += 1
            
            current_frame += 1
            
        logger.info(f"      ✅저장 완료: {saved_count}장")

    cap.release()

def process_single_video(
    video_id: str, 
    channel_name: str, 
    fps: float, 
    buffer_sec: float, 
    quality: str,
    recollect_id: int = 0
):
    """비디오 1개에 대한 전체 파이프라인 실행"""
    youtube_link = f"https://www.youtube.com/watch?v={video_id}"
    
    # 1. 히트맵 데이터 수집 및 저장
    segments = fetch_and_save_heatmap(channel_name, video_id, youtube_link, recollect_id)
    
    if not segments:
        logger.info(f"ℹ️ {video_id}: 처리할 중요 구간 없음 (영상 다운로드 스킵)")
        return

    logger.info(f"🔎 {video_id}: {len(segments)}개의 피크 구간 발견")

    # 2. 임시 비디오 다운로드
    temp_dir = get_channel_dir(channel_name) / "temp_video"
    temp_dir.mkdir(parents=True, exist_ok=True)
    video_path = temp_dir / f"{video_id}.mp4"
    
    if not video_path.exists():
        success = download_video(video_id, video_path, quality)
        if not success:
            return
    else:
        logger.info("♻️ 기존 다운로드된 비디오 사용")

    # 3. 프레임 추출
    output_dir = get_frames_output_dir(channel_name, video_id, recollect_id, quality, fps)
    extract_frames(video_path, segments, output_dir, fps, buffer_sec)

    # 4. 정리 (임시 비디오 삭제)
    if video_path.exists():
        try:
            os.remove(video_path)
            if not os.listdir(temp_dir):
                os.rmdir(temp_dir)
        except Exception as e:
            logger.warning(f"파일 삭제 실패: {e}")

def main():
    parser = argparse.ArgumentParser(description="YouTube 히트맵 수집 및 고화질 프레임 추출기")
    
    parser.add_argument("--url", type=str, help="단일 YouTube 영상 URL")
    parser.add_argument("--channel", type=str, default="manual", help="채널명 (데이터 저장 경로용)")
    
    parser.add_argument("--fps", type=float, default=4.0, help="추출 FPS (기본: 4.0)")
    parser.add_argument("--buffer", type=float, default=5.0, help="피크 전후 추출 시간(초) (기본: 5.0)")
    parser.add_argument("--quality", type=str, default="1080p", help="비디오 다운로드 화질 (예: 720p, 1080p, 4k)")
    parser.add_argument("--recollect-id", type=int, default=0, help="재수집 ID (기본: 0)")
    
    args = parser.parse_args()

    if args.url:
        video_id = extract_video_id(args.url)
        if not video_id:
            logger.error("올바르지 않은 상세 URL입니다.")
            return
            
        logger.info(f"=== 단일 비디오 처리 모드: {video_id} (Recollect ID: {args.recollect_id}) ===")
        # 절대경로 확인 후 생성
        if args.channel == "manual":
             (BASE_DATA_DIR / "manual").mkdir(exist_ok=True)

        process_single_video(video_id, args.channel, args.fps, args.buffer, args.quality, args.recollect_id)
        
    elif args.channel != "manual":
        urls_file = get_channel_dir(args.channel) / "urls.txt"
        if not urls_file.exists():
            logger.error(f"채널 URL 파일이 없습니다: {urls_file}")
            return
            
        logger.info(f"=== 채널 배치 처리 모드: {args.channel} (Recollect ID: {args.recollect_id}) ===")
        
        with open(urls_file, 'r', encoding='utf-8') as f:
            urls = [line.strip() for line in f if line.strip()]
            
        for i, url in enumerate(urls):
            video_id = extract_video_id(url)
            if not video_id: continue
            
            logger.info(f"▶️ [{i+1}/{len(urls)}] 진행 중: {video_id}")
            process_single_video(video_id, args.channel, args.fps, args.buffer, args.quality, args.recollect_id)
            
            time.sleep(2)
            
    else:
        parser.print_help()

if __name__ == "__main__":
    main()
