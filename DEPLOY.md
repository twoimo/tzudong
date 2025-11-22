# Vercel 배포 가이드

이 프로젝트는 Frontend와 Backend가 분리되어 있으며, Frontend는 Vercel을 통해 배포됩니다.

## Vercel 프로젝트 설정 (필수)

프로젝트 구조가 변경되었으므로(`frontend` 폴더로 이동), Vercel 대시보드에서 다음 설정을 반드시 변경해야 합니다.

1. Vercel 대시보드에서 해당 프로젝트로 이동합니다.
2. **Settings** > **General** 탭으로 이동합니다.
3. **Root Directory** 섹션을 찾습니다.
4. **Edit** 버튼을 클릭하고 `frontend`를 입력하여 저장합니다.

## Build & Development Settings

Root Directory를 `frontend`로 설정하면, Vercel이 자동으로 Vite 프로젝트임을 감지하고 다음 설정을 기본값으로 제안할 것입니다. 만약 그렇지 않다면 수동으로 설정해 주세요.

- **Framework Preset**: Vite
- **Build Command**: `npm run build` (또는 `vite build`)
- **Output Directory**: `dist`
- **Install Command**: `npm install` (또는 `bun install`)

## 환경 변수 (Environment Variables)

**Settings** > **Environment Variables** 메뉴에서 다음 환경 변수들을 설정해야 합니다. (`.env` 파일 내용 참조)

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_GOOGLE_MAPS_API_KEY`
- `VITE_NAVER_MAPS_CLIENT_ID`

## 배포 확인

설정 변경 후, `main` 브랜치에 새로운 커밋이 푸시되거나 PR이 병합되면 자동으로 배포가 시작됩니다.
**Deployments** 탭에서 배포 로그를 확인하여 성공 여부를 점검하세요.
