#!/usr/bin/env python3
"""
평가 대상 선정 스크립트
tzuyang_restaurant_results.jsonl에서 데이터를 읽어와 평가 대상을 선정하고
tzuyang_restaurant_evaluation_target.jsonl 파일을 생성합니다.
"""

import json
import os
import sys
from pathlib import Path

# 공통 유틸리티 함수 import
sys.path.append(os.path.join(os.path.dirname(__file__), '../../utils'))
from duplicate_checker import load_processed_urls, append_to_jsonl

def create_evaluation_targets():
    """
    평가 대상 데이터를 생성합니다.
    """
    # 경로 설정
    current_dir = Path(__file__).parent
    crawling_dir = current_dir.parent.parent / "perplexity-restaurant-crawling"
    input_file = crawling_dir / "tzuyang_restaurant_results_with_meta.jsonl"  # youtube_meta 포함 파일 사용
    output_file = current_dir.parent / "tzuyang_restaurant_evaluation_selection.jsonl"
    address_null_file = current_dir.parent / "tzuyang_restaurant_evaluation_notSelection_with_addressNull.jsonl"

    print(f"입력 파일: {input_file}")
    print(f"출력 파일: {output_file}")
    print(f"Address Null 파일: {address_null_file}")

    if not input_file.exists():
        raise FileNotFoundError(f"입력 파일이 존재하지 않습니다: {input_file}")

    # 1. 이미 처리된 youtube_link 수집 (유틸리티 함수 사용)
    print(f"� 기존 처리 내역 확인 중...")
    processed_links = load_processed_urls(str(output_file))
    processed_links_null = load_processed_urls(str(address_null_file))
    all_processed = processed_links | processed_links_null  # 합집합
    
    print(f"✅ 이미 처리된 레코드:")
    print(f"   - Selection: {len(processed_links)}개")
    print(f"   - NotSelection: {len(processed_links_null)}개")
    print(f"   - 총합: {len(all_processed)}개\n")

    processed_count = 0
    skipped_count = 0
    address_null_count = 0

    # 2. append 모드로 파일 열기
    with open(input_file, 'r', encoding='utf-8') as f_in:

        for line_num, line in enumerate(f_in, 1):
            try:
                # JSON 라인 파싱
                data = json.loads(line.strip())
                
                youtube_link = data.get('youtube_link')
                
                # 이미 처리된 youtube_link인지 확인
                if youtube_link in all_processed:
                    skipped_count += 1
                    if skipped_count % 100 == 1:  # 100개마다 한 번씩만 로그
                        print(f"⏭️  라인 {line_num} 건너뛰기 (이미 처리됨)")
                    continue

                # evaluation_target 생성
                evaluation_target = {}
                restaurants = data.get('restaurants', [])
                has_null_address = False

                for restaurant in restaurants:
                    name = restaurant.get('name')
                    address = restaurant.get('address')

                    if name:
                        # address가 null이면 False, 아니면 True
                        is_valid = address is not None
                        evaluation_target[name] = is_valid
                        if not is_valid:
                            has_null_address = True

                # 새로운 데이터 구조 생성
                new_data = {
                    'youtube_link': data.get('youtube_link'),
                    'evaluation_target': evaluation_target,
                    'restaurants': restaurants,
                    'youtube_meta': data.get('youtube_meta', {})
                }

                # append 모드로 즉시 저장 (유틸리티 함수 사용)
                append_to_jsonl(str(output_file), new_data)
                all_processed.add(youtube_link)  # 처리 완료 후 추가

                # address가 null인 데이터만 별도 파일에 저장
                if has_null_address:
                    append_to_jsonl(str(address_null_file), new_data)
                    address_null_count += 1

                processed_count += 1
                if processed_count % 10 == 0:  # 10개마다 진행 상황 출력
                    print(f"✓ 진행 중... {processed_count}개 처리 완료")

            except json.JSONDecodeError as e:
                print(f"❌ 라인 {line_num} JSON 파싱 오류: {e}")
                continue
            except Exception as e:
                print(f"❌ 라인 {line_num} 처리 중 오류: {e}")
                continue

    print(f"\n{'='*50}")
    print(f"✅ 처리 완료!")
    print(f"📊 새로 처리된 레코드 수: {processed_count}")
    print(f"📊 건너뛴 레코드 수: {skipped_count}")
    print(f"📊 Address Null 레코드 수: {address_null_count}")
    print(f"📁 결과 파일 저장됨: {output_file}")
    print(f"📁 Address Null 파일 저장됨: {address_null_file}")
    print(f"{'='*50}\n")

    return output_file, address_null_file

def main():
    """
    메인 함수
    """
    try:
        output_file, address_null_file = create_evaluation_targets()
        print(f"\n🎉 평가 대상 선정 완료!")
        print(f"생성된 파일: {output_file}")
        print(f"Address Null 파일: {address_null_file}")

    except Exception as e:
        print(f"❌ 오류 발생: {e}")
        return 1

    return 0

if __name__ == "__main__":
    exit(main())