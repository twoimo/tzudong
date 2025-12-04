#!/usr/bin/env python3
"""
평가 대상 선정 스크립트
crawling_results_with_meta.jsonl에서 데이터를 읽어와 평가 대상을 선정하고
evaluation_selection.jsonl 파일을 생성합니다.

GeminiCLI 버전
"""

import json
import os
import sys
from pathlib import Path
from datetime import datetime, timezone, timedelta

# 공통 유틸리티 함수 import
sys.path.append(os.path.join(os.path.dirname(__file__), '../../utils'))
from duplicate_checker import load_processed_urls, append_to_jsonl
from data_utils import DataPathManager

# 한국 시간대 (KST, UTC+9)
KST = timezone(timedelta(hours=9))

def get_today_folder() -> str:
    """오늘 날짜 폴더명 반환 (PIPELINE_DATE 환경변수 우선)"""
    pipeline_date = os.environ.get('PIPELINE_DATE')
    if pipeline_date:
        return pipeline_date
    return datetime.now(KST).strftime('%y-%m-%d')


def create_evaluation_targets():
    """
    평가 대상 데이터를 생성합니다.
    모든 날짜 폴더의 크롤링 데이터를 읽어서 처리합니다.
    """
    # 경로 설정
    current_dir = Path(__file__).parent
    today_folder = get_today_folder()
    
    # 크롤링 데이터 경로 - 모든 날짜 폴더에서 읽기
    crawling_dir = current_dir.parent.parent / "geminiCLI-restaurant-crawling"
    crawling_data_manager = DataPathManager(crawling_dir)
    
    # 모든 날짜 폴더에서 입력 파일 목록 가져오기
    all_input_files = crawling_data_manager.get_all_file_paths("tzuyang_restaurant_results_with_meta.jsonl")
    
    # 평가 데이터 경로 (출력은 오늘 날짜 폴더에)
    evaluation_data_dir = current_dir.parent / "data" / today_folder
    evaluation_data_dir.mkdir(parents=True, exist_ok=True)
    output_file = evaluation_data_dir / "tzuyang_restaurant_evaluation_selection.jsonl"
    address_null_file = evaluation_data_dir / "tzuyang_restaurant_evaluation_notSelection_with_addressNull.jsonl"

    print(f"📂 입력 파일 (모든 날짜 폴더에서 읽기):")
    for f in all_input_files:
        print(f"   - {f}")
    print(f"📁 출력 파일: {output_file}")
    print(f"📁 Address Null 파일: {address_null_file}")

    if not all_input_files:
        raise FileNotFoundError(f"입력 파일이 존재하지 않습니다. 크롤링 데이터가 없습니다.")

    # 1. 이미 처리된 youtube_link 수집 - 모든 날짜 폴더에서
    print(f"🔍 기존 처리 내역 확인 중 (모든 날짜 폴더)...")
    
    # 모든 날짜 폴더에서 처리된 링크 수집
    data_manager = DataPathManager(current_dir.parent)
    all_selection_files = data_manager.get_all_file_paths('tzuyang_restaurant_evaluation_selection.jsonl')
    all_null_files = data_manager.get_all_file_paths('tzuyang_restaurant_evaluation_notSelection_with_addressNull.jsonl')
    
    processed_links = set()
    processed_links_null = set()
    
    for f in all_selection_files:
        processed_links.update(load_processed_urls(str(f)))
    for f in all_null_files:
        processed_links_null.update(load_processed_urls(str(f)))
    
    all_processed = processed_links | processed_links_null  # 합집합
    
    print(f"✅ 이미 처리된 레코드 (전체 이력):")
    print(f"   - Selection: {len(processed_links)}개")
    print(f"   - NotSelection: {len(processed_links_null)}개")
    print(f"   - 총합: {len(all_processed)}개\n")

    processed_count = 0
    skipped_count = 0
    address_null_count = 0

    # 2. 모든 입력 파일을 순회하며 처리
    for input_file in all_input_files:
        print(f"\n📖 처리 중: {input_file}")
        
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
