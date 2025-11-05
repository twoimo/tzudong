"""
음식점 평가 결과 변환 스크립트
youtube_link 기준 → youtube_link-restaurant_name 기준으로 변환
Missing 음식점 별도 레코드 생성
"""

import json
from typing import Dict, List, Any, Optional
from pathlib import Path


def extract_restaurant_evaluation(
    evaluation_results: Dict[str, Any], 
    restaurant_name: str
) -> Dict[str, Any]:
    """
    특정 음식점의 평가 결과만 추출
    
    Args:
        evaluation_results: 전체 평가 결과
        restaurant_name: 추출할 음식점명
        
    Returns:
        해당 음식점의 평가 결과
    """
    result = {}
    
    # 각 평가 항목별로 해당 음식점 데이터만 추출
    eval_keys = [
        'visit_authenticity',
        'rb_inference_score',
        'rb_grounding_TF',
        'review_faithfulness_score',
        'category_TF',
        'category_validity_TF',
        'location_match_TF'
    ]
    
    for eval_key in eval_keys:
        if eval_key == 'visit_authenticity':
            # visit_authenticity는 values 배열 안에 있음
            values = evaluation_results.get(eval_key, {}).get('values', [])
            matching = [v for v in values if v.get('name') == restaurant_name]
            result[eval_key] = matching[0] if matching else None
        else:
            # 나머지는 직접 배열
            items = evaluation_results.get(eval_key, [])
            matching = [item for item in items if item.get('name') == restaurant_name]
            result[eval_key] = matching[0] if matching else None
    
    return result


