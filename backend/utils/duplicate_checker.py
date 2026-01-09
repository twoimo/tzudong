#!/usr/bin/env python3
"""
중복 검사를 위한 공통 유틸리티 함수
모든 데이터 처리 스크립트에서 재사용 가능
"""

import os
import json
from typing import Set, List, Dict, Any, Callable


def load_processed_urls(file_path: str) -> Set[str]:
    """
    JSONL 파일에서 처리된 youtube_link 추출
    
    Args:
        file_path: JSONL 파일 경로
    
    Returns:
        처리된 URL들의 set
    
    Example:
        >>> processed_urls = load_processed_urls('tzuyang_restaurant_results.jsonl')
        >>> print(f"처리된 URL: {len(processed_urls)}개")
    """
    urls = set()
    
    if not os.path.exists(file_path):
        return urls
    
    with open(file_path, 'r', encoding='utf-8') as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            
            try:
                data = json.loads(line)
                if 'youtube_link' in data:
                    urls.add(data['youtube_link'])
            except json.JSONDecodeError as e:
                print(f"⚠️  JSON 파싱 오류 (라인 {line_num}): {e}")
                continue
    
    return urls


def load_processed_restaurants(
    file_path: str, 
    key: str = 'name',
    nested_key: str = 'restaurants'
) -> Set[str]:
    """
    JSONL 파일에서 처리된 restaurant 이름/ID 추출
    
    Args:
        file_path: JSONL 파일 경로
        key: 추출할 키 ('name', 'unique_id' 등)
        nested_key: restaurants가 들어있는 상위 키 (기본값: 'restaurants')
    
    Returns:
        처리된 restaurant 키값들의 set
    
    Example:
        >>> processed = load_processed_restaurants('output.jsonl', key='name')
        >>> new_restaurants = [r for r in input_list if r['name'] not in processed]
    """
    restaurants = set()
    
    if not os.path.exists(file_path):
        return restaurants
    
    with open(file_path, 'r', encoding='utf-8') as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            
            try:
                data = json.loads(line)
                
                # nested_key가 있는 경우 (예: {'restaurants': [...]})
                if nested_key and nested_key in data:
                    for restaurant in data[nested_key]:
                        if key in restaurant and restaurant[key]:
                            restaurants.add(restaurant[key])
                # nested_key가 없는 경우 (예: 각 라인이 restaurant)
                elif not nested_key and key in data and data[key]:
                    restaurants.add(data[key])
                    
            except json.JSONDecodeError as e:
                print(f"⚠️  JSON 파싱 오류 (라인 {line_num}): {e}")
                continue
    
    return restaurants


def load_processed_unique_ids(file_path: str) -> Set[str]:
    """
    JSONL 파일에서 처리된 unique_id 추출
    
    Args:
        file_path: JSONL 파일 경로
    
    Returns:
        처리된 unique_id들의 set
    
    Example:
        >>> written_ids = load_processed_unique_ids('transforms.jsonl')
        >>> if unique_id not in written_ids:
        >>>     # 새 데이터 추가
    """
    ids = set()
    
    if not os.path.exists(file_path):
        return ids
    
    with open(file_path, 'r', encoding='utf-8') as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            
            try:
                data = json.loads(line)
                if 'unique_id' in data and data['unique_id']:
                    ids.add(data['unique_id'])
            except json.JSONDecodeError as e:
                print(f"⚠️  JSON 파싱 오류 (라인 {line_num}): {e}")
                continue
    
    return ids


def filter_new_items(
    input_items: List[Any], 
    processed_items: Set[str], 
    key_func: Callable[[Any], str]
) -> List[Any]:
    """
    중복되지 않은 항목만 필터링
    
    Args:
        input_items: 입력 항목 리스트
        processed_items: 이미 처리된 항목 set
        key_func: 항목에서 키를 추출하는 함수
    
    Returns:
        중복되지 않은 항목 리스트
    
    Example:
        >>> processed_urls = load_processed_urls('output.jsonl')
        >>> new_items = filter_new_items(
        >>>     input_list, 
        >>>     processed_urls, 
        >>>     lambda x: x['youtube_link']
        >>> )
    """
    return [
        item for item in input_items 
        if key_func(item) not in processed_items
    ]


def append_to_jsonl(
    file_path: str, 
    data: Any,
    create_dirs: bool = True
) -> int:
    """
    JSONL 파일에 데이터 추가 (append 모드)
    
    Args:
        file_path: JSONL 파일 경로
        data: 추가할 데이터 (dict 또는 list)
        create_dirs: 디렉토리가 없으면 생성할지 여부
    
    Returns:
        추가된 항목 수
    
    Example:
        >>> count = append_to_jsonl('output.jsonl', new_data)
        >>> print(f"{count}개 항목 추가됨")
    """
    count = 0
    
    # 디렉토리가 없으면 생성
    if create_dirs:
        dir_path = os.path.dirname(file_path)
        if dir_path and not os.path.exists(dir_path):
            os.makedirs(dir_path, exist_ok=True)
    
    with open(file_path, 'a', encoding='utf-8') as f:
        if isinstance(data, list):
            for item in data:
                f.write(json.dumps(item, ensure_ascii=False) + '\n')
                count += 1
        else:
            f.write(json.dumps(data, ensure_ascii=False) + '\n')
            count = 1
    
    return count


