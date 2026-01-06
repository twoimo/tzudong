# 🚀 OCI 서버 배포 및 자동화 가이드 (Gemini CLI 크롤러)

이 문서는 OCI(오라클 클라우드), AWS 등 리눅스 헤드리스 서버(화면 없는 서버)에 `geminicli-youtuber-crawler`를 배포하고, **매일 오전 6시에 자동으로 실행**하는 방법을 설명합니다.

**✅ 핵심:** 이 가이드의 자동화 설정(Cron)은 **서버가 재부팅되어도 계속 유지**되므로 별도의 복구 작업이 필요 없습니다.

## 1. 필수 준비 사항 (초기 세팅)

SSH로 서버에 접속한 상태에서 진행합니다.

```bash
# 1. 시스템 업데이트
sudo apt update && sudo apt upgrade -y

# 2. Git 설치
sudo apt install git -y

# 3. Bun 설치 (JavaScript 런타임)
curl -fsSL https://bun.sh/install | bash
# (설치 후 터미널 안내에 따라 프로필 로드)
source ~/.bashrc

# 4. Gemini CLI 전역 설치
npm install -g @google/gemini-cli
# 설치 확인
gemini --version
```

## 2. 프로젝트 설치

```bash
# 1. 저장소 클론
git clone <레포지토리_주소_입력>
cd geminicli-youtuber-crawler

# 2. 의존성 패키지 설치
bun install
```

## 3. 🔑 인증 (가장 중요!)

서버에는 브라우저가 없으므로 로컬 PC의 인증 파일을 서버로 옮겨야 합니다.

1.  **서버**: 토큰 저장 폴더 생성
    ```bash
    mkdir -p ~/.gemini
    ```

2.  **로컬 PC (윈도우)**:
    `oauth_creds.json` 파일을 서버로 전송합니다.
    *   **내 컴퓨터**: `C:\Users\<사용자명>\.gemini\oauth_creds.json`
    *   **서버**: `/home/ubuntu/.gemini/oauth_creds.json` (사용자명 주의: ubuntu 또는 opc)

    > **팁**: WinSCP 또는 `scp` 명령어 사용.

## 4. 환경 변수 설정

```bash
# .env 파일 생성
nano .env

# 내용 붙여넣기 (로컬 .env 내용 복사)
# NAVER_CLIENT_ID=...
# KAKAO_REST_API_KEY=...
```

## 5. 🚀 수동 실행 (테스트)

자동화 설정 전, 수동으로 잘 돌아가는지 확인합니다.

```bash
DEBUG=true bun run full
```

## 6. ⏰ 자동 실행 예약 (Cron) - 매일 오전 6시

서버가 꺼지지 않는 한 매일 설정된 시간에 실행되도록 `cron` 작업을 등록합니다.

1.  **Crontab 편집기 열기**
    ```bash
    crontab -e
    ```

2.  **스케줄 추가 (맨 아랫줄에 추가)**
    *   `bun`의 경로를 절대 경로로 적어주는 것이 안전합니다. (`which bun`으로 확인 가능, 보통 `/home/ubuntu/.bun/bin/bun`)

    ```bash
    # 매일 오전 6시에 실행 (로그는 crawler.log에 누적 저장)
    0 6 * * * cd /home/ubuntu/geminicli-youtuber-crawler && DEBUG=true /home/ubuntu/.bun/bin/bun run full >> /home/ubuntu/geminicli-youtuber-crawler/crawler.log 2>&1

    # (옵션) 모델을 'gemini-3-pro-preview'로 고정하고 싶을 때:
    # 0 6 * * * cd /home/ubuntu/geminicli-youtuber-crawler && GEMINI_MODEL=gemini-3-pro-preview DEBUG=true /home/ubuntu/.bun/bin/bun run full >> /home/ubuntu/geminicli-youtuber-crawler/crawler.log 2>&1
    ```

    *   `0 6 * * *`: 매일 06시 00분에 실행
    *   `cd ...`: 프로젝트 폴더로 이동 후 실행
    *   `>> ...`: 로그 내용을 파일 끝에 계속 이어씀 (덮어쓰기 아님)
    *   `2>&1`: 에러 메시지도 로그 파일에 함께 저장

3.  **저장 및 종료**
    *   `nano` 에디터라면: `Ctrl+O` Enter -> `Ctrl+X`
    *   `vi` 에디터라면: `ESC` -> `:wq` Enter

4.  **등록 확인**
    ```bash
    crontab -l
    ```

## 7. 🔌 서버 재부팅 시 자동화 확인

**Cron**은 리눅스의 기본 서비스로, 서버가 재부팅되면 **자동으로 다시 시작**됩니다. 따라서 사용자가 별도로 재실행할 필요가 없습니다.

만약 재부팅 직후에도 확실하게 서비스가 살아있는지 확인하고 싶다면 아래 명령어를 사용하세요:

```bash
# cron 서비스 상태 확인 (active (running)이면 정상)
sudo service cron status

# (선택 사항) 재부팅 시 자동 실행 활성화 확인
sudo systemctl is-enabled cron
```

## 8. 📊 모니터링 및 관리

**실시간 로그 확인:**
```bash
tail -f crawler.log
```

**실행 중인 프로세스 확인:**
```bash
ps -ef | grep bun
```

## 9. 🛡️ IP 차단 방지 (Anti-Blocking)

> **⚠️ 중요**: OCI 등 클라우드 서버 IP는 외부 서비스에서 봇으로 의심받기 쉽습니다. 다음 사항을 준수하세요.

### 적용된 안전 조치 (코드 레벨)

| 스크립트 | 조치 | 세부 사항 |
|----------|------|-----------|
| `crawl-channel.js` | YouTube API 사용 | Puppeteer 대신 공식 API 사용 (안전) |
| `collect-transcripts.js` | User-Agent 랜덤화 | 5개 브라우저 UA 로테이션 |
| `collect-transcripts.js` | 요청 간격 3-5초 | 랜덤 딜레이 적용 |
| `collect-transcripts.js` | 동시 처리 2개 제한 | 병렬 크롤링 축소 |
| `enrich-coordinates.js` | API 요청 간격 0.5-1초 | Naver/Kakao 교차 검증 |

### 추가 권장 사항

1.  **매일 1회 실행만** (현재 Cron 설정 준수)
2.  **CAPTCHA 발생 시**: 24시간 대기 후 재시도
3.  **403 에러 반복 시**: 프록시/VPN 고려

### 차단 감지 및 대응

```bash
# 로그에서 차단/에러 패턴 검색
grep -E "(403|blocked|captcha|timeout)" crawler.log | tail -20

# 특정 날짜 로그만 확인
grep "$(date +%Y-%m-%d)" crawler.log | tail -50
```

### 차단 발생 시 복구 절차

1.  Cron 작업 임시 중지:
    ```bash
    crontab -e
    # 해당 라인 맨 앞에 # 추가하여 주석 처리
    ```
2.  24~48시간 대기
3.  수동 테스트 후 Cron 재활성화
