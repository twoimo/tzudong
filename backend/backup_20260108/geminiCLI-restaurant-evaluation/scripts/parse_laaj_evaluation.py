#!/usr/bin/env python3
"""
Gemini CLI LAAJ 평가 결과 파서
- Gemini CLI의 평가 JSON 응답에서 5개 평가 항목 추출
- RULE 평가 결과와 병합하여 JSONL 형식으로 저장
- GitHub Actions 환경에서 실행 가능하도록 설계

GeminiCLI 버전
"""

import json
import sys
import argparse
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
        # Gemini CLI JSON wrapper 처리 ({"response": "...", "stats": {...}})
        try:
            wrapper = json.loads(response_text)
            if isinstance(wrapper, dict) and 'response' in wrapper:
                response_text = wrapper['response']
        except json.JSONDecodeError:
            pass  # wrapper가 아니면 그냥 진행
        
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
    평가 데이터 유효성 검증 (5개 LAAJ 평가 항목)
    
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


def merge_with_rule_results(
    youtube_link: str,
    laaj_results: Dict[str, Any],
    evaluation_target: Dict[str, bool],
    restaurants: List[Dict[str, Any]],
    youtube_meta: Dict[str, Any],
    rule_results_file: Path
) -> Dict[str, Any]:
    """
    LAAJ 평가 결과와 RULE 평가 결과를 병합
    
    Args:
        youtube_link: YouTube 영상 URL
        laaj_results: LAAJ 평가 결과 (5개 항목)
        evaluation_target: 평가 대상 정보
        restaurants: 음식점 목록
        youtube_meta: YouTube 메타 정보
        rule_results_file: RULE 평가 결과 파일 경로
        
    Returns:
        병합된 결과
    """
    # RULE 평가 결과에서 해당 youtube_link의 결과 찾기
    rule_eval_results = {}
    
    if rule_results_file.exists():
        with open(rule_results_file, 'r', encoding='utf-8') as f:
            for line in f:
                try:
                    data = json.loads(line.strip())
                    if data.get('youtube_link') == youtube_link:
                        rule_eval_results = data.get('evaluation_results', {})
                        break
                except json.JSONDecodeError:
                    continue
    
    # RULE 결과와 LAAJ 결과 병합
    merged_results = {
        **rule_eval_results,  # category_validity_TF, location_match_TF
        **laaj_results        # 5개 LAAJ 평가 항목
    }
    
    return {
        'youtube_link': youtube_link,
        'evaluation_target': evaluation_target,
        'evaluation_results': merged_results,
        'restaurants': restaurants,
        'youtube_meta': youtube_meta
    }


def save_to_jsonl(record: Dict[str, Any], output_path: Path) -> None:
    """
    JSONL 형식으로 저장 (append 모드)
    
    Args:
        record: 저장할 레코드
        output_path: 출력 파일 경로
    """
    with open(output_path, 'a', encoding='utf-8') as f:
        f.write(json.dumps(record, ensure_ascii=False) + '\n')


def main():
    """메인 실행 함수"""
    parser = argparse.ArgumentParser(description='Gemini CLI LAAJ 평가 결과 파서')
    parser.add_argument('--youtube-link', required=True, help='YouTube URL')
    parser.add_argument('--response-file', required=True, help='Gemini 응답 파일 경로')
    parser.add_argument('--output-file', required=True, help='출력 JSONL 파일 경로')
    parser.add_argument('--evaluation-target', required=True, help='평가 대상 JSON')
    parser.add_argument('--restaurants', required=True, help='음식점 목록 JSON')
    parser.add_argument('--youtube-meta-file', default=None, help='YouTube 메타 정보 JSON 파일 경로')
    parser.add_argument('--rule-results-file', default=None, help='RULE 평가 결과 파일 경로')
    
    args = parser.parse_args()
    
    youtube_link = args.youtube_link
    response_file = Path(args.response_file)
    output_file = Path(args.output_file)
    
    # JSON 파싱
    try:
        evaluation_target = json.loads(args.evaluation_target)
        restaurants = json.loads(args.restaurants)
        
        # youtube_meta는 파일에서 읽기 (JSON 이스케이프 문제 방지)
        if args.youtube_meta_file and Path(args.youtube_meta_file).exists():
            with open(args.youtube_meta_file, 'r', encoding='utf-8') as f:
                youtube_meta = json.load(f)
        else:
            youtube_meta = {}
    except json.JSONDecodeError as e:
        print(f"❌ 인자 JSON 파싱 실패: {e}", file=sys.stderr)
        sys.exit(1)
    
    # RULE 결과 파일 경로 설정
    if args.rule_results_file:
        rule_results_file = Path(args.rule_results_file)
    else:
        rule_results_file = output_file.parent / "evaluation_rule_results.jsonl"
    
    # Gemini CLI 응답 읽기
    if not response_file.exists():
        print(f"❌ 응답 파일 없음: {response_file}", file=sys.stderr)
        sys.exit(1)
    
    with open(response_file, 'r', encoding='utf-8') as f:
        response_text = f.read()
    
    # JSON 파싱
    laaj_results = parse_gemini_response(response_text)
    if not laaj_results:
        sys.exit(1)
    
    # 유효성 검증
    if not validate_evaluation_data(laaj_results):
        sys.exit(1)
    
    # RULE 결과와 병합
    merged_record = merge_with_rule_results(
        youtube_link=youtube_link,
        laaj_results=laaj_results,
        evaluation_target=evaluation_target,
        restaurants=restaurants,
        youtube_meta=youtube_meta,
        rule_results_file=rule_results_file
    )
    
    # JSONL 저장
    try:
        save_to_jsonl(merged_record, output_file)
        print(f"✅ 저장 완료: {youtube_link}")
    except Exception as e:
        print(f"❌ 저장 실패: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