def load_multiple_processed_urls(*file_paths: str) -> Set[str]:
    """
    여러 JSONL 파일에서 처리된 youtube_link 추출
    
    Args:
        *file_paths: JSONL 파일 경로들 (가변 인자)
    
    Returns:
        모든 파일에서 추출한 URL들의 합집합
    
    Example:
        >>> all_processed = load_multiple_processed_urls(
        >>>     'results.jsonl',
        >>>     'errors.jsonl',
        >>>     'no_selection.jsonl'
        >>> )
    """
    all_urls = set()
    
    for file_path in file_paths:
        urls = load_processed_urls(file_path)
        all_urls.update(urls)
    
    return all_urls


def load_multiple_processed_restaurants(
    *file_paths: str,
    key: str = 'name',
    nested_key: str = 'restaurants'
) -> Set[str]:
    """
    여러 JSONL 파일에서 처리된 restaurant 이름/ID 추출
    
    Args:
        *file_paths: JSONL 파일 경로들 (가변 인자)
        key: 추출할 키 ('name', 'unique_id' 등)
        nested_key: restaurants가 들어있는 상위 키
    
    Returns:
        모든 파일에서 추출한 restaurant 키값들의 합집합
    
    Example:
        >>> all_processed = load_multiple_processed_restaurants(
        >>>     'results.jsonl',
        >>>     'errors.jsonl',
        >>>     key='name'
        >>> )
    """
    all_restaurants = set()
    
    for file_path in file_paths:
        restaurants = load_processed_restaurants(file_path, key, nested_key)
        all_restaurants.update(restaurants)
    
    return all_restaurants


def get_file_stats(file_path: str) -> Dict[str, Any]:
    """
    JSONL 파일의 통계 정보 반환
    
    Args:
        file_path: JSONL 파일 경로
    
    Returns:
        파일 통계 정보 딕셔너리
    
    Example:
        >>> stats = get_file_stats('output.jsonl')
        >>> print(f"총 {stats['total_lines']}개 항목, 파일 크기: {stats['size_mb']:.2f}MB")
    """
    if not os.path.exists(file_path):
        return {
            'exists': False,
            'total_lines': 0,
            'valid_lines': 0,
            'invalid_lines': 0,
            'size_bytes': 0,
            'size_mb': 0
        }
    
    total_lines = 0
    valid_lines = 0
    invalid_lines = 0
    
    with open(file_path, 'r', encoding='utf-8') as f:
        for line in f:
            if line.strip():
                total_lines += 1
                try:
                    json.loads(line)
                    valid_lines += 1
                except json.JSONDecodeError:
                    invalid_lines += 1
    
    file_size = os.path.getsize(file_path)
    
    return {
        'exists': True,
        'total_lines': total_lines,
        'valid_lines': valid_lines,
        'invalid_lines': invalid_lines,
        'size_bytes': file_size,
        'size_mb': file_size / (1024 * 1024)
    }


if __name__ == '__main__':
    # 테스트 코드
    print("🧪 중복 검사 유틸리티 함수 테스트\n")
    
    # 예시 파일 경로
    test_file = 'test_output.jsonl'
    
    # 테스트 데이터 작성
    test_data = [
        {'youtube_link': 'https://youtube.com/watch?v=1', 'unique_id': 'id1', 'name': 'Restaurant 1'},
        {'youtube_link': 'https://youtube.com/watch?v=2', 'unique_id': 'id2', 'name': 'Restaurant 2'},
    ]
    
    print(f"📝 테스트 파일 작성: {test_file}")
    append_to_jsonl(test_file, test_data, create_dirs=False)
    
    # 통계 확인
    stats = get_file_stats(test_file)
    print(f"\n📊 파일 통계:")
    print(f"   - 총 라인: {stats['total_lines']}")
    print(f"   - 유효 라인: {stats['valid_lines']}")
    print(f"   - 파일 크기: {stats['size_mb']:.4f}MB")
    
    # URL 로드
    urls = load_processed_urls(test_file)
    print(f"\n🔗 처리된 URL: {len(urls)}개")
    for url in urls:
        print(f"   - {url}")
    
    # unique_id 로드
    ids = load_processed_unique_ids(test_file)
    print(f"\n🆔 처리된 unique_id: {len(ids)}개")
    for uid in ids:
        print(f"   - {uid}")
    
    # 테스트 파일 삭제
    if os.path.exists(test_file):
        os.remove(test_file)
        print(f"\n🗑️  테스트 파일 삭제: {test_file}")
    
    print("\n✅ 테스트 완료!")
