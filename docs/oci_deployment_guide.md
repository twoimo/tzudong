# 🚀 OCI 서버 배포 가이드

Oracle Cloud Infrastructure(OCI) Ampere A1 인스턴스에 유튜버 맛집 크롤러를 배포하는 가이드입니다.

---

## 📋 서버 사양

| 항목 | 권장 사양 |
|------|----------|
| CPU | 2 OCPU (ARM64) |
| RAM | 12GB |
| Storage | 50GB |
| OS | Ubuntu 22.04 |

> **Free Tier**: OCI Ampere A1은 Always Free로 4 OCPU / 24GB RAM까지 무료

---

## 1. 초기 환경 설정

```bash
# 시스템 업데이트
sudo apt update && sudo apt upgrade -y

# 필수 패키지 설치
sudo apt install -y git curl unzip

# Node.js 설치 (Gemini CLI용)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Bun 설치 (JavaScript 런타임)
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc

# Gemini CLI 설치
npm install -g @google/gemini-cli

# Chromium 설치 (Puppeteer용)
sudo apt install -y chromium-browser

# 설치 확인
bun --version
gemini --version
chromium-browser --version
```

---

## 2. 프로젝트 설치

```bash
# 프로젝트 디렉토리로 이동
cd ~/tzudong/backend/geminiCLI-youtuber-crawler

# 의존성 설치
bun install
```

---

## 3. 🔑 Gemini OAuth 인증 설정

서버에는 브라우저가 없으므로 **로컬 PC의 인증 파일을 서버로 복사**합니다.

### 3.1 로컬 PC에서 인증

```bash
# 로컬 PC에서 실행
gemini
# 브라우저에서 Google 계정 로그인
```

### 3.2 인증 파일 서버로 전송

**Linux/Mac:**
```bash
scp ~/.gemini/oauth_creds.json ubuntu@<서버IP>:~/.gemini/
```

**Windows (PowerShell):**
```powershell
scp $env:USERPROFILE\.gemini\oauth_creds.json ubuntu@<서버IP>:~/.gemini/
```

### 3.3 서버에서 확인

```bash
# 토큰 파일 확인
cat ~/.gemini/oauth_creds.json

# 프로젝트 디렉토리에도 심볼릭 링크 생성
ln -sf ~/.gemini ~/tzudong/backend/geminiCLI-youtuber-crawler/.gemini
```

---

## 4. 환경 변수 설정

```bash
cd ~/tzudong/backend/geminiCLI-youtuber-crawler
nano .env
```

필수 환경 변수:
```bash
# YouTube API
YOUTUBE_API_KEY=your_api_key

# Kakao (지오코딩)
KAKAO_REST_API_KEY=your_api_key

# Naver (선택)
NAVER_CLIENT_ID=your_client_id
NAVER_CLIENT_SECRET=your_client_secret

# Supabase
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Puppeteer (ARM64용)
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
```

---

## 5. 🧪 수동 테스트

```bash
cd ~/tzudong/backend/geminiCLI-youtuber-crawler

# 전체 파이프라인 테스트
DEBUG=true bun run full
```

---

## 6. ⏰ 자동 실행 설정 (Cron)

### 6.1 Crontab 편집

```bash
crontab -e
```

### 6.2 스케줄 추가

```bash
# 매일 오전 6시(KST) 실행
0 21 * * * cd /home/ubuntu/tzudong/backend/geminiCLI-youtuber-crawler && /home/ubuntu/.bun/bin/bun run full >> /home/ubuntu/tzudong/backend/geminiCLI-youtuber-crawler/crawler.log 2>&1

# (옵션) Pro 모델 강제 사용
# 0 21 * * * cd /home/ubuntu/tzudong/backend/geminiCLI-youtuber-crawler && GEMINI_MODEL=gemini-3-pro-preview /home/ubuntu/.bun/bin/bun run full >> crawler.log 2>&1
```

> **주의**: OCI 서버 시간은 UTC. KST 06:00 = UTC 21:00

### 6.3 등록 확인

```bash
crontab -l
```

---

## 7. 📊 모니터링

### 실시간 로그 확인

```bash
tail -f ~/tzudong/backend/geminiCLI-youtuber-crawler/crawler.log
```

### 프로세스 확인

```bash
ps -ef | grep bun
```

### 에러 로그 검색

```bash
# 에러 패턴 검색
grep -E "(ERR|WARN|error|failed)" crawler.log | tail -30

# 오늘 로그만
grep "$(date +%Y-%m-%d)" crawler.log | tail -50
```

---

## 8. 🛡️ 차단 방지 설정

### 적용된 안전 장치

| 영역 | 설정 |
|------|------|
| Puppeteer 동시성 | 2개 제한 |
| 요청 간격 | 1-3초 랜덤 딜레이 |
| User-Agent | 5개 로테이션 |
| Stealth 모드 | puppeteer-extra-plugin-stealth |
| 리소스 차단 | 이미지/폰트/미디어 비활성화 |

### 차단 감지

```bash
grep -E "(403|blocked|captcha|timeout)" crawler.log | tail -20
```

### 차단 시 대응

1. Cron 임시 중지:
   ```bash
   crontab -e
   # 해당 줄 앞에 # 추가
   ```
2. 24-48시간 대기
3. 수동 테스트 후 재활성화

---

## 9. 🔄 서버 재부팅 후 확인

Cron은 시스템 서비스로 **자동 재시작**됩니다.

```bash
# Cron 서비스 상태 확인
sudo service cron status

# 자동 시작 활성화 확인
sudo systemctl is-enabled cron
```

---

## 10. 유용한 명령어

```bash
# 강제 크롤링 (캐시 무시)
FORCE_CRAWL=true bun run full

# 특정 단계부터 시작
node scripts/pipeline.js --start-from=2

# 수동 개별 실행
bun run crawl       # 영상 수집
bun run transcripts # 자막 수집
bun run places      # 장소 정보 수집
bun run extract     # AI 분석
bun run geocode     # 좌표 보완
bun run insert      # DB 저장
```

---

## 🐛 트러블슈팅

### Chromium 실행 오류

```bash
# Chromium 경로 확인
which chromium-browser

# .env에 경로 설정
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
```

### OAuth 토큰 만료

```bash
# 로컬에서 재인증 후 서버로 복사
scp ~/.gemini/oauth_creds.json ubuntu@<서버IP>:~/.gemini/
```

### 메모리 부족

```bash
# 스왑 메모리 추가
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```
