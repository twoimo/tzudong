# 맛집 지도 프론트엔드 개발 계획

## 개요
백엔드 크롤러(정육왕 유튜브 채널)로 수집한 맛집 데이터를 인사이트 페이지의 "맛집 지도" 탭에 표시합니다.

## ✅ 완료됨

> [!NOTE]
> 모든 수정 사항이 적용되었습니다. Supabase에 108개의 정육왕 맛집 데이터가 존재합니다.

---

## 변경 내역

### Frontend

#### [MODIFY] [use-youtuber-restaurants.ts](file:///home/ubuntu/tzudong/apps/web/hooks/use-youtuber-restaurants.ts)
- ✅ 테이블명 `youtuber_restaurant` → `restaurant_youtuber`로 변경 (93행, 156행)

#### [MODIFY] [MapSection.tsx](file:///home/ubuntu/tzudong/apps/web/components/insight/MapSection.tsx)
- ✅ `USE_MOCK_DATA` 플래그를 `false`로 변경 (116행)

---

### Backend

#### [MODIFY] [insert-to-supabase.js](file:///home/ubuntu/tzudong/backend/geminiCLI-youtuber-crawler/scripts/insert-to-supabase.js)
- ✅ 주석 및 에러 메시지에서 테이블명 표기 통일 (`restaurant_youtuber`)

---

## Verification

### 데이터 확인
- **테이블**: `restaurant_youtuber`
- **레코드 수**: 108개
- **유튜버**: 정육왕

### 수동 검증 방법

1. **인사이트 페이지 접속**
   - URL: `http://localhost:3000/admin/insight`
   - "맛집 지도" 탭 클릭

2. **확인 항목**
   - [ ] 지도에 마커가 표시되는지
   - [ ] 맛집 목록에 정육왕 데이터가 표시되는지
   - [ ] 목록에서 맛집 클릭 시 우측 패널 표시
   - [ ] 지도 마커 클릭 시 우측 패널 표시
