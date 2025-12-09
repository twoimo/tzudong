# Supabase Database Backup & Restore

## 연결 정보

- **Host**: `aws-1-ap-southeast-1.pooler.supabase.com`
- **Port**: `5432`
- **User**: `postgres.aqlcofblfxdrjhhdmarw`
- **Database**: `postgres`
- **Password**: `[YOUR_PASSWORD]` (Dashboard → Project Settings → Database에서 확인)

---

## Windows (PowerShell)

### 사전 준비

```powershell
# Scoop 설치 (처음 한 번만)
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
irm get.scoop.sh | iex

# PostgreSQL 클라이언트 설치
scoop install postgresql
```

### 백업

```powershell
$timestamp = Get-Date -Format "yyyy-MM-dd_HHmmss"
$env:PGPASSWORD = '[YOUR_PASSWORD]'
pg_dump -h aws-1-ap-southeast-1.pooler.supabase.com -p 5432 -U postgres.aqlcofblfxdrjhhdmarw -d postgres -f "supabase\backup-db\backup_$timestamp.sql"
```

### 복구

```powershell
$env:PGPASSWORD = '[YOUR_PASSWORD]'
psql -h aws-1-ap-southeast-1.pooler.supabase.com -p 5432 -U postgres.aqlcofblfxdrjhhdmarw -d postgres -f "supabase\backup-db\backup_YYYY-MM-DD_HHMMSS.sql"
```

### 전체 초기화 후 복구 (주의: 모든 데이터 삭제!)

```powershell
$env:PGPASSWORD = '[YOUR_PASSWORD]'

# 스키마 삭제
psql -h aws-1-ap-southeast-1.pooler.supabase.com -p 5432 -U postgres.aqlcofblfxdrjhhdmarw -d postgres -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

# 백업 복구
psql -h aws-1-ap-southeast-1.pooler.supabase.com -p 5432 -U postgres.aqlcofblfxdrjhhdmarw -d postgres -f "supabase\backup-db\backup_YYYY-MM-DD_HHMMSS.sql"
```

---

## macOS / Linux (Terminal)

### 사전 준비

```bash
# Homebrew로 PostgreSQL 설치
brew install postgresql
```

### 백업

```bash
timestamp=$(date +"%Y-%m-%d_%H%M%S")
PGPASSWORD='[YOUR_PASSWORD]' pg_dump -h aws-1-ap-southeast-1.pooler.supabase.com -p 5432 -U postgres.aqlcofblfxdrjhhdmarw -d postgres -f "supabase/backup-db/backup_$timestamp.sql"
```

### 복구

```bash
PGPASSWORD='[YOUR_PASSWORD]' psql -h aws-1-ap-southeast-1.pooler.supabase.com -p 5432 -U postgres.aqlcofblfxdrjhhdmarw -d postgres -f "supabase/backup-db/backup_YYYY-MM-DD_HHMMSS.sql"
```

### 전체 초기화 후 복구 (주의: 모든 데이터 삭제!)

```bash
PGPASSWORD='[YOUR_PASSWORD]' psql -h aws-1-ap-southeast-1.pooler.supabase.com -p 5432 -U postgres.aqlcofblfxdrjhhdmarw -d postgres -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

PGPASSWORD='[YOUR_PASSWORD]' psql -h aws-1-ap-southeast-1.pooler.supabase.com -p 5432 -U postgres.aqlcofblfxdrjhhdmarw -d postgres -f "supabase/backup-db/backup_YYYY-MM-DD_HHMMSS.sql"
```

---

## 참고사항

- **Session Pooler** 사용 (IPv4 호환)
- Direct Connection은 IPv6만 지원하므로 일반 네트워크에서 연결 불가
- 백업 파일은 `supabase/backup-db/` 폴더에 저장됨
- 비밀번호는 Supabase Dashboard → Project Settings → Database에서 확인/재설정 가능
