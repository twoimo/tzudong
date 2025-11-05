"""
Supabase에 evaluation_records 데이터를 배치로 로드하는 스크립트
SQL Editor의 크기 제한을 우회하기 위해 Python으로 직접 삽입
"""

import json
import os
from pathlib import Path
from dotenv import load_dotenv
from supabase import create_client, Client

# .env 파일 로드
env_path = Path(__file__).parent.parent.parent / '.env'
load_dotenv(env_path)

# Supabase 클라이언트 초기화 (SERVICE KEY 사용)
supabase_url = os.getenv('VITE_SUPABASE_URL')
# SERVICE KEY가 있으면 사용, 없으면 ANON KEY 사용
supabase_key = os.getenv('SUPABASE_SERVICE_KEY') or os.getenv('VITE_SUPABASE_PUBLISHABLE_KEY')

if not supabase_url or not supabase_key:
    raise ValueError("VITE_SUPABASE_URL과 SUPABASE_SERVICE_KEY (또는 VITE_SUPABASE_PUBLISHABLE_KEY)가 .env 파일에 설정되어 있어야 합니다.")

print(f"Supabase URL: {supabase_url}")
print(f"Using {'SERVICE' if 'SERVICE_KEY' in os.environ else 'ANON'} key")

supabase: Client = create_client(supabase_url, supabase_key)

def load_jsonl_records(file_path: str):
    """JSONL 파일에서 레코드 읽기"""
    records = []
    with open(file_path, 'r', encoding='utf-8') as f:
        for line in f:
            if line.strip():
                record = json.loads(line)
                # restaurant_name이 null인 경우 기본값 설정
                if not record.get('restaurant_name'):
                    # restaurant_info에서 이름 추출 시도
                    if record.get('restaurant_info') and record['restaurant_info'].get('name'):
                        record['restaurant_name'] = record['restaurant_info']['name']
                    else:
                        record['restaurant_name'] = '알 수 없음'
                records.append(record)
    return records

def get_existing_youtube_links():
    """이미 DB에 있는 youtube_link 조회"""
    try:
        result = supabase.table('evaluation_records').select('youtube_link').execute()
        existing_links = {record['youtube_link'] for record in result.data}
        print(f"📊 기존 DB에 {len(existing_links)}개 레코드 존재")
        return existing_links
    except Exception as e:
        print(f"⚠️  기존 데이터 조회 실패: {str(e)}")
        return set()

def insert_batch(records_batch, batch_num, total_batches, skip_count):
    """배치 단위로 레코드 삽입"""
    print(f"\n배치 {batch_num}/{total_batches} 삽입 중... ({len(records_batch)}개 레코드)")
    
    try:
        # RLS 정책 우회를 위해 service_role key 필요
        result = supabase.table('evaluation_records').insert(records_batch).execute()
        print(f"✅ 배치 {batch_num} 성공: {len(records_batch)}개 삽입됨 (총 {skip_count}개 건너뜀)")
        return len(records_batch), 0
    except Exception as e:
        error_str = str(e)
        
        # 중복 키 에러인 경우 개별 삽입 시도
        if "duplicate key" in error_str.lower():
            print(f"⚠️  배치 {batch_num} 중복 키 에러 - 개별 삽입 시도 중...")
            success = 0
            failed = 0
            
            for record in records_batch:
                try:
                    supabase.table('evaluation_records').insert(record).execute()
                    success += 1
                except Exception as individual_error:
                    if "duplicate key" in str(individual_error).lower():
                        # 중복은 조용히 건너뜀
                        pass
                    else:
                        print(f"  ❌ 레코드 실패: {record.get('youtube_link', 'unknown')}")
                        failed += 1
            
            print(f"✅ 배치 {batch_num} 개별 처리 완료: {success}개 성공, {failed}개 실패")
            return success, failed
        
        print(f"❌ 배치 {batch_num} 실패: {error_str}")
        
        # RLS 에러인 경우 안내
        if "row-level security" in error_str.lower():
            print("\n⚠️  RLS 정책 에러!")
            print("해결 방법:")
            print("1. Supabase Dashboard → SQL Editor에서 다음 실행:")
            print("   ALTER TABLE public.evaluation_records DISABLE ROW LEVEL SECURITY;")
            print("2. 이 스크립트 다시 실행")
            print("3. 데이터 로드 후 RLS 다시 활성화:")
            print("   ALTER TABLE public.evaluation_records ENABLE ROW LEVEL SECURITY;")
        
        return 0, len(records_batch)

def main():
    # transform.jsonl 파일 경로
    jsonl_file = Path(__file__).parent / 'transform.jsonl'
    
    if not jsonl_file.exists():
        print(f"❌ 파일을 찾을 수 없습니다: {jsonl_file}")
        return
    
    print(f"📂 파일 로드 중: {jsonl_file}")
    records = load_jsonl_records(str(jsonl_file))
    print(f"📊 총 {len(records)}개 레코드 발견")
    
    # 기존 데이터 조회
    existing_links = get_existing_youtube_links()
    
    # 중복 제거
    new_records = [r for r in records if r['youtube_link'] not in existing_links]
    skipped_count = len(records) - len(new_records)
    
    if skipped_count > 0:
        print(f"⏭️  {skipped_count}개 레코드는 이미 존재하므로 건너뜁니다")
    
    if len(new_records) == 0:
        print("\n✅ 모든 데이터가 이미 로드되어 있습니다!")
        return
    
    print(f"🆕 {len(new_records)}개 새로운 레코드를 삽입합니다")
    
    # 배치 크기 설정 (한 번에 50개씩)
    batch_size = 50
    total_batches = (len(new_records) + batch_size - 1) // batch_size
    
    print(f"\n🚀 {total_batches}개 배치로 나눠서 삽입 시작...")
    
    success_count = 0
    fail_count = 0
    
    for i in range(0, len(new_records), batch_size):
        batch = new_records[i:i + batch_size]
        batch_num = (i // batch_size) + 1
        
        success, failed = insert_batch(batch, batch_num, total_batches, skipped_count)
        success_count += success
        fail_count += failed
        
        # 첫 번째 배치가 RLS 에러로 완전 실패한 경우만 중단
        if batch_num == 1 and failed > 0 and success == 0:
            print("\n❌ 첫 번째 배치 실패로 중단합니다.")
            print("RLS를 비활성화했는지 확인해주세요!")
            break
    
    print("\n" + "="*60)
    print(f"✅ 성공: {success_count}개")
    print(f"⏭️  건너뜀: {skipped_count}개 (이미 존재)")
    print(f"❌ 실패: {fail_count}개")
    print("="*60)
    
    if success_count > 0:
        print("\n데이터 확인:")
        print("SELECT status, COUNT(*) FROM evaluation_records GROUP BY status;")
        
        try:
            result = supabase.table('evaluation_records').select('status', count='exact').execute()
            total = len(result.data)
            print(f"\n현재 총 레코드 수: {total}개")
        except:
            pass

if __name__ == "__main__":
    main()
