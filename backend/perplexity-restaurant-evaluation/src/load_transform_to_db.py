"""
transform.jsonl 데이터를 Supabase evaluation_records 테이블에 로드
"""

import json
import os
from pathlib import Path
from typing import List, Dict, Any
from supabase import create_client, Client


def load_transform_to_db(
    transform_file: str = "transform.jsonl",
    supabase_url: str = None,
    supabase_key: str = None
):
    """
    transform.jsonl을 evaluation_records 테이블에 로드
    
    Args:
        transform_file: transform.jsonl 파일 경로
        supabase_url: Supabase URL (None이면 환경변수 사용)
        supabase_key: Supabase Service Key (None이면 환경변수 사용)
    """
    # Supabase 클라이언트 초기화
    if not supabase_url:
        supabase_url = os.getenv('SUPABASE_URL') or os.getenv('VITE_SUPABASE_URL')
    if not supabase_key:
        supabase_key = os.getenv('SUPABASE_SERVICE_KEY') or os.getenv('VITE_SUPABASE_ANON_KEY')
    
    if not supabase_url or not supabase_key:
        raise ValueError(
            "Supabase URL과 Key가 필요합니다.\n"
            "환경변수 SUPABASE_URL, SUPABASE_SERVICE_KEY를 설정하거나\n"
            "또는 VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY를 설정하세요."
        )
    
    supabase: Client = create_client(supabase_url, supabase_key)
    
    transform_path = Path(transform_file)
    if not transform_path.exists():
        raise FileNotFoundError(f"파일을 찾을 수 없습니다: {transform_file}")
    
    print(f"📂 입력 파일: {transform_path}")
    print(f"🔗 Supabase URL: {supabase_url}")
    print(f"📤 데이터 로드 시작...")
    
    # 기존 데이터 삭제 (선택사항)
    print(f"\n⚠️ 기존 evaluation_records 데이터를 삭제하시겠습니까?")
    response = input("  삭제하려면 'yes' 입력: ").strip().lower()
    
    if response == 'yes':
        try:
            result = supabase.table('evaluation_records').delete().neq('id', '00000000-0000-0000-0000-000000000000').execute()
            print(f"✅ 기존 데이터 삭제 완료")
        except Exception as e:
            print(f"⚠️ 기존 데이터 삭제 중 오류 (무시하고 계속): {e}")
    
    # 데이터 읽기
    records = []
    with open(transform_path, 'r', encoding='utf-8') as f:
        for line_num, line in enumerate(f, 1):
            if not line.strip():
                continue
            
            try:
                record = json.loads(line)
            except json.JSONDecodeError as e:
                print(f"⚠️ 라인 {line_num}: JSON 파싱 실패 - {e}")
                continue
            
            # DB 스키마에 맞게 변환
            db_record = {
                'youtube_link': record['youtube_link'],
                'restaurant_name': record['restaurant_name'],
                'status': record['status'],
                'youtube_meta': record.get('youtube_meta'),
                'evaluation_results': record.get('evaluation_results'),
                'restaurant_info': record.get('restaurant_info'),
                'geocoding_success': record.get('geocoding_success', False),
                'geocoding_fail_reason': record.get('geocoding_fail_reason'),
                'db_conflict_info': record.get('db_conflict_info'),
                'missing_message': record.get('missing_message')
            }
            
            records.append(db_record)
            
            if len(records) % 50 == 0:
                print(f"  읽는 중... {len(records)}개")
    
    print(f"\n📊 총 {len(records)}개 레코드 읽기 완료")
    print(f"💾 데이터베이스에 삽입 중...")
    
    # 배치 삽입 (100개씩)
    batch_size = 100
    total_inserted = 0
    errors = []
    
    for i in range(0, len(records), batch_size):
        batch = records[i:i+batch_size]
        
        try:
            result = supabase.table('evaluation_records').insert(batch).execute()
            total_inserted += len(batch)
            print(f"  진행: {total_inserted}/{len(records)} ({total_inserted*100//len(records)}%)")
        except Exception as e:
            error_msg = f"배치 {i//batch_size + 1} 삽입 실패: {e}"
            errors.append(error_msg)
            print(f"❌ {error_msg}")
    
    print(f"\n✅ 데이터 로드 완료!")
    print(f"   - 총 레코드: {len(records)}개")
    print(f"   - 삽입 성공: {total_inserted}개")
    print(f"   - 삽입 실패: {len(records) - total_inserted}개")
    
    if errors:
        print(f"\n⚠️ 오류 목록:")
        for error in errors[:10]:  # 최대 10개만 표시
            print(f"   - {error}")
    
    # 통계 확인
    try:
        stats_result = supabase.table('evaluation_records').select('status', count='exact').execute()
        print(f"\n📊 상태별 통계:")
        
        status_counts = {}
        for record in stats_result.data:
            status = record['status']
            status_counts[status] = status_counts.get(status, 0) + 1
        
        for status, count in sorted(status_counts.items()):
            print(f"   - {status}: {count}개")
    except Exception as e:
        print(f"⚠️ 통계 조회 실패: {e}")


if __name__ == "__main__":
    import sys
    
    # .env 파일 로드 시도
    try:
        from dotenv import load_dotenv
        load_dotenv()
        print("✅ .env 파일 로드 완료")
    except ImportError:
        print("⚠️ python-dotenv 패키지가 없습니다. 환경변수를 직접 설정하세요.")
    
    transform_file = sys.argv[1] if len(sys.argv) > 1 else "../transform.jsonl"
    
    try:
        load_transform_to_db(transform_file)
    except Exception as e:
        print(f"❌ 오류 발생: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
