# 네이버 지도 Geocoding API 설정 가이드

이 문서는 **제보 관리 페이지**에서 "주소로 좌표 자동 입력" 기능을 사용하기 위한 설정 방법을 안내합니다.

---

## 📌 현재 구성

### ✅ 외부 프록시 서버 사용 (권장)

**엔드포인트**: `http://www.moamodu.com/develop/naver_map_new_proxy.php`

#### 장점
- ✅ **API 키 설정 불필요** - 즉시 사용 가능
- ✅ **CORS 문제 없음** - 서버사이드에서 처리
- ✅ **보안 강화** - 클라이언트에 API 키 노출 위험 없음
- ✅ **관리 편의성** - 별도 환경 변수 설정 불필요

---

## 🔧 API 사용 방법

### 요청 형식

```typescript
const response = await fetch(
  `http://www.moamodu.com/develop/naver_map_new_proxy.php?query=${encodeURIComponent(address)}`
);
```

### 응답 형식

```json
{
  "status": "OK",
  "meta": {
    "totalCount": 1,
    "page": 1,
    "count": 1
  },
  "addresses": [
    {
      "roadAddress": "경기도 포천시 선마로 7",
      "jibunAddress": "경기도 포천시 선단동 56-7",
      "englishAddress": "7, Seonma-ro, Pocheon-si, Gyeonggi-do, Republic of Korea",
      "x": "127.1673391",  // 경도 (longitude)
      "y": "37.8538400",   // 위도 (latitude)
      "distance": 0.0
    }
  ],
  "errorMessage": ""
}
```

### 응답 데이터 파싱

```typescript
const geocodeAddress = async (address: string) => {
    try {
        const response = await fetch(
            `http://www.moamodu.com/develop/naver_map_new_proxy.php?query=${encodeURIComponent(address)}`
        );

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        if (data.status === 'OK' && data.addresses && data.addresses.length > 0) {
            const item = data.addresses[0];
            const lat = item.y; // 위도
            const lng = item.x; // 경도

            console.log('위도:', lat);
            console.log('경도:', lng);
        } else {
            console.error('주소를 찾을 수 없습니다');
        }
    } catch (error) {
        console.error('Geocoding error:', error);
    }
};
```

---

## 🎯 사용 예시

### 테스트용 주소

```
경기도 포천시 선마로 7
서울특별시 강남구 테헤란로 427
경기도 성남시 분당구 판교역로 152
부산광역시 해운대구 해운대해변로 264
```

### 예상 결과

```
주소: 경기도 포천시 선마로 7
위도: 37.8538400
경도: 127.1673391
```

---

## 🛠️ 대안: 직접 네이버 클라우드 API 사용

외부 프록시 서버를 사용하지 않고 직접 네이버 클라우드 플랫폼 API를 사용하려면:

### 1단계: 네이버 클라우드 플랫폼 가입

1. [네이버 클라우드 플랫폼](https://www.ncloud.com/) 접속
2. **회원가입** (무료)
3. **콘솔** 로그인

### 2단계: Maps API 신청

1. 콘솔에서 **Services** → **Application Service** → **Maps** 선택
2. **이용 신청하기** 클릭
3. 약관 동의 후 신청 완료

### 3단계: Application 등록

1. **AI·NAVER API** → **Application 관리** 선택
2. **Application 등록** 클릭
3. Application 이름 입력 (예: "Tzudong Map")
4. **Maps** 서비스 선택
   - ✅ **Geocoding** 체크
5. **Web 서비스 URL** 등록
   - 개발: `http://localhost:8080`
   - 운영: `https://your-domain.com`

### 4단계: API 키 확인

1. 등록한 Application 클릭
2. **인증 정보** 탭에서 확인:
   - **Client ID** (X-NCP-APIGW-API-KEY-ID)
   - **Client Secret** (X-NCP-APIGW-API-KEY)

### 5단계: 환경 변수 설정

프로젝트 루트에 `.env.local` 파일 생성:

```bash
# 네이버 클라우드 플랫폼 - Geocoding API
VITE_NAVER_CLIENT_ID=your_client_id_here
VITE_NAVER_CLIENT_SECRET=your_client_secret_here
```

**⚠️ 중요**: 환경 변수 추가 후 **반드시 개발 서버 재시작!**

```bash
# 기존 서버 중지 (Ctrl+C)
# 다시 시작
npm run dev
```

### 6단계: Vite 프록시 설정 (CORS 해결)

`vite.config.ts`:

```typescript
proxy: {
  '/api/naver-geocode': {
    target: 'https://naveropenapi.apigw.ntruss.com',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api\/naver-geocode/, '/map-geocode/v2/geocode'),
    configure: (proxy, options) => {
      proxy.on('proxyReq', (proxyReq, req, res) => {
        const apiKeyId = process.env.VITE_NAVER_CLIENT_ID;
        const apiKey = process.env.VITE_NAVER_CLIENT_SECRET;
        if (apiKeyId && apiKey) {
          proxyReq.setHeader('X-NCP-APIGW-API-KEY-ID', apiKeyId);
          proxyReq.setHeader('X-NCP-APIGW-API-KEY', apiKey);
        }
      });
    },
  },
}
```

### 7단계: API 호출 코드 변경

```typescript
// 프록시 경로로 요청
const response = await fetch(
  `/api/naver-geocode?query=${encodeURIComponent(address)}`
);
```

---

## 📊 비용 안내

### 무료 사용량

- **월 300,000건** 무료
- 초과 시: 건당 0.5원 (VAT 별도)

### 참고 링크

- [네이버 클라우드 플랫폼 요금 안내](https://www.ncloud.com/product/applicationService/maps)
- [Geocoding API 문서](https://api.ncloud-docs.com/docs/ai-naver-mapsgeocoding)

---

## 🐛 문제 해결

### "Failed to fetch" 에러

**현재 구성 (외부 프록시):**
- 프록시 서버가 정상 작동하는지 확인
- 주소 형식이 올바른지 확인

**직접 API 사용 시:**
1. 개발 서버 재시작 확인
2. 환경 변수 `.env.local` 파일 위치 확인
3. API 키 형식 확인 (따옴표 없이)
4. 웹 서비스 URL 등록 확인

### 좌표를 찾을 수 없음

- 더 자세한 주소 입력 (도로명 주소 권장)
- 예: ❌ "서울 강남" → ✅ "서울특별시 강남구 테헤란로 427"

---

## ✅ 체크리스트

### 현재 구성 (외부 프록시)

- [x] 프록시 서버 엔드포인트 설정 완료
- [x] API 호출 코드 구현 완료
- [x] 즉시 사용 가능 ✨

### 직접 API 사용 시

- [ ] 네이버 클라우드 플랫폼 가입
- [ ] Maps API 신청
- [ ] Application 등록 및 API 키 발급
- [ ] 환경 변수 설정 (`.env.local`)
- [ ] Vite 프록시 설정
- [ ] 개발 서버 재시작
- [ ] 테스트 완료

---

**🎉 현재는 외부 프록시 서버를 사용하므로 별도 설정 없이 바로 사용 가능합니다!**
