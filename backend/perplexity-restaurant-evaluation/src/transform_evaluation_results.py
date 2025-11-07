import json
import os
import hashlib

# --- 파일 경로 설정 ---
# (필요시 이 경로를 실제 파일 위치에 맞게 수정하세요.)
BASE_DIR = os.path.dirname(__file__) if '__file__' in locals() else os.getcwd()

# 입력 파일 경로
INPUT_FILE_RESULTS = os.path.join(BASE_DIR, '../tzuyang_restaurant_evaluation_results.jsonl')
INPUT_FILE_NOTSELECTION = os.path.join(BASE_DIR, '../tzuyang_restaurant_evaluation_notSelection_with_addressNull.jsonl')

# 최종 출력 파일
OUTPUT_FILE = os.path.join(BASE_DIR, '../tzuyang_restaurant_transforms.jsonl')


def generate_unique_id(youtube_link, name, review):
    """
    youtube_link, name, tzuyang_review를 조합하여 SHA-256 해시 ID를 생성합니다.
    값이 None일 경우 빈 문자열로 처리합니다.
    """
    key_string = (
        str(youtube_link or "") + 
        str(name or "") + 
        str(review or "")
    )
    return hashlib.sha256(key_string.encode('utf-8')).hexdigest()


def transform_json_object(original_data, source_file_type):
    """
    하나의 원본 JSON 객체를 '펼쳐진' 구조의 객체 리스트로 변환합니다.
    unique_id가 각 객체에 포함됩니다.
    """
    flattened_results = []
    
    youtube_link = original_data.get('youtube_link')
    youtube_meta = original_data.get('youtube_meta')
    original_eval_results = original_data.get('evaluation_results')
    restaurants_list = original_data.get('restaurants', [])
    evaluation_targets = original_data.get('evaluation_target', {})

    # --- 공통 함수: 'evaluation_results'에서 name으로 항목 찾기 ---
    def get_eval_item(eval_results, rest_name, key):
        if not eval_results:
            return None
        
        value = eval_results.get(key)
        if not value:
            return None

        item_list = []
        if isinstance(value, dict) and 'values' in value:
            item_list = value['values']
        elif isinstance(value, list):
            item_list = value
        
        found_item = next((item for item in item_list if item.get('name') == rest_name), None)
        
        if found_item:
            new_item = found_item.copy()
            del new_item['name']
            return new_item
        return None

    # --- 공통 함수: 'location_match_TF' 처리 ---
    def get_location_data(eval_results, rest_name, is_missing_flag):
        loc_data = {
            "roadAddress": None, "jibunAddress": None, "englishAddress": None,
            "addressElements": None, "geocoding_success": False, "geocoding_false_stage": None
        }
        
        loc_match_item = None
        if eval_results:
            loc_match_list = eval_results.get('location_match_TF', [])
            loc_match_item = next((item for item in loc_match_list if item.get('name') == rest_name), None)

        if loc_match_item:
            loc_data["geocoding_success"] = loc_match_item.get('eval_value', False)
            if not loc_data["geocoding_success"]:
                false_message = loc_match_item.get('falseMessage', '')
                if false_message == "1단계 실패: 주소 지오코딩 실패" or \
                   false_message == "1단계 실패: 검색 결과 없음":
                    loc_data["geocoding_false_stage"] = 1
                elif false_message == "2단계 실패: 20m 이내 후보 없음":
                    loc_data["geocoding_false_stage"] = 2
            
            naver_address = loc_match_item.get('naver_address')
            if naver_address and len(naver_address) > 0:
                naver_address_data = naver_address[0]
                loc_data["roadAddress"] = naver_address_data.get('roadAddress')
                loc_data["jibunAddress"] = naver_address_data.get('jibunAddress')
                loc_data["englishAddress"] = naver_address_data.get('englishAddress')
                loc_data["addressElements"] = naver_address_data.get('addressElements')

        if source_file_type == 'results' and is_missing_flag:
            loc_data["geocoding_false_stage"] = None
        elif source_file_type == 'notSelection':
            loc_data["geocoding_false_stage"] = 0
            
        return loc_data

    # -----------------------------------------------------------------
    # 1. 'results' 파일 처리 (restaurants 리스트 기준 + missing 보충)
    # -----------------------------------------------------------------
    if source_file_type == 'results':
        processed_names = set()

        # --- 1A. 'restaurants' 리스트를 기준으로 처리 ---
        for restaurant_data in restaurants_list:
            restaurant_name = restaurant_data.get('name')
            if not restaurant_name:
                continue
            
            processed_names.add(restaurant_name)
            is_target = evaluation_targets.get(restaurant_name, True)
            
            loc_data = get_location_data(original_eval_results, restaurant_name, is_missing_flag=False)
            
            new_eval_results = {}
            if original_eval_results:
                for key in original_eval_results:
                    if key == 'location_match_TF': continue
                    if key == 'visit_authenticity':
                        visit_auth_values = original_eval_results.get('visit_authenticity', {}).get('values', [])
                        visit_auth_item = next((item for item in visit_auth_values if item.get('name') == restaurant_name), None)
                        if visit_auth_item:
                            new_visit_item = visit_auth_item.copy()
                            del new_visit_item['name']
                            new_eval_results['visit_authenticity'] = new_visit_item
                    else:
                        eval_item = get_eval_item(original_eval_results, restaurant_name, key)
                        if eval_item:
                            new_eval_results[key] = eval_item
            
            tzuyang_review = restaurant_data.get('tzuyang_review')
            output = {
                "youtube_link": youtube_link, "status": "pending", "youtube_meta": youtube_meta,
                "name": restaurant_name,
                "phone": restaurant_data.get('phone'),
                "category": restaurant_data.get('category'),
                "reasoning_basis": restaurant_data.get('reasoning_basis'),
                "tzuyang_review": tzuyang_review,
                "origin_address": {
                    "address": restaurant_data.get('address'),
                    "lat": restaurant_data.get('lat'),
                    "lng": restaurant_data.get('lng')
                },
                "roadAddress": loc_data["roadAddress"],
                "jibunAddress": loc_data["jibunAddress"],
                "englishAddress": loc_data["englishAddress"],
                "addressElements": loc_data["addressElements"],
                "geocoding_success": loc_data["geocoding_success"],
                "geocoding_false_stage": loc_data["geocoding_false_stage"],
                "is_missing": False,
                "is_notSelected": not is_target,
                "evaluation_results": new_eval_results if new_eval_results else None
            }
            output['unique_id'] = generate_unique_id(youtube_link, restaurant_name, tzuyang_review)
            flattened_results.append(output)

        # --- 1B. 'evaluation_target'에만 있는 항목 처리 (Missing 1) ---
        for restaurant_name, is_target in evaluation_targets.items():
            if restaurant_name not in processed_names:
                processed_names.add(restaurant_name)
                loc_data = get_location_data(original_eval_results, restaurant_name, is_missing_flag=True)
                
                output = {
                    "youtube_link": youtube_link, "status": "pending", "youtube_meta": youtube_meta,
                    "name": restaurant_name,
                    "phone": None, "category": None, "reasoning_basis": None, "tzuyang_review": None,
                    "origin_address": None,
                    "roadAddress": loc_data["roadAddress"],
                    "jibunAddress": loc_data["jibunAddress"],
                    "englishAddress": loc_data["englishAddress"],
                    "addressElements": loc_data["addressElements"],
                    "geocoding_success": loc_data["geocoding_success"],
                    "geocoding_false_stage": loc_data["geocoding_false_stage"],
                    "is_missing": True,
                    "is_notSelected": not is_target,
                    "evaluation_results": None
                }
                output['unique_id'] = generate_unique_id(youtube_link, restaurant_name, None)
                flattened_results.append(output)

        # --- 1C. 'visit_authenticity.missing'에만 있는 항목 처리 (Missing 2) ---
        if original_eval_results:
            missing_list = original_eval_results.get('visit_authenticity', {}).get('missing', [])
            for missing_item in missing_list:
                missing_name = missing_item.get('name')
                if not missing_name or missing_name in processed_names:
                    continue
                
                processed_names.add(missing_name)
                loc_data = get_location_data(original_eval_results, missing_name, is_missing_flag=True)

                output = {
                    "youtube_link": youtube_link, "status": "pending", "youtube_meta": youtube_meta,
                    "name": missing_name,
                    "phone": None, "category": None, "reasoning_basis": None, "tzuyang_review": None,
                    "origin_address": None,
                    "roadAddress": loc_data["roadAddress"],
                    "jibunAddress": loc_data["jibunAddress"],
                    "englishAddress": loc_data["englishAddress"],
                    "addressElements": loc_data["addressElements"],
                    "geocoding_success": loc_data["geocoding_success"],
                    "geocoding_false_stage": loc_data["geocoding_false_stage"],
                    "is_missing": True,
                    "is_notSelected": False,
                    "evaluation_results": None
                }
                output['unique_id'] = generate_unique_id(youtube_link, missing_name, None)
                flattened_results.append(output)

    # -----------------------------------------------------------------
    # 2. 'notSelection' 파일 처리 (evaluation_target 기준)
    # -----------------------------------------------------------------
    elif source_file_type == 'notSelection':
        for restaurant_name, is_target in evaluation_targets.items():
            restaurant_data = next((r for r in restaurants_list if r.get('name') == restaurant_name), None)
            is_missing = (restaurant_data is None)
            
            loc_data = get_location_data(None, restaurant_name, is_missing_flag=is_missing)
            
            tzuyang_review = restaurant_data.get('tzuyang_review') if restaurant_data else None
            output = {
                "youtube_link": youtube_link, "status": "pending", "youtube_meta": youtube_meta,
                "name": restaurant_name,
                "phone": restaurant_data.get('phone') if restaurant_data else None,
                "category": restaurant_data.get('category') if restaurant_data else None,
                "reasoning_basis": restaurant_data.get('reasoning_basis') if restaurant_data else None,
                "tzuyang_review": tzuyang_review,
                "origin_address": {
                    "address": restaurant_data.get('address'),
                    "lat": restaurant_data.get('lat'),
                    "lng": restaurant_data.get('lng')
                } if restaurant_data else None,
                "roadAddress": loc_data["roadAddress"],
                "jibunAddress": loc_data["jibunAddress"],
                "englishAddress": loc_data["englishAddress"],
                "addressElements": loc_data["addressElements"],
                "geocoding_success": loc_data["geocoding_success"],
                "geocoding_false_stage": loc_data["geocoding_false_stage"],
                "is_missing": is_missing,
                "is_notSelected": not is_target,
                "evaluation_results": None
            }
            output['unique_id'] = generate_unique_id(youtube_link, restaurant_name, tzuyang_review)
            flattened_results.append(output)

    return flattened_results

