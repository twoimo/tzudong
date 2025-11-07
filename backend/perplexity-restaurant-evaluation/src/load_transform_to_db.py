"""
transform.jsonl 데이터를 Supabase evaluation_records 테이블에 로드
"""

import json
import os
from pathlib import Path
from typing import List, Dict, Any
from supabase import create_client, Client


def apply_migration(supabase: Client):
    """
    not_selected status를 추가하는 마이그레이션 적용
    """
    print("\n🔧 데이터베이스 마이그레이션 적용 중...")
    
    try:
        # CHECK 제약 제거
        supabase.postgrest.rpc('exec', {
            'query': 'ALTER TABLE public.evaluation_records DROP CONSTRAINT IF EXISTS evaluation_records_status_check;'
        }).execute()
        
        # 새 CHECK 제약 추가
        supabase.postgrest.rpc('exec', {
            'query': '''
                ALTER TABLE public.evaluation_records 
                ADD CONSTRAINT evaluation_records_status_check 
                CHECK (status IN (
                  'pending', 'approved', 'hold', 'deleted', 
                  'missing', 'db_conflict', 'geocoding_failed', 'not_selected'
                ));
            '''
        }).execute()
        
        # RLS 비활성화
        supabase.postgrest.rpc('exec', {
            'query': 'ALTER TABLE public.evaluation_records DISABLE ROW LEVEL SECURITY;'
        }).execute()
        
        print("✅ 마이그레이션 적용 완료!")
    except Exception as e:
        print(f"⚠️ 마이그레이션 실패 (이미 적용되었을 수 있음): {e}")


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
        supabase_key = (os.getenv('SUPABASE_SERVICE_KEY') or 
                       os.getenv('VITE_SUPABASE_ANON_KEY') or 
                       os.getenv('VITE_SUPABASE_PUBLISHABLE_KEY'))
    
    if not supabase_url or not supabase_key:
        raise ValueError(
            "Supabase URL과 Key가 필요합니다.\n"
            "환경변수 SUPABASE_URL, SUPABASE_SERVICE_KEY를 설정하거나\n"
            "또는 VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY를 설정하세요."
        )
    
    supabase: Client = create_client(supabase_url, supabase_key)
    
    # 마이그레이션 적용 (선택사항 - 이미 적용되었을 수 있음)
    apply_migration(supabase)
    
    transform_path = Path(transform_file)
    if not transform_path.exists():
        raise FileNotFoundError(f"파일을 찾을 수 없습니다: {transform_file}")
    
    print(f"\n📂 입력 파일: {transform_path}")
    print(f"🔗 Supabase URL: {supabase_url}")
    print(f"📤 데이터 로드 시작...")
    
    # 기존 데이터 확인 (중복 체크 + deleted 레코드 확인)
    print(f"\n🔍 기존 데이터 확인 중...")
    try:
        # 1. 모든 기존 레코드 조회 (youtube_link, restaurant_name, jibun_address, status)
        existing_result = supabase.table('evaluation_records').select(
            'youtube_link, restaurant_name, status'
        ).execute()
        
        # 2. deleted 상태인 youtube_link들을 별도로 저장
        deleted_youtube_links = {
            r['youtube_link'] for r in existing_result.data 
            if r.get('status') == 'deleted'
        }
        
        # 3. (youtube_link, restaurant_name) 조합으로 중복 체크용 Set 생성
        existing_keys = {
            f"{r['youtube_link']}|||{r['restaurant_name']}" 
            for r in existing_result.data
        }
        
        print(f"✅ 기존 데이터: {len(existing_keys)}개 레코드")
        print(f"🗑️ Deleted 상태: {len(deleted_youtube_links)}개 레코드 (재로드 제외)")
        
    except Exception as e:
        print(f"⚠️ 기존 데이터 조회 실패, 중복 체크 없이 진행: {e}")
        existing_keys = set()
        deleted_youtube_links = set()
    
    # 데이터 읽기 및 중복 필터링
    records = []
    skipped_count = 0
    deleted_skipped_count = 0
    with open(transform_path, 'r', encoding='utf-8') as f:
        for line_num, line in enumerate(f, 1):
            if not line.strip():
                continue
            
            try:
                record = json.loads(line)
            except json.JSONDecodeError as e:
                print(f"⚠️ 라인 {line_num}: JSON 파싱 실패 - {e}")
                continue
            
            # restaurant_name이 null인 경우 처리
            restaurant_name = record.get('restaurant_name')
            if not restaurant_name:
                # restaurant_info.name 사용 시도
                restaurant_info = record.get('restaurant_info', {})
                restaurant_name = restaurant_info.get('name') if restaurant_info else None
                
                # 그래도 없으면 기본값 사용
                if not restaurant_name:
                    restaurant_name = f"Unknown_{record['youtube_link'][-11:]}"  # YouTube ID 사용
                    print(f"⚠️ 라인 {line_num}: restaurant_name이 null -> '{restaurant_name}' 사용")
            
            # deleted 레코드 체크 (youtube_link만으로 판단)
            if record['youtube_link'] in deleted_youtube_links:
                deleted_skipped_count += 1
                continue
            
            # 중복 체크 (youtube_link + restaurant_name 조합)
            key = f"{record['youtube_link']}|||{restaurant_name}"
            if key in existing_keys:
                skipped_count += 1
                continue
            
            # DB 스키마에 맞게 변환
            db_record = {
                'youtube_link': record['youtube_link'],
                'restaurant_name': restaurant_name,
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
                print(f"  읽는 중... {len(records)}개 (중복 스킵: {skipped_count}개, deleted 스킵: {deleted_skipped_count}개)")
    
    print(f"\n📊 총 {len(records) + skipped_count + deleted_skipped_count}개 레코드 읽기 완료")
    print(f"   - 삽입할 레코드: {len(records)}개")
    print(f"   - 중복으로 스킵: {skipped_count}개")
    print(f"   - Deleted 스킵: {deleted_skipped_count}개 (재로드 제외)")
    print(f"💾 데이터베이스에 삽입 중...")
    
    if len(records) == 0:
        print(f"⚠️ 삽입할 새로운 레코드가 없습니다. (모두 중복 또는 deleted)")
        return
    
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
    print(f"   - 읽은 레코드: {len(records) + skipped_count + deleted_skipped_count}개")
    print(f"   - 중복 스킵: {skipped_count}개")
    print(f"   - Deleted 스킵: {deleted_skipped_count}개")
    print(f"   - 삽입 시도: {len(records)}개")
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
    import os
    from pathlib import Path
    
    # 스크립트가 src/ 디렉토리에서 실행될 때 프로젝트 루트로 이동
    script_dir = Path(__file__).parent
    project_root = script_dir.parent
    main_root = project_root.parent.parent  # tzudong/tzudong/
    os.chdir(project_root)
    
    # .env 파일 로드 시도 (메인 프로젝트 루트에서)
    try:
        from dotenv import load_dotenv
        # 메인 프로젝트 루트의 .env
        load_dotenv(main_root / '.env')
        print("✅ .env 파일 로드 완료")
    except ImportError:
        print("⚠️ python-dotenv 패키지가 없습니다. 환경변수를 직접 설정하세요.")
    
    transform_file = sys.argv[1] if len(sys.argv) > 1 else "transform.jsonl"
    
    try:
        load_transform_to_db(transform_file)
    except Exception as e:
        print(f"❌ 오류 발생: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
