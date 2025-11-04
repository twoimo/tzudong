#!/usr/bin/env python3
"""
평가 대상 선정 스크립트
tzuyang_restaurant_results.jsonl에서 데이터를 읽어와 평가 대상을 선정하고
tzuyang_restaurant_evaluation_target.jsonl 파일을 생성합니다.
"""

import json
import os
from pathlib import Path

def create_evaluation_targets():
    """
    평가 대상 데이터를 생성합니다.
    """
    # 경로 설정
    current_dir = Path(__file__).parent
    crawling_dir = current_dir.parent.parent / "perplexity-restaurant-crawling"
    input_file = crawling_dir / "tzuyang_restaurant_results.jsonl"
    output_file = current_dir.parent / "tzuyang_restaurant_evaluation_selection.jsonl"
    address_null_file = current_dir.parent / "tzuyang_restaurant_evaluation_notSelection_with_addressNull.jsonl"

    print(f"입력 파일: {input_file}")
    print(f"출력 파일: {output_file}")
    print(f"Address Null 파일: {address_null_file}")

    if not input_file.exists():
        raise FileNotFoundError(f"입력 파일이 존재하지 않습니다: {input_file}")

    processed_count = 0
    address_null_count = 0

    with open(input_file, 'r', encoding='utf-8') as f_in, \
         open(output_file, 'w', encoding='utf-8') as f_out, \
         open(address_null_file, 'w', encoding='utf-8') as f_null:

        for line_num, line in enumerate(f_in, 1):
            try:
                # JSON 라인 파싱
                data = json.loads(line.strip())

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
                    'restaurants': restaurants
                }

                # JSONL 형식으로 저장 (기존 파일)
                f_out.write(json.dumps(new_data, ensure_ascii=False) + '\n')

                # address가 null인 데이터만 별도 파일에 저장
                if has_null_address:
                    f_null.write(json.dumps(new_data, ensure_ascii=False) + '\n')
                    address_null_count += 1

                processed_count += 1
                print(f"✓ 라인 {line_num} 처리 완료 - {len(restaurants)}개 음식점")

            except json.JSONDecodeError as e:
                print(f"❌ 라인 {line_num} JSON 파싱 오류: {e}")
                continue
            except Exception as e:
                print(f"❌ 라인 {line_num} 처리 중 오류: {e}")
                continue

    print(f"\n✅ 총 {processed_count}개 레코드 처리 완료")
    print(f"📁 결과 파일 저장됨: {output_file}")
    print(f"📁 Address Null 파일 저장됨: {address_null_file} ({address_null_count}개)")

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