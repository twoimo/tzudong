# Supabase 데이터베이스 설정 가이드

## 🚀 빠른 시작

### 1️⃣ Supabase 대시보드 접속

[Supabase SQL Editor 열기](https://supabase.com/dashboard/project/fubnhgkdtabnkxfupchb/sql/new)

### 2️⃣ 마이그레이션 실행

다음 파일들을 **순서대로** SQL Editor에서 실행하세요:

#### ① 첫 번째 마이그레이션 (기본 테이블 생성)

파일: `supabase/migrations/20251021075749_b4d8f15f-eb9a-4fc7-bad3-1239f945810e.sql`

**실행 방법:**
1. 파일 내용 전체를 복사
2. SQL Editor에 붙여넣기
3. **RUN** 버튼 클릭
4. 성공 메시지 확인

#### ② 두 번째 마이그레이션 (추가 설정)

파일: `supabase/migrations/20251021075837_bbe705da-423c-44ba-811e-b1fcaaabdeb6.sql`

#### ③ 세 번째 마이그레이션 (헬퍼 함수)

파일: `supabase/migrations/20251021140000_add_helper_functions.sql`

#### ④ 네 번째 마이그레이션 (추가 컬럼)

파일: `supabase/migrations/20251021180000_add_missing_columns.sql`

---

## 📊 초기 데이터 입력

마이그레이션 완료 후 다음 SQL을 실행하여 샘플 데이터를 입력하세요:

### 샘플 맛집 데이터

```sql
-- 샘플 맛집 데이터 입력
INSERT INTO public.restaurants (
  name, address, phone, category, 
  youtube_link, tzuyang_review, 
  lat, lng, ai_rating, 
  visit_count, review_count,
  jjyang_visit_count, description
) VALUES
  -- 서울 강남 맛집
  ('강남 치킨집', '서울특별시 강남구 테헤란로 123', '02-1234-5678', '치킨',
   'https://youtube.com/watch?v=example1', '양념치킨이 정말 맛있어요!',
   37.4979, 127.0276, 9.2,
   150, 45, 3, '강남에서 가장 유명한 치킨집입니다.'),
  
  -- 명동 중식당
  ('명동 짜장면', '서울특별시 중구 명동길 56', '02-2222-3333', '중식',
   'https://youtube.com/watch?v=example2', '짜장면 면발이 쫄깃해요',
   37.5636, 126.9826, 8.7,
   200, 67, 2, '명동의 숨은 맛집, 짜장면이 일품입니다.'),
  
  -- 부산 돼지국밥
  ('부산 돼지국밥', '부산광역시 부산진구 중앙대로 789', '051-3333-4444', '한식',
   'https://youtube.com/watch?v=example3', '국물이 진하고 고기가 많아요',
   35.1528, 129.0598, 9.5,
   300, 89, 5, '부산 대표 돼지국밥 맛집'),
  
  -- 제주 흑돼지
  ('제주 흑돼지구이', '제주특별자치도 제주시 첨단로 321', '064-5555-6666', '고기',
   'https://youtube.com/watch?v=example4', '흑돼지 삼겹살이 최고예요',
   33.4996, 126.5312, 8.9,
   180, 52, 4, '제주 흑돼지 전문점'),
  
  -- 대전 성심당
  ('대전 빵집', '대전광역시 중구 대종로 480', '042-7777-8888', '카페·디저트',
   'https://youtube.com/watch?v=example5', '튀김소보로가 진짜 맛있어요',
   36.3273, 127.4260, 9.0,
   500, 120, 2, '대전의 명물 빵집'),
  
  -- 인천 차이나타운
  ('인천 짬뽕집', '인천광역시 중구 차이나타운로 44', '032-8888-9999', '중식',
   'https://youtube.com/watch?v=example6', '해물이 가득한 짬뽕',
   37.4747, 126.6177, 8.5,
   250, 78, 3, '인천 차이나타운 대표 맛집');
```

### 샘플 서버 비용 데이터

```sql
-- 샘플 서버 비용 데이터
INSERT INTO public.server_costs (item_name, monthly_cost, description) VALUES
  ('Supabase Database', 25.00, 'PostgreSQL 데이터베이스 호스팅'),
  ('Vercel Hosting', 20.00, '프론트엔드 호스팅'),
  ('Naver Cloud Maps API', 50.00, '네이버 지도 API 사용료'),
  ('Supabase Storage', 10.00, '이미지 파일 저장소'),
  ('Domain & SSL', 15.00, '도메인 및 SSL 인증서');
```

---

## ✅ 확인 방법

### 1. Table Editor에서 확인

[Table Editor 열기](https://supabase.com/dashboard/project/fubnhgkdtabnkxfupchb/editor)

다음 테이블들이 생성되어 있어야 합니다:
- ✅ `profiles` (프로필)
- ✅ `user_roles` (사용자 권한)
- ✅ `restaurants` (맛집)
- ✅ `reviews` (리뷰)
- ✅ `server_costs` (서버 비용)
- ✅ `user_stats` (사용자 통계)

### 2. 데이터 확인

`restaurants` 테이블에 6개의 샘플 데이터가 있는지 확인하세요!

---

## 🔐 Storage 설정 (리뷰 사진 업로드용)

### 1. Storage Bucket 생성

[Storage 설정 열기](https://supabase.com/dashboard/project/fubnhgkdtabnkxfupchb/storage/buckets)

1. **New bucket** 클릭
2. Bucket 이름: `review-photos`
3. **Public bucket** 체크 (✅)
4. **Create bucket** 클릭

### 2. Storage Policy 설정

Storage > `review-photos` > Policies에서 다음 정책 추가:

```sql
-- 모든 사용자가 사진 보기 가능
CREATE POLICY "Public Access"
ON storage.objects FOR SELECT
USING (bucket_id = 'review-photos');

-- 인증된 사용자만 업로드 가능
CREATE POLICY "Authenticated users can upload"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'review-photos');

-- 본인이 업로드한 사진만 삭제 가능
CREATE POLICY "Users can delete own photos"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'review-photos' AND auth.uid()::text = (storage.foldername(name))[1]);
```

---

## 🎯 다음 단계

1. ✅ 마이그레이션 실행 완료
2. ✅ 샘플 데이터 입력
3. ✅ Storage 설정
4. 🔄 브라우저에서 애플리케이션 새로고침
5. 🗺️ 지도에 맛집 마커 표시 확인!

---

## 🆘 문제 해결

### "Could not find the table" 에러

→ 마이그레이션이 제대로 실행되지 않았습니다. SQL Editor에서 다시 실행하세요.

### 데이터가 보이지 않음

→ Row Level Security (RLS) 때문일 수 있습니다. 
   일시적으로 RLS를 비활성화하려면:

```sql
ALTER TABLE public.restaurants DISABLE ROW LEVEL SECURITY;
```

### Storage 업로드 실패

→ Bucket이 Public으로 설정되어 있는지, Policy가 올바르게 설정되어 있는지 확인하세요.

