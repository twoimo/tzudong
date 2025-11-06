# Supabase Edge Function 배포 가이드

## naver-geocode Edge Function

이 Edge Function은 네이버 지오코딩 API를 프록시하여 CORS 문제를 해결합니다.

### 1. Supabase CLI 설치

```bash
# macOS (Homebrew)
brew install supabase/tap/supabase

# 또는 npm
npm install -g supabase
```

### 2. Supabase 로그인

```bash
supabase login
```

### 3. 프로젝트 연결

```bash
# 프로젝트 루트에서 실행
supabase link --project-ref <YOUR_PROJECT_REF>
```

프로젝트 참조는 Supabase Dashboard의 Settings > General > Reference ID에서 확인할 수 있습니다.

### 4. 환경 변수 설정

Edge Function에서 사용할 네이버 API 키를 Supabase Secrets에 저장합니다:

```bash
# 네이버 NCP Maps API 키 설정
supabase secrets set NAVER_NCP_MAPS_KEY_ID=aguxcq5ej5
supabase secrets set NAVER_NCP_MAPS_KEY=zl0Qwez2HrNIbFekqRQkgCwh12am5J6k64e19t2e
```

### 5. Edge Function 배포

```bash
# naver-geocode 함수 배포
supabase functions deploy naver-geocode
```

### 6. 배포 확인

배포가 완료되면 다음과 같은 URL로 접근할 수 있습니다:

```
https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/naver-geocode
```

### 7. 테스트

```bash
curl -X POST 'https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/naver-geocode' \
  -H "Authorization: Bearer <YOUR_ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"address":"서울특별시 양천구 신월동 55-2"}'
```

### 문제 해결

**에러: "supabase: command not found"**
- Supabase CLI가 설치되지 않았습니다. 위의 설치 단계를 따르세요.

**에러: "Function secrets not found"**
- 환경 변수가 설정되지 않았습니다. 4단계의 secrets 설정을 확인하세요.

**에러: "Invalid API credentials"**
- 네이버 API 키가 올바르지 않습니다. .env 파일의 키를 확인하세요.

### 로컬 테스트

배포 전에 로컬에서 테스트할 수 있습니다:

```bash
# Supabase 로컬 환경 시작
supabase start

# Edge Function 로컬 실행
supabase functions serve naver-geocode --env-file .env

# 다른 터미널에서 테스트
curl -X POST 'http://localhost:54321/functions/v1/naver-geocode' \
  -H "Content-Type: application/json" \
  -d '{"address":"서울특별시 양천구 신월동 55-2"}'
```

### 추가 정보

- Edge Functions 문서: https://supabase.com/docs/guides/functions
- Supabase CLI 문서: https://supabase.com/docs/guides/cli
