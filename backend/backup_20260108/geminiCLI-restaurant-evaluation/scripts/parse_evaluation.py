#!/usr/bin/env python3
"""
Gemini CLI 평가 결과 파서
- Gemini CLI의 평가 JSON 응답에서 5개 평가 항목 추출
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
        # JSON 블록 추출 시도
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


def validate_evaluation_data(data: Dict[str, Any]) -> bool:
    """
    평가 데이터 유효성 검증
    
    Args:
        data: 파싱된 JSON 데이터
        
    Returns:
        유효성 여부
    """
    required_fields = [
        'visit_authenticity',
        'rb_inference_score',
        'rb_grounding_TF',
        'review_faithfulness_score',
        'category_TF'
    ]
    
    for field in required_fields:
        if field not in data:
            print(f"❌ '{field}' 필드가 없습니다", file=sys.stderr)
            return False
    
    # visit_authenticity 구조 검증
    if 'values' not in data['visit_authenticity'] or 'missing' not in data['visit_authenticity']:
        print("❌ 'visit_authenticity' 구조 오류", file=sys.stderr)
        return False
    
    # 나머지 4개 항목은 배열이어야 함
    for field in required_fields[1:]:
        if not isinstance(data[field], list):
            print(f"❌ '{field}'가 배열이 아닙니다", file=sys.stderr)
            return False
    
    return True


def save_to_jsonl(
    youtube_link: str,
    evaluation_result: Dict[str, Any],
    output_path: Path
) -> None:
    """
    JSONL 형식으로 저장
    
    Args:
        youtube_link: YouTube 영상 URL
        evaluation_result: 평가 결과 (5개 항목)
        output_path: 출력 파일 경로
    """
    record = {
        'youtube_link': youtube_link,
        **evaluation_result  # 5개 평가 항목 펼치기
    }
    
    # 기존 파일에 append
    with open(output_path, 'a', encoding='utf-8') as f:
        f.write(json.dumps(record, ensure_ascii=False) + '\n')
    
    print(f"✅ 저장 완료: {youtube_link}")


def main():
    """메인 실행 함수"""
    if len(sys.argv) < 4:
        print("사용법: parse_evaluation.py <youtube_url> <gemini_response_file> <output_jsonl>", file=sys.stderr)
        sys.exit(1)
    
    youtube_url = sys.argv[1]
    response_file = Path(sys.argv[2])
    output_file = Path(sys.argv[3])
    
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
    if not validate_evaluation_data(data):
        sys.exit(1)
    
    # JSONL 저장
    try:
        save_to_jsonl(
            youtube_link=youtube_url,
            evaluation_result=data,
            output_path=output_file
        )
        print(f"✅ 완료: {youtube_url}")
    except Exception as e:
        print(f"❌ 저장 실패: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
