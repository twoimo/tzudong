"""
중복 검사 유틸리티

전체 파이프라인에서 중복 데이터를 감지하고 필터링합니다.
trace_id 기반의 통합 중복 처리 시스템입니다.
"""

import json
import os
from pathlib import Path
from typing import Set, Optional, Any


def load_processed_trace_ids(file_path: str) -> Set[str]:
    """
    처리된 trace_id 목록 로드
    
    Args:
        file_path: JSONL 파일 경로
    
    Returns:
        trace_id Set
    """
    trace_ids: Set[str] = set()
    
    if not os.path.exists(file_path):
        return trace_ids
    
    with open(file_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
                if "trace_id" in data:
                    trace_ids.add(data["trace_id"])
                # 하위 호환성: unique_id도 지원
                elif "unique_id" in data:
                    trace_ids.add(data["unique_id"])
            except json.JSONDecodeError:
                continue
    
    return trace_ids


def load_processed_video_ids(file_path: str) -> Set[str]:
    """
    처리된 video_id 목록 로드
    
    Args:
        file_path: JSONL 파일 경로
    
    Returns:
        video_id Set
    """
    video_ids: Set[str] = set()
    
    if not os.path.exists(file_path):
        return video_ids
    
    with open(file_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
                if "video_id" in data:
                    video_ids.add(data["video_id"])
                elif "youtube_link" in data:
                    # youtube_link에서 video_id 추출
                    video_id = extract_video_id(data["youtube_link"])
                    if video_id:
                        video_ids.add(video_id)
            except json.JSONDecodeError:
                continue
    
    return video_ids


def load_processed_youtube_links(file_path: str) -> Set[str]:
    """
    처리된 YouTube 링크 목록 로드
    
    Args:
        file_path: JSONL 파일 경로
    
    Returns:
        youtube_link Set
    """
    links: Set[str] = set()
    
    if not os.path.exists(file_path):
        return links
    
    with open(file_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
                if "youtube_link" in data:
                    links.add(data["youtube_link"])
            except json.JSONDecodeError:
                continue
    
    return links


def load_multiple_processed_ids(
    *file_paths: str,
    key: str = "trace_id"
) -> Set[str]:
    """
    여러 파일에서 처리된 ID 통합 로드
    
    Args:
        *file_paths: 파일 경로들
        key: 추출할 키 (trace_id, video_id, youtube_link)
    
    Returns:
        통합 ID Set
    """
    all_ids: Set[str] = set()
    
    for path in file_paths:
        if key == "trace_id":
            all_ids.update(load_processed_trace_ids(path))
        elif key == "video_id":
            all_ids.update(load_processed_video_ids(path))
        elif key == "youtube_link":
            all_ids.update(load_processed_youtube_links(path))
    
    return all_ids


def append_to_jsonl(file_path: str, data: Any) -> None:
    """
    JSONL 파일에 안전하게 추가
    
    Args:
        file_path: 파일 경로
        data: 저장할 데이터
    """
    # 디렉토리 생성
    os.makedirs(os.path.dirname(file_path) or ".", exist_ok=True)
    
    with open(file_path, "a", encoding="utf-8") as f:
        f.write(json.dumps(data, ensure_ascii=False) + "\n")


def extract_video_id(youtube_link: str) -> Optional[str]:
    """
    YouTube 링크에서 video_id 추출
    
    Args:
        youtube_link: YouTube URL
    
    Returns:
        video_id 또는 None
    """
    if not youtube_link:
        return None
    
    # youtube.com/watch?v=VIDEO_ID
    if "watch?v=" in youtube_link:
        start = youtube_link.find("watch?v=") + 8
        end = youtube_link.find("&", start)
        if end == -1:
            return youtube_link[start:]
        return youtube_link[start:end]
    
    # youtu.be/VIDEO_ID
    if "youtu.be/" in youtube_link:
        start = youtube_link.find("youtu.be/") + 9
        end = youtube_link.find("?", start)
        if end == -1:
            return youtube_link[start:]
        return youtube_link[start:end]
    
    # youtube.com/shorts/VIDEO_ID
    if "/shorts/" in youtube_link:
        start = youtube_link.find("/shorts/") + 8
        end = youtube_link.find("?", start)
        if end == -1:
            return youtube_link[start:]
        return youtube_link[start:end]
    
    return None


def filter_duplicates(
    items: list,
    processed_ids: Set[str],
    id_key: str = "trace_id"
) -> list:
    """
    중복 항목 필터링
    
    Args:
        items: 필터링할 항목 리스트
        processed_ids: 이미 처리된 ID Set
        id_key: ID 키 (trace_id, video_id, youtube_link)
    
    Returns:
        중복 제거된 항목 리스트
    """
    filtered = []
    
    for item in items:
        item_id = item.get(id_key)
        if item_id and item_id not in processed_ids:
            filtered.append(item)
            processed_ids.add(item_id)  # 현재 배치 내 중복도 방지
    
    return filtered


if __name__ == "__main__":
    # 테스트
    video_id = extract_video_id("https://www.youtube.com/watch?v=abc123")
    print(f"Extracted video_id: {video_id}")
    
    video_id = extract_video_id("https://youtu.be/def456")
    print(f"Extracted video_id: {video_id}")
