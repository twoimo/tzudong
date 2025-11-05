"""
중복 레코드 분석 스크립트
"""

import json
from pathlib import Path
from collections import Counter

def analyze_duplicates():
    jsonl_file = Path(__file__).parent / 'transform.jsonl'
    
    records = []
    with open(jsonl_file, 'r', encoding='utf-8') as f:
        for line in f:
            if line.strip():
                record = json.loads(line)
                # restaurant_name이 null인 경우 기본값 설정
                if not record.get('restaurant_name'):
                    if record.get('restaurant_info') and record['restaurant_info'].get('name'):
                        record['restaurant_name'] = record['restaurant_info']['name']
                    else:
                        record['restaurant_name'] = '알 수 없음'
                records.append(record)
    
    # youtube_link별 카운트
    youtube_links = [r['youtube_link'] for r in records]
    link_counts = Counter(youtube_links)
    
    # restaurant_name별 카운트
    restaurant_names = [r.get('restaurant_name', 'None') if isinstance(r.get('restaurant_name'), str) else str(r.get('restaurant_name')) for r in records]
    name_counts = Counter(restaurant_names)
    
    # youtube_link + restaurant_name 조합별 카운트
    combinations = []
    for r in records:
        name = r.get('restaurant_name', 'None') if isinstance(r.get('restaurant_name'), str) else str(r.get('restaurant_name'))
        combinations.append((r['youtube_link'], name))
    combination_counts = Counter(combinations)
    
    print(f"총 레코드 수: {len(records)}")
    print(f"고유한 youtube_link 수: {len(set(youtube_links))}")
    print(f"고유한 restaurant_name 수: {len(set(restaurant_names))}")
    print(f"고유한 (youtube_link, restaurant_name) 조합 수: {len(set(combinations))}")
    
    print("\n=== 중복된 youtube_link ===")
    duplicates = [(link, count) for link, count in link_counts.items() if count > 1]
    if duplicates:
        for link, count in sorted(duplicates, key=lambda x: x[1], reverse=True)[:10]:
            print(f"{count}회: {link}")
    else:
        print("없음")
    
    print("\n=== 중복된 (youtube_link, restaurant_name) 조합 ===")
    dup_combinations = [(combo, count) for combo, count in combination_counts.items() if count > 1]
    if dup_combinations:
        for combo, count in sorted(dup_combinations, key=lambda x: x[1], reverse=True)[:10]:
            print(f"{count}회: {combo[0]} | {combo[1]}")
    else:
        print("없음")
    
    print("\n=== '알 수 없음'으로 설정된 레코드 ===")
    unknown_records = [r for r in records if r['restaurant_name'] == '알 수 없음']
    print(f"총 {len(unknown_records)}개")
    for r in unknown_records[:5]:
        print(f"  - {r['youtube_link']}")

if __name__ == "__main__":
    analyze_duplicates()
