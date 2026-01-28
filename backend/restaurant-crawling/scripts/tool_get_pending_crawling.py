#!/usr/bin/env python3
import os
import sys
import json
import argparse
from pathlib import Path

# ================================
# 설정 (HARDCODED for consistency)
# ================================
SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent.parent # tzudong
DATA_ROOT = PROJECT_ROOT / "backend" / "restaurant-crawling" / "data"

def get_channel_config(config_path, channel_name):
    # 간단한 YAML 파싱 (PyYAML 의존성 제거를 위해 직접 파싱하지 않고 구조만 가정)
    # 하지만 여기서는 경로 규칙이 이미 정해져 있으므로 하드코딩된 규칙 사용
    # 실제로는 channel_name이 곧 폴더명인 경우가 많음 (tzuyang, manual 등)
    # 예외: meatcreator -> meatcreator (설정 파일에 따르지만 여기선 폴더명으로 가정)
    return DATA_ROOT / channel_name

def load_jsonl(path):
    data = []
    if not path.exists():
        return data
    try:
        with open(path, 'r', encoding='utf-8') as f:
            for line in f:
                if line.strip():
                    try:
                        data.append(json.loads(line))
                    except:
                        pass
    except:
        pass
    return data

def get_latest_recollect_id(path):
    if not path.exists():
        return 0
    try:
        with open(path, 'r', encoding='utf-8') as f:
            lines = f.readlines()
            if lines:
                last_line = lines[-1].strip()
                if last_line:
                    data = json.loads(last_line)
                    return data.get('recollect_id', 0)
    except:
        pass
    return 0

def extract_video_id(url):
    if "v=" in url:
        return url.split("v=")[1].split("&")[0]
    elif "youtu.be/" in url:
        return url.split("youtu.be/")[1].split("?")[0]
    return None

def main():
    parser = argparse.ArgumentParser(description="Get pending URLs for Gemini crawling")
    parser.add_argument("--channel", required=True, help="Channel name (folder name)")
    args = parser.parse_args()

    channel_dir = DATA_ROOT / args.channel
    urls_file = channel_dir / "urls.txt"
    
    if not urls_file.exists():
        return

    # 1. URLs 로드
    with open(urls_file, 'r', encoding='utf-8') as f:
        urls = [line.strip() for line in f if line.strip()]

    # 2. 제외 필터 로드
    deleted_ids = set()
    deleted_file = channel_dir / "deleted_urls.txt"
    if deleted_file.exists():
        with open(deleted_file, 'r', encoding='utf-8') as f:
            for line in f:
                vid = extract_video_id(line)
                if vid: deleted_ids.add(vid)

    # 3. 상태 확인
    pending_urls = []
    
    print(f"Scanning {len(urls)} videos for channel '{args.channel}'...", file=sys.stderr)
    
    for url in urls:
        vid = extract_video_id(url)
        if not vid: continue
        
        if vid in deleted_ids:
            continue

        crawling_file = channel_dir / "crawling" / f"{vid}.jsonl"
        map_crawling_file = channel_dir / "map_url_crawling" / f"{vid}.jsonl"
        error_file = channel_dir / "crawling_errors" / f"{vid}.jsonl"
        meta_file = channel_dir / "meta" / f"{vid}.jsonl"
        transcript_file = channel_dir / "transcript" / f"{vid}.jsonl"

        # (1) 이미 처리됨 (crawling 완료)
        if crawling_file.exists():
            continue
        
        # (2) 이미 처리됨 (map_url_crawling 완료)
        if map_crawling_file.exists():
            continue
            
        # (3) 에러 파일 있음 -> 재시도 대상이므로 pending에 포함 (단, 외부 스크립트에서 삭제 후 처리)
        # 하지만 쉘 스크립트 로직상 에러파일이 있으면 '재시도' 함. 
        # 따라서 여기서는 pending에 포함시켜야 함.
        if error_file.exists():
            pending_urls.append(url)
            continue
            
        # (4) 메타 또는 자막 없음 -> 처리 불가하므로 스킵... 이 아니라,
        # 쉘 스크립트에서 "메타 없음" 경고를 띄우고 스킵함.
        # 여기서 아예 제외해버리면 "왜 안 돌지?" 하고 모를 수 있음.
        # 하지만 Smart Filter의 목적은 "할 수 있는 것만 하기" 임.
        # 메타/자막이 없으면 어차피 못하므로 제외하는 게 맞음.
        if not meta_file.exists() or not transcript_file.exists():
            continue

        # 여기까지 오면 pending
        pending_urls.append(url)

    print(f"Found {len(pending_urls)} pending videos.", file=sys.stderr)
    
    for url in pending_urls:
        print(url)

if __name__ == "__main__":
    main()
