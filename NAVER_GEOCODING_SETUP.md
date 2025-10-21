# 네이버 클라우드 Geocoding API 설정 가이드

## 📋 개요

주소를 좌표(위도/경도)로 변환하는 Geocoding 기능을 위해 네이버 클라우드 플랫폼의 Geocoding API를 사용합니다.

## 🔑 API 키 발급 방법

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
   - ✅ **Maps** 체크 (지도 표시용)
5. **Web 서비스 URL** 등록
   - 개발: `http://localhost:8081`
   - 배포: `https://your-domain.com`
6. **등록** 클릭

### 4단계: 인증 정보 확인

1. 등록한 Application 클릭
2. **인증 정보** 탭에서 확인:
   - **Client ID** (X-NCP-APIGW-API-KEY-ID)
   - **Client Secret** (X-NCP-APIGW-API-KEY)

## ⚙️ 환경 변수 설정

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

## 🔧 API 사용 방법

### CORS 해결 - Vite 프록시 사용

클라이언트에서 직접 API를 호출하면 CORS 에러가 발생합니다. 
**Vite 프록시**를 통해 우회합니다.

### 요청 형식 (자동 프록시 처리)

```typescript
// 클라이언트에서는 프록시 경로로 요청
const response = await fetch(
  `/api/naver-geocode?query=${encodeURIComponent(address)}`
);

// Vite가 자동으로 다음 URL로 프록시:
// https://naveropenapi.apigw.ntruss.com/map-geocode/v2/geocode?query=...
// + API 키 헤더 자동 추가
```

### Vite 프록시 설정 (vite.config.ts)

```typescript
proxy: {
  '/api/naver-geocode': {
    target: 'https://naveropenapi.apigw.ntruss.com',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api\/naver-geocode/, '/map-geocode/v2/geocode'),
    configure: (proxy, options) => {
      proxy.on('proxyReq', (proxyReq, req, res) => {
        // 환경 변수에서 API 키 읽어서 헤더 추가
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

### 응답 형식

```json
{
  "status": "OK",
  "addresses": [
    {
      "roadAddress": "경기도 성남시 분당구 불정로 6",
      "jibunAddress": "경기도 성남시 분당구 정자동 178-1",
      "x": "127.1054328",  // 경도
      "y": "37.3595963",   // 위도
      "distance": 0.0
    }
  ]
}
```

## 📊 사용량 및 요금

- **무료 사용량**: 월 100,000건
- **초과 요금**: 건당 약 0.5원
- **모니터링**: 콘솔 → **이용 현황** 에서 확인 가능

## 🔒 보안 주의사항

⚠️ **중요**: 현재는 클라이언트에서 직접 API를 호출하고 있어 API 키가 노출될 수 있습니다.

### 권장 사항 (프로덕션 환경)

1. **Supabase Edge Function** 또는 **백엔드 API**로 프록시 구현
2. 클라이언트 → 백엔드 → 네이버 API 구조로 변경
3. API 키를 서버 측에서만 관리

### 임시 보안 조치

1. **Web 서비스 URL 제한** 설정 (네이버 클라우드 콘솔에서)
2. 허용된 도메인만 API 호출 가능하도록 제한

## 🧪 테스트

### 테스트 주소
```
서울특별시 강남구 테헤란로 152
```

### 예상 결과
```json
{
  "x": "127.0363925",  // 경도
  "y": "37.5055967"    // 위도
}
```

## 📚 참고 문서

- [네이버 클라우드 Geocoding API 문서](https://api.ncloud-docs.com/docs/ko/application-maps-geocoding)
- [네이버 클라우드 플랫폼](https://www.ncloud.com/)
- [Maps API 가격 정책](https://www.ncloud.com/product/applicationService/maps)

## ✅ 설정 확인 체크리스트

- [ ] 네이버 클라우드 플랫폼 가입
- [ ] Maps API 서비스 신청
- [ ] Application 등록 (Geocoding 포함)
- [ ] Client ID, Client Secret 발급
- [ ] `.env.local` 파일에 환경 변수 추가
- [ ] Web 서비스 URL 등록 (localhost + 배포 도메인)
- [ ] 웹사이트에서 "주소로 좌표 자동 입력" 테스트

## 🐛 문제 해결

### "Geocoding API 키가 설정되지 않았습니다" 에러

1. `.env.local` 파일 확인
2. 환경 변수 이름 확인 (VITE_ 접두사 필수)
3. 개발 서버 재시작 (`npm run dev`)

### CORS 에러

1. 네이버 클라우드 콘솔에서 Web 서비스 URL 확인
2. 현재 도메인이 등록되어 있는지 확인
3. `http://localhost:8081` 추가

### "주소에서 좌표를 찾을 수 없습니다" 에러

1. 주소를 더 자세히 입력 (도로명 주소 권장)
2. "시/도 + 구/군 + 도로명 + 건물번호" 형식 사용
3. 예: "서울특별시 강남구 테헤란로 152"