# --- 메인 실행 로직 ---
def main():
    written_ids = set()
    stats = {
        "results_lines": 0,
        "notselection_lines": 0,
        "total_processed": 0,
        "total_written": 0,
        "total_skipped": 0
    }
    
    # 출력 디렉토리 생성 (필요한 경우)
    try:
        os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    except Exception as e:
        print(f"출력 디렉토리 생성 실패: {e}")
        return

    # 1. & 2. 파일 처리 및 쓰기 (하나의 'w' 컨텍스트에서)
    try:
        with open(OUTPUT_FILE, 'w', encoding='utf-8') as f_out:
            
            # --- 1. 'results' 파일 처리 ---
            print(f"'{INPUT_FILE_RESULTS}' 파일 처리 시작...")
            try:
                with open(INPUT_FILE_RESULTS, 'r', encoding='utf-8') as f_in:
                    for i, line in enumerate(f_in):
                        stats["results_lines"] += 1
                        try:
                            data = json.loads(line)
                            transformed_list = transform_json_object(data, source_file_type='results')
                            
                            for entry in transformed_list:
                                stats["total_processed"] += 1
                                uid = entry.get('unique_id')
                                
                                if uid not in written_ids:
                                    f_out.write(json.dumps(entry, ensure_ascii=False) + '\n')
                                    written_ids.add(uid)
                                    stats["total_written"] += 1
                                else:
                                    stats["total_skipped"] += 1
                                    
                        except json.JSONDecodeError:
                            print(f"  [경고] '{INPUT_FILE_RESULTS}' {i+1}번째 줄 JSON 디코딩 실패. 건너뜁니다.")
                        except Exception as e:
                            print(f"  [오류] '{INPUT_FILE_RESULTS}' {i+1}번째 줄 처리 중 오류: {e}")
            except FileNotFoundError:
                print(f"  [오류] '{INPUT_FILE_RESULTS}' 파일을 찾을 수 없습니다.")
            except Exception as e:
                print(f"  [오류] '{INPUT_FILE_RESULTS}' 파일 읽기 중 오류: {e}")

            # --- 2. 'notSelection' 파일 처리 ---
            print(f"'{INPUT_FILE_NOTSELECTION}' 파일 처리 시작...")
            try:
                with open(INPUT_FILE_NOTSELECTION, 'r', encoding='utf-8') as f_in:
                    for i, line in enumerate(f_in):
                        stats["notselection_lines"] += 1
                        try:
                            data = json.loads(line)
                            transformed_list = transform_json_object(data, source_file_type='notSelection')
                            
                            for entry in transformed_list:
                                stats["total_processed"] += 1
                                uid = entry.get('unique_id')
                                
                                if uid not in written_ids:
                                    f_out.write(json.dumps(entry, ensure_ascii=False) + '\n')
                                    written_ids.add(uid)
                                    stats["total_written"] += 1
                                else:
                                    stats["total_skipped"] += 1
                                    
                        except json.JSONDecodeError:
                            print(f"  [경고] '{INPUT_FILE_NOTSELECTION}' {i+1}번째 줄 JSON 디코딩 실패. 건너뜁니다.")
                        except Exception as e:
                            print(f"  [오류] '{INPUT_FILE_NOTSELECTION}' {i+1}번째 줄 처리 중 오류: {e}")
            except FileNotFoundError:
                print(f"  [오류] '{INPUT_FILE_NOTSELECTION}' 파일을 찾을 수 없습니다.")
            except Exception as e:
                print(f"  [오류] '{INPUT_FILE_NOTSELECTION}' 파일 읽기 중 오류: {e}")
    
    except Exception as e:
        print(f"'{OUTPUT_FILE}' 파일 쓰기 중 치명적 오류 발생: {e}")
        return

    # --- 3. 최종 통계 출력 ---
    print("\n--- 🚀 작업 완료: 처리 통계 ---")
    print(f"  'results' 파일 처리 라인: {stats['results_lines']} 개")
    print(f"  'notSelection' 파일 처리 라인: {stats['notselection_lines']} 개")
    print("-" * 30)
    print(f"  총 변환 시도 항목: {stats['total_processed']} 개")
    print(f"  ✅ 최종 파일에 쓰인 항목: {stats['total_written']} 개")
    print(f"  ⏭️ 중복으로 건너뛴 항목: {stats['total_skipped']} 개")
    print(f"\n결과가 '{OUTPUT_FILE}' 파일에 저장되었습니다.")

if __name__ == "__main__":
    main()