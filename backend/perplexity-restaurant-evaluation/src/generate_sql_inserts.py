"""
transform.jsonl을 SQL INSERT 문으로 변환
Supabase SQL Editor에서 직접 실행 가능
"""

import json
from pathlib import Path


def json_escape(value):
    """JSON 값을 PostgreSQL에 안전하게 삽입하기 위해 이스케이프"""
    if value is None:
        return 'NULL'
    if isinstance(value, bool):
        return 'true' if value else 'false'
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, (dict, list)):
        json_str = json.dumps(value, ensure_ascii=False)
        escaped = json_str.replace("'", "''")
        return f"'{escaped}'"
    # 문자열
    escaped = str(value).replace("'", "''")
    return f"'{escaped}'"


def generate_sql_inserts(
    transform_file: str = "../transform.jsonl",
    output_file: str = "../load_evaluation_records.sql",
    batch_size: int = 50
):
    """
    transform.jsonl을 SQL INSERT 문으로 변환
    """
    transform_path = Path(transform_file)
    if not transform_path.exists():
        raise FileNotFoundError(f"파일을 찾을 수 없습니다: {transform_file}")
    
    print(f"📂 입력 파일: {transform_path}")
    print(f"📝 SQL 생성 시작...")
    
    records = []
    with open(transform_path, 'r', encoding='utf-8') as f:
        for line_num, line in enumerate(f, 1):
            if not line.strip():
                continue
            
            try:
                record = json.loads(line)
                records.append(record)
            except json.JSONDecodeError as e:
                print(f"⚠️ 라인 {line_num}: JSON 파싱 실패 - {e}")
                continue
    
    print(f"📊 총 {len(records)}개 레코드 읽기 완료")
    print(f"💾 SQL 생성 중...")
    
    output_path = Path(output_file)
    with open(output_path, 'w', encoding='utf-8') as f:
        # 헤더
        f.write("-- evaluation_records 테이블 데이터 로드\n")
        f.write("-- Supabase SQL Editor에서 실행하세요\n\n")
        f.write("-- 1. RLS 임시 비활성화\n")
        f.write("ALTER TABLE public.evaluation_records DISABLE ROW LEVEL SECURITY;\n\n")
        
        # INSERT 문 생성
        for i, record in enumerate(records):
            if i % batch_size == 0:
                if i > 0:
                    f.write(";\n\n")
                f.write(f"-- 배치 {i // batch_size + 1} ({i + 1}-{min(i + batch_size, len(records))})\n")
                f.write("INSERT INTO public.evaluation_records\n")
                f.write("  (youtube_link, restaurant_name, status, youtube_meta, evaluation_results, restaurant_info, geocoding_success, geocoding_fail_reason, db_conflict_info, missing_message)\n")
                f.write("VALUES\n")
            else:
                f.write(",\n")
            
            # 값 생성
            f.write("  (")
            f.write(json_escape(record['youtube_link']))
            f.write(", ")
            f.write(json_escape(record['restaurant_name']))
            f.write(", ")
            f.write(json_escape(record['status']))
            f.write(", ")
            f.write(json_escape(record.get('youtube_meta')))
            f.write("::jsonb, ")
            f.write(json_escape(record.get('evaluation_results')))
            f.write("::jsonb, ")
            f.write(json_escape(record.get('restaurant_info')))
            f.write("::jsonb, ")
            f.write(json_escape(record.get('geocoding_success', False)))
            f.write(", ")
            f.write(json_escape(record.get('geocoding_fail_reason')))
            f.write(", ")
            f.write(json_escape(record.get('db_conflict_info')))
            f.write("::jsonb, ")
            f.write(json_escape(record.get('missing_message')))
            f.write(")")
        
        f.write(";\n\n")
        
        # RLS 다시 활성화
        f.write("-- 2. RLS 다시 활성화\n")
        f.write("ALTER TABLE public.evaluation_records ENABLE ROW LEVEL SECURITY;\n\n")
        
        f.write("-- 완료!\n")
        f.write(f"-- 총 {len(records)}개 레코드 삽입됨\n")
    
    print(f"\n✅ SQL 파일 생성 완료!")
    print(f"📁 출력 파일: {output_path}")
    print(f"\n📋 다음 단계:")
    print(f"1. Supabase 대시보드 → SQL Editor")
    print(f"2. {output_path} 파일 내용 복사")
    print(f"3. SQL Editor에 붙여넣기")
    print(f"4. Run 버튼 클릭")


if __name__ == "__main__":
    import sys
    
    transform_file = sys.argv[1] if len(sys.argv) > 1 else "../transform.jsonl"
    output_file = sys.argv[2] if len(sys.argv) > 2 else "../load_evaluation_records.sql"
    
    try:
        generate_sql_inserts(transform_file, output_file)
    except Exception as e:
        print(f"❌ 오류 발생: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
