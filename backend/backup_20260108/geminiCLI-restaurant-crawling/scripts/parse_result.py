#!/usr/bin/env python3
"""
Gemini CLI 크롤링 결과 파서
- Gemini CLI의 JSON 응답에서 음식점 정보 추출
- JSONL 형식으로 저장
- GitHub Actions 환경에서 실행 가능하도록 설계
"""

import json
import sys
from pathlib import Path
from typing import Dict, List, Any, Optional


def parse_gemini_response(response_text: str) -> Optional[Dict[str, Any]]:
    """
    Gemini CLI 응답에서 JSON 추출
    
    Args:
        response_text: Gemini CLI 원본 응답
        
    Returns:
        파싱된 JSON 객체 또는 None
    """
    try:
        # Gemini CLI --output-format json 응답 처리
        # 응답 형태: {"response": "```json\n{...}\n```", "stats": {...}}
        
        # 우선 전체가 JSON인지 확인
        try:
            wrapper = json.loads(response_text)
            if isinstance(wrapper, dict) and 'response' in wrapper:
                # response 필드에서 실제 내용 추출
                response_text = wrapper['response']
        except json.JSONDecodeError:
            pass
        
        # JSON 블록 추출 시도
        # Gemini CLI는 ```json ... ``` 형태로 감싸서 반환할 수 있음
        if '```json' in response_text:
            start = response_text.find('```json') + 7
            end = response_text.rfind('```')
            json_text = response_text[start:end].strip()
        elif '```' in response_text:
            start = response_text.find('```') + 3
            end = response_text.rfind('```')
            json_text = response_text[start:end].strip()
        else:
            json_text = response_text.strip()
        
        # JSON 파싱
        data = json.loads(json_text)
        return data
    except json.JSONDecodeError as e:
        print(f"❌ JSON 파싱 실패: {e}", file=sys.stderr)
        print(f"원본 응답:\n{response_text[:500]}...", file=sys.stderr)
        return None
    except Exception as e:
        print(f"❌ 예상치 못한 오류: {e}", file=sys.stderr)
        return None


def validate_restaurant_data(data: Dict[str, Any]) -> bool:
    """
    음식점 데이터 유효성 검증
    
    Args:
        data: 파싱된 JSON 데이터
        
    Returns:
        유효성 여부
    """
    if not isinstance(data, dict):
        print("❌ 최상위 객체가 dict가 아닙니다", file=sys.stderr)
        return False
    
    if 'restaurants' not in data:
        print("❌ 'restaurants' 필드가 없습니다", file=sys.stderr)
        return False
    
    if not isinstance(data['restaurants'], list):
        print("❌ 'restaurants'가 배열이 아닙니다", file=sys.stderr)
        return False
    
    # 필수 필드 검증
    required_fields = ['name', 'address', 'category']
    for idx, restaurant in enumerate(data['restaurants']):
        for field in required_fields:
            if field not in restaurant:
                print(f"❌ restaurants[{idx}]에 '{field}' 필드가 없습니다", file=sys.stderr)
                return False
    
    return True


def save_to_jsonl(
    youtube_link: str,
    restaurants: List[Dict[str, Any]],
    output_path: Path,
    youtube_meta: Optional[Dict[str, Any]] = None
) -> None:
    """
    JSONL 형식으로 저장
    
    Args:
        youtube_link: YouTube 영상 URL
        restaurants: 음식점 정보 배열
        output_path: 출력 파일 경로
        youtube_meta: YouTube 메타 정보 (선택)
    """
    record = {
        'youtube_link': youtube_link,
        'restaurants': restaurants
    }
    
    if youtube_meta:
        record['youtube_meta'] = youtube_meta
    
    # 기존 파일에 append
    with open(output_path, 'a', encoding='utf-8') as f:
        f.write(json.dumps(record, ensure_ascii=False) + '\n')
    
    print(f"✅ 저장 완료: {len(restaurants)}개 음식점")


def main():
    """메인 실행 함수"""
    if len(sys.argv) < 4:
        print("사용법: parse_result.py <youtube_url> <gemini_response_file> <output_jsonl>", file=sys.stderr)
        sys.exit(1)
    
    youtube_url = sys.argv[1]
    response_file = Path(sys.argv[2])
    output_file = Path(sys.argv[3])
    
    # 선택적 인자: youtube_meta JSON 파일
    youtube_meta = None
    if len(sys.argv) >= 5:
        meta_file = Path(sys.argv[4])
        if meta_file.exists():
            try:
                with open(meta_file, 'r', encoding='utf-8') as f:
                    youtube_meta = json.load(f)
            except Exception as e:
                print(f"⚠️  메타 정보 로드 실패: {e}", file=sys.stderr)
    
    # Gemini CLI 응답 읽기
    if not response_file.exists():
        print(f"❌ 응답 파일 없음: {response_file}", file=sys.stderr)
        sys.exit(1)
    
    with open(response_file, 'r', encoding='utf-8') as f:
        response_text = f.read()
    
    # JSON 파싱
    data = parse_gemini_response(response_text)
    if not data:
        sys.exit(1)
    
    # 유효성 검증
    if not validate_restaurant_data(data):
        sys.exit(1)
    
    # JSONL 저장
    try:
        save_to_jsonl(
            youtube_link=youtube_url,
            restaurants=data['restaurants'],
            output_path=output_file,
            youtube_meta=youtube_meta
        )
        print(f"✅ 완료: {youtube_url}")
    except Exception as e:
        print(f"❌ 저장 실패: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
