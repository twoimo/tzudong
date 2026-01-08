"""
trace_id 생성 유틸리티

video_id + name + address를 조합하여 SHA-256 해시 기반의 trace_id를 생성합니다.
기존 unique_id를 대체합니다.
"""

import hashlib
from typing import Optional


def generate_trace_id(
    video_id: str,
    name: str,
    address: Optional[str] = None
) -> str:
    """
    trace_id 생성
    
    Args:
        video_id: YouTube 영상 ID
        name: 음식점 이름
        address: 주소 (선택)
    
    Returns:
        SHA-256 해시 기반 trace_id
    """
    # 정규화
    normalized_name = normalize_string(name)
    normalized_address = normalize_string(address) if address else ""
    
    # 조합
    combined = f"{video_id}|{normalized_name}|{normalized_address}"
    
    # SHA-256 해시 생성
    return hashlib.sha256(combined.encode("utf-8")).hexdigest()


def normalize_string(s: str) -> str:
    """
    문자열 정규화 (공백 제거, 소문자 변환)
    """
    if not s:
        return ""
    
    # 공백 정규화
    normalized = " ".join(s.split())
    
    # 소문자 변환 (영문)
    normalized = normalized.lower()
    
    return normalized


def migrate_unique_id_to_trace_id(data: dict) -> dict:
    """
    기존 unique_id를 trace_id로 마이그레이션
    
    Args:
        data: 기존 데이터 (unique_id 포함)
    
    Returns:
        trace_id로 변환된 데이터
    """
    if "unique_id" in data:
        data["trace_id"] = data.pop("unique_id")
    
    # 전화번호 필드 삭제 (개인정보 보호)
    data.pop("phone", None)
    
    return data


if __name__ == "__main__":
    # 테스트
    trace_id = generate_trace_id(
        video_id="abc123",
        name="산북동달구지",
        address="전라북도 군산시 산북동 123-45"
    )
    print(f"Generated trace_id: {trace_id}")
