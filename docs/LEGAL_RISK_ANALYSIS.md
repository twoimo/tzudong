# ⚖️ Tzudong Map Legal Risk Analysis

본 문서는 `Tzudong Map` 프로젝트의 코드베이스, 데이터 흐름, 서드파티 통합을 기반으로 잠재적인 법적 리스크를 분석한 결과입니다.

## 🚨 Critical Risks (즉시 조치 필요)

### 1. 개인정보보호 (PII) - 영수증 인증
- **현황**: [ReviewModal.tsx](file:///c:/Users/twoimo/Desktop/tzudong/apps/web/components/reviews/ReviewModal.tsx)에서 사용자가 업로드한 영수증(`verification_photo`)을 `review-photos` 버킷에 저장하고, [ocr-receipts.js](file:///c:/Users/twoimo/Desktop/tzudong/backend/geminiCLI-ocr-receipts/ocr-receipts.js) 백엔드 스크립트에서 `getPublicUrl`을 통해 접근하여 Gemini API로 전송합니다.
- **리스크**:
    - **개인정보 유출**: 영수증에는 카드번호 일부, 승인번호, 정확한 결제 시간, 카드사 정보 등이 포함됩니다. `getPublicUrl`을 사용한다는 것은 해당 이미지가 퍼블릭 URL을 통해 접근 가능하다는 의미일 수 있습니다. 만약 이 URL이 노출되거나 버킷 권한이 `public`으로 설정되어 있다면 심각한 개인정보 유출 사고로 이어질 수 있습니다.
    - **제3자 제공**: OCR 처리를 위해 Gemini(Google)에 이미지를 전송합니다. 이는 개인정보의 '국외 이전' 및 '제3자 제공'에 해당하므로 개인정보 처리방침에 명시되어야 합니다.
- **권고 사항**:
    - `review-photos` 버킷을 **Private**으로 설정하고, OCR 서버 등 인가된 사용자만 **Signed URL**을 통해 접근하도록 변경하십시오.
    - 프론트엔드에서 다른 사용자가 타인의 영수증 사진을 절대 볼 수 없도록 하십시오.
    - 개인정보 처리방침에 "OCR 분석을 위한 제3자(Google) 제공" 및 "수집 항목(결제 정보 등)"을 명시하십시오.

---

## ⚠️ High Risks (높은 주의 필요)

### 2. YouTube API 데이터 저장 (ToS Compliance)
- **현황**: [use-restaurants.tsx](file:///c:/Users/twoimo/Desktop/tzudong/apps/web/hooks/use-restaurants.tsx), [db-conflict-checker.ts](file:///c:/Users/twoimo/Desktop/tzudong/apps/web/lib/db-conflict-checker.ts), `api/youtube-meta` 등을 통해 YouTube 비디오 ID뿐만 아니라 메타데이터(제목, 설명, 썸네일 등)를 `restaurants` 테이블의 `youtube_meta` 컬럼에 저장하고 있습니다.
- **리스크**:
    - **저장 기간 제한**: YouTube API Terms of Service (iii.e. Cache)에 따르면, API 데이터를 30일 이상 저장하는 것은 원칙적으로 금지됩니다(비디오 ID 제외). 설명을 영구 저장하는 것은 위반 소지가 있습니다.
    - **상표 표시**: YouTube 데이터를 표시할 때는 반드시 YouTube Branding Guidelines를 준수해야 합니다.
- **권고 사항**:
    - `youtube_meta` 데이터를 주기적으로(예: 30일마다) 최신 상태로 갱신하는 로직을 추가하십시오.
    - 가능하다면 DB에는 Video ID만 저장하고, 메타데이터는 클라이언트에서 실시간(또는 짧은 캐시)으로 가져오거나, 필요한 최소한의 정보만 갱신하며 유지하십시오.

### 3. 데이터베이스 권리 및 크롤링 (Database Rights)
- **현황**: [use-restaurants.tsx](file:///c:/Users/twoimo/Desktop/tzudong/apps/web/hooks/use-restaurants.tsx)의 병합 로직과 [ocr-receipts.js](file:///c:/Users/twoimo/Desktop/tzudong/backend/geminiCLI-ocr-receipts/ocr-receipts.js)의 `store_name` 매칭 로직을 보면, 기존 `restaurants` DB가 구축되어 있습니다. 이 데이터가 만약 네이버 플레이스 등을 대량으로 크롤링하여 구축된 것이라면 문제가 될 수 있습니다.
- **리스크**:
    - **부정경쟁방지법**: 타사의 데이터베이스를 무단으로 크롤링하여 상업적으로 경쟁 서비스를 만드는 것은 부정경쟁행위로 간주될 수 있습니다.
    - **약관 위반**: 네이버/카카오 등의 지도 서비스는 자동화된 수집 행위를 약관으로 금지합니다.
- **권고 사항**:
    - 맛집 데이터가 순수하게 '사용자 제보'와 '공식 API(검색)'를 통해서만 축적되도록 프로세스를 검증하십시오.
    - 대량 크롤링 스크립트(`scripts/` 폴더 내 등)가 있다면 사용을 중단하십시오.

---

## 📝 Medium Risks (관리 필요)

### 4. 사용자 생성 콘텐츠 (UGC) 저작권
- **현황**: 사용자가 [ReviewModal](file:///c:/Users/twoimo/Desktop/tzudong/apps/web/components/reviews/ReviewModal.tsx#73-804)을 통해 음식 사진(`food_photos`)을 업로드합니다.
- **리스크**:
    - **저작권 침해**: 사용자가 블로그나 다른 사람의 SNS에서 퍼온 사진을 업로드할 경우, 플랫폼도 방조 책임을 질 수 있습니다.
    - **이용 허락**: 사용자가 올린 사진을 `Tzudong Map`이 홍보 목적이나 다른 곳에 전시할 권리가 명시적으로 확보되지 않으면 나중에 문제가 될 수 있습니다.
- **권고 사항**:
    - **이용약관(Terms of Use)**에 "사용자가 업로드한 콘텐츠의 저작권은 사용자에게 있으나, 서비스 제공 및 홍보를 위해 회사가 전 세계적, 영구적, 무상으로 사용할 수 있는 라이선스를 허락한다"는 조항을 반드시 포함하십시오.
    - 타인의 저작권 침해 시 게시물이 삭제될 수 있음을 고지하십시오.

### 5. 지도 API 사용 가이드라인
- **현황**: [NaverMapView.tsx](file:///c:/Users/twoimo/Desktop/tzudong/apps/web/components/map/NaverMapView.tsx)를 사용 중입니다.
- **리스크**:
    - 지도 하단의 **Naver 로고**나 저작권 표시를 CSS로 가리거나 오버레이 요소로 덮으면 약관 위반입니다.
- **권고 사항**:
    - UI 디자인 시 지도 로고 영역(보통 우측 하단/좌측 하단)이 항상 보이도록 여백을 확보하십시오.

---

## ✅ Action Plan Suggestion

1.  **[즉시]** Supabase `review-photos` 버킷의 Public Access 권한 확인 및 Private 전환.
2.  **[즉시]** 개인정보 처리방침 및 서비스 이용약관 작성/검토.
3.  **[단기]** [ocr-receipts.js](file:///c:/Users/twoimo/Desktop/tzudong/backend/geminiCLI-ocr-receipts/ocr-receipts.js)가 `Signed URL`을 사용하도록 수정.
4.  **[중기]** YouTube 데이터 갱신 스케줄러(Cron Job) 구현.

이 분석은 법적 자문이 아니며, 실제 서비스 런칭 전에는 법률 전문가의 검토를 받는 것이 좋습니다.