def get_naver_address_info(location_match: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """
    Naver 지오코딩 결과에서 주소 정보 추출
    
    Args:
        location_match: location_match_TF 평가 결과
        
    Returns:
        Naver 주소 정보 또는 None
    """
    if not location_match or not location_match.get('eval_value'):
        return None
    
    naver_address = location_match.get('naver_address')
    if not naver_address or len(naver_address) == 0:
        return None
    
    # 첫 번째 결과 사용
    naver_addr = naver_address[0]
    
    return {
        "road_address": naver_addr.get('roadAddress'),
        "jibun_address": naver_addr.get('jibunAddress'),
        "english_address": naver_addr.get('englishAddress'),
        "address_elements": naver_addr.get('addressElements'),
        "x": naver_addr.get('x'),  # lng
        "y": naver_addr.get('y')   # lat
    }


def transform_evaluation_results(
    input_file: str = "tzuyang_restaurant_evaluation_results.jsonl",
    output_file: str = "transform.jsonl"
):
    """
    평가 결과를 youtube_link-음식점명 기준으로 변환
    
    Args:
        input_file: 입력 파일 경로
        output_file: 출력 파일 경로
    """
    input_path = Path(input_file)
    output_path = Path(output_file)
    
    if not input_path.exists():
        raise FileNotFoundError(f"입력 파일을 찾을 수 없습니다: {input_file}")
    
    transformed_records = []
    stats = {
        'total_videos': 0,
        'total_restaurants': 0,
        'missing_restaurants': 0,
        'geocoding_success': 0,
        'geocoding_failed': 0
    }
    
    print(f"📂 입력 파일: {input_path}")
    print(f"📝 변환 시작...")
    
    with open(input_path, 'r', encoding='utf-8') as f:
        for line_num, line in enumerate(f, 1):
            if not line.strip():
                continue
            
            try:
                record = json.loads(line)
            except json.JSONDecodeError as e:
                print(f"⚠️ 라인 {line_num}: JSON 파싱 실패 - {e}")
                continue
            
            stats['total_videos'] += 1
            
            youtube_link = record['youtube_link']
            youtube_meta = record.get('youtube_meta', {})
            evaluation_results = record['evaluation_results']
            
            # 1. Missing 음식점 처리
            missing_restaurants = evaluation_results.get('visit_authenticity', {}).get('missing', [])
            
            for missing_name in missing_restaurants:
                stats['missing_restaurants'] += 1
                
                transformed_records.append({
                    "youtube_link": youtube_link,
                    "restaurant_name": missing_name,
                    "status": "missing",
                    "missing_message": f"youtube_link에서 음식점 누락({missing_name}) 존재",
                    "youtube_meta": youtube_meta,
                    "evaluation_results": None,
                    "restaurant_info": None,
                    "geocoding_success": False,
                    "geocoding_fail_reason": "Missing 음식점 - 데이터 없음"
                })
            
            # 2. 정상 음식점 처리
            restaurants = record.get('restaurants', [])
            
            for restaurant in restaurants:
                stats['total_restaurants'] += 1
                
                restaurant_name = restaurant['name']
                
                # 평가 결과 추출 (해당 음식점만)
                restaurant_evaluation = extract_restaurant_evaluation(
                    evaluation_results,
                    restaurant_name
                )
                
                # 지오코딩 성공 여부 확인
                location_match = restaurant_evaluation.get('location_match_TF')
                geocoding_success = location_match and location_match.get('eval_value', False)
                geocoding_fail_reason = None
                
                if not geocoding_success and location_match:
                    geocoding_fail_reason = location_match.get('falseMessage', '알 수 없는 이유')
                    stats['geocoding_failed'] += 1
                elif geocoding_success:
                    stats['geocoding_success'] += 1
                
                # Naver 주소 정보 추출
                naver_address_info = get_naver_address_info(location_match)
                
                # 카테고리 수정 여부 확인
                category_tf = restaurant_evaluation.get('category_TF')
                final_category = restaurant.get('category')
                
                if category_tf and not category_tf.get('eval_value'):
                    # 카테고리 수정이 있는 경우
                    final_category = category_tf.get('category_revision', final_category)
                
                transformed_records.append({
                    "youtube_link": youtube_link,
                    "restaurant_name": restaurant_name,
                    "status": "pending",  # 미처리
                    "youtube_meta": youtube_meta,
                    "evaluation_results": restaurant_evaluation,
                    "restaurant_info": {
                        "name": restaurant['name'],
                        "phone": restaurant.get('phone'),
                        "category": final_category,
                        "origin_address": restaurant.get('address'),
                        "origin_lat": restaurant.get('lat'),
                        "origin_lng": restaurant.get('lng'),
                        "reasoning_basis": restaurant.get('reasoning_basis'),
                        "tzuyang_review": restaurant.get('tzuyang_review'),
                        "naver_address_info": naver_address_info
                    },
                    "geocoding_success": geocoding_success,
                    "geocoding_fail_reason": geocoding_fail_reason
                })
            
            # 진행 상황 표시
            if line_num % 50 == 0:
                print(f"  처리 중... {line_num}개 영상")
    
    # 결과 저장
    with open(output_path, 'w', encoding='utf-8') as f:
        for record in transformed_records:
            f.write(json.dumps(record, ensure_ascii=False) + '\n')
    
    # 통계 출력
    print(f"\n✅ 변환 완료!")
    print(f"📊 통계:")
    print(f"   - 총 영상: {stats['total_videos']}개")
    print(f"   - 총 음식점: {stats['total_restaurants']}개")
    print(f"   - Missing 음식점: {stats['missing_restaurants']}개")
    print(f"   - 지오코딩 성공: {stats['geocoding_success']}개")
    print(f"   - 지오코딩 실패: {stats['geocoding_failed']}개")
    print(f"   - 총 레코드: {len(transformed_records)}개")
    print(f"\n📁 출력 파일: {output_path}")
    
    return transformed_records, stats


if __name__ == "__main__":
    import sys
    
    # 명령줄 인자 처리
    input_file = sys.argv[1] if len(sys.argv) > 1 else "tzuyang_restaurant_evaluation_results.jsonl"
    output_file = sys.argv[2] if len(sys.argv) > 2 else "transform.jsonl"
    
    try:
        transform_evaluation_results(input_file, output_file)
    except Exception as e:
        print(f"❌ 오류 발생: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
