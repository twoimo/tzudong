# Supabase CLI (Remote Only) 워크플로우

로컬 Supabase(`supabase start`) 없이, 원격 프로젝트의 “현재 DB 상태”를 확인/동기화하기 위한 절차입니다.

## 0) 전제

- Supabase CLI 설치 확인

```powershell
supabase --version
```

- 주의: `supabase gen types --db-url ...` 경로는 내부적으로 Docker를 사용합니다.
  - Docker Desktop이 없으면 타입 생성/일부 DB 명령이 실패할 수 있습니다.
  - 이 레포에서는 Docker 없이도 원격 DB 스키마를 확인할 수 있도록 `psql`/`pg_dump` 기반 대안을 함께 사용합니다.

- 프로젝트 ref 확인
  - `apps/web/.env.local`의 `NEXT_PUBLIC_SUPABASE_URL`에서 서브도메인(ref)을 사용합니다.
  - 예: `https://<project-ref>.supabase.co`

## 1) Access Token 설정

Supabase Dashboard에서 Access Token을 생성한 뒤(개인 계정 토큰), 아래 중 하나로 설정합니다.

### 옵션 A) 현재 PowerShell 세션에만 환경변수로 주입

```powershell
$env:SUPABASE_ACCESS_TOKEN = "<YOUR_TOKEN>"
```

### 옵션 B) CLI에 토큰 로그인(로컬에 저장됨)

```powershell
supabase login --token "<YOUR_TOKEN>"
```

참고:
- 이 repo의 `.env`/`.env.local`에는 `SUPABASE_ACCESS_TOKEN`이 기본으로 들어있지 않습니다.
- `SUPABASE_SERVICE_ROLE_KEY`는 DB/서버용 키이므로, CLI 로그인 토큰과는 별개입니다.

## 2) 타입 생성(권장)

웹앱이 참조하는 DB 스키마 타입을 원격 DB 기준으로 생성합니다.

```powershell
cd apps/web
npm run supabase:gen-types
```

- 출력 파일(기본): `apps/web/integrations/supabase/database.types.ts`
- `SUPABASE_PROJECT_ID`를 따로 지정하지 않으면 `NEXT_PUBLIC_SUPABASE_URL`에서 project-ref를 자동 추출합니다.
- Docker Desktop이 없는 환경에서는 이 단계가 실패할 수 있습니다. 그 경우 아래 **3) psql/pg_dump로 원격 스키마 스냅샷**을 우선 수행하세요.

## 3) (선택) 원격 스키마 Pull -> 마이그레이션 생성

원격 DB의 스키마를 repo의 `supabase/migrations`로 “스냅샷” 형태로 가져오려면 아래를 사용합니다.

```powershell
supabase db pull "remote_schema_$(Get-Date -Format yyyyMMdd)" --schema public,auth,storage
```

주의:
- 이 단계는 실제로 마이그레이션 파일을 생성/갱신하므로, “스키마를 코드로 관리”하려는 의도가 있을 때만 수행하는 것을 권장합니다.

## 3) psql/pg_dump로 원격 스키마 스냅샷 (Docker 없이)

원격 DB의 **현재 스키마(SSOT)** 를 파일로 남겨 두면, migrations/백업 덤프가 오래되었을 때도 정확하게 비교할 수 있습니다.

- 스키마-only 덤프 (public 스키마)
  - 출력 예시: `supabase/.temp/remote_public_schema.sql`

```powershell
# backend/.env에 있는 DB 접속 정보를 환경변수로 주입한 다음 실행하는 방식을 권장합니다.
# (값은 문서/로그에 남기지 마세요)

pg_dump --schema-only --schema public --no-owner --no-privileges `
  --host "<DB_HOST>" --port 5432 --username "<DB_USER>" --dbname postgres `
  > supabase/.temp/remote_public_schema.sql
```

- 테이블/컬럼 빠른 확인

```powershell
psql "host=<DB_HOST> port=5432 dbname=postgres user=<DB_USER> password=<DB_PASSWORD> sslmode=require" -c "\\dt public.*"
psql "host=<DB_HOST> port=5432 dbname=postgres user=<DB_USER> password=<DB_PASSWORD> sslmode=require" -c "\\d public.restaurants"
```

## 4) 다음 액션(권장 순서)

1. `database.types.ts`와 기존 `apps/web/integrations/supabase/types.ts`의 차이를 비교
2. `restaurants`, `videos`, `video_frame_captions`, `user_roles` 등 대시보드/인사이트 경로에서 쓰는 테이블부터 타입/쿼리 정합성 정리
3. Public API는 `anon key` 기반, Admin API는 `service role` 기반으로 키 사용을 분리(권한/노출 범위 분리)
