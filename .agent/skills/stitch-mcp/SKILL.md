---
name: stitch-mcp
description: Google Stitch MCP 서버 설정, 인증, 트러블슈팅 가이드. UI 디자인 생성 시 적용.
---

# Google Stitch MCP Skill

Stitch는 Google의 AI 기반 UI 디자인 생성 도구입니다. MCP(Model Context Protocol)를 통해 Antigravity에서 직접 UI 디자인을 생성할 수 있습니다.

## 사전 요구사항

1. Google Cloud 계정
2. Google Cloud SDK (gcloud CLI)
3. Google Cloud 프로젝트 (Billing 활성화 권장)

---

## 1. Google Cloud SDK 설치

### 설치 명령어

```bash
# Standalone 설치
curl https://sdk.cloud.google.com | bash

# 또는 비대화형 설치 (권장)
curl -sSL https://sdk.cloud.google.com > /tmp/install_gcloud.sh && \
bash /tmp/install_gcloud.sh --disable-prompts --install-dir=$HOME
```

### PATH 설정

```bash
echo 'source $HOME/google-cloud-sdk/path.bash.inc' >> ~/.bashrc
source $HOME/google-cloud-sdk/path.bash.inc
```

### 설치 확인

```bash
$HOME/google-cloud-sdk/bin/gcloud --version
```

---

## 2. Google Cloud 인증

### 사용자 로그인 (필수)

```bash
$HOME/google-cloud-sdk/bin/gcloud auth login
```

브라우저에서 Google 계정 인증 후 verification code 입력.

### Application Default Credentials (선택)

```bash
$HOME/google-cloud-sdk/bin/gcloud auth application-default login
```

> **⚠️ 주의**: scope 에러 발생 시:
> ```bash
> gcloud auth application-default login --scopes="https://www.googleapis.com/auth/cloud-platform"
> ```

---

## 3. 프로젝트 설정

### 프로젝트 목록 확인

```bash
$HOME/google-cloud-sdk/bin/gcloud projects list
```

### 프로젝트 설정

```bash
PROJECT_ID="your-project-id"
$HOME/google-cloud-sdk/bin/gcloud config set project "$PROJECT_ID"
```

---

## 4. Stitch API 활성화 (핵심!)

### Step 1: 기본 API 활성화

```bash
PROJECT_ID="your-project-id"
$HOME/google-cloud-sdk/bin/gcloud services enable stitch.googleapis.com --project="$PROJECT_ID"
```

### Step 2: Beta 컴포넌트 설치 (필요시)

```bash
$HOME/google-cloud-sdk/bin/gcloud components install beta
```

### Step 3: MCP 엔드포인트 활성화 (중요!)

```bash
$HOME/google-cloud-sdk/bin/gcloud beta services mcp enable stitch.googleapis.com --project="$PROJECT_ID"
```

> **⚠️ 이 단계를 놓치면 `Forbidden` 에러 발생!**

### Step 4: IAM 권한 부여

```bash
USER_EMAIL=$($HOME/google-cloud-sdk/bin/gcloud config get-value account)
$HOME/google-cloud-sdk/bin/gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="user:$USER_EMAIL" \
  --role="roles/serviceusage.serviceUsageConsumer" \
  --condition=None
```

---

## 5. 액세스 토큰 생성

```bash
TOKEN=$($HOME/google-cloud-sdk/bin/gcloud auth print-access-token)
echo $TOKEN
```

> **⚠️ 토큰 유효 시간: 약 1시간**
> 만료 시 위 명령어로 재생성 필요.

---

## 6. Antigravity MCP 설정

### 설정 파일 위치

```
~/.gemini/antigravity/mcp_config.json
```

### 설정 내용

```json
{
  "mcpServers": {
    "stitch": {
      "serverUrl": "https://stitch.googleapis.com/mcp",
      "headers": {
        "Authorization": "Bearer <YOUR_ACCESS_TOKEN>",
        "X-Goog-User-Project": "<YOUR_PROJECT_ID>"
      }
    }
  }
}
```

### 설정 업데이트 후

**Antigravity 재시작 필요!** (MCP 클라이언트가 새 토큰을 로드해야 함)

---

## 7. Stitch MCP 도구 사용법

### 제공되는 도구

| 도구 | 설명 |
|------|------|
| `create_project` | 새 Stitch 프로젝트 생성 |
| `list_projects` | 프로젝트 목록 조회 |
| `list_screens` | 프로젝트 내 화면 목록 |
| `get_screen` | 특정 화면 상세 정보 |
| `generate_screen_from_text` | 텍스트로 UI 디자인 생성 |

### 사용 예시

```
"Stitch로 로그인 페이지 디자인 만들어줘"
"대시보드 UI 생성해줘 - 다크 테마, 차트 포함"
```

### 지원 모델

- `GEMINI_3_PRO` (고품질)
- `GEMINI_3_FLASH` (빠른 생성)

### 지원 디바이스

- `DESKTOP`
- `MOBILE`
- `TABLET`

---

## 트러블슈팅

### 에러: `Unauthorized`

**원인**: 액세스 토큰 만료 또는 잘못된 토큰

**해결**:
1. 새 토큰 생성: `gcloud auth print-access-token`
2. `mcp_config.json`의 `Authorization` 헤더 업데이트
3. Antigravity 재시작

---

### 에러: `Forbidden`

**원인**: Stitch MCP 엔드포인트 미활성화

**해결**:
```bash
# MCP 엔드포인트 활성화 (중요!)
gcloud beta services mcp enable stitch.googleapis.com --project="YOUR_PROJECT_ID"
```

---

### 에러: `Stitch API has not been used in project`

**원인**: API 활성화 후 전파 대기 필요 또는 MCP 엔드포인트 미활성화

**해결**:
1. 몇 분 대기 후 재시도
2. `gcloud beta services mcp enable` 명령 실행

---

### 에러: `gcloud: command not found`

**원인**: PATH 설정 안됨

**해결**:
```bash
source $HOME/google-cloud-sdk/path.bash.inc
```

---

### MCP 설정 후에도 동작 안함

**확인 사항**:
1. Antigravity 재시작 했는지?
2. `mcp_config.json`의 JSON 문법 오류 없는지?
3. 토큰이 만료되지 않았는지?

---

## curl로 직접 API 테스트

MCP 연결 문제 시 curl로 직접 테스트:

### 연결 테스트

```bash
TOKEN=$(gcloud auth print-access-token)
curl -s -X POST "https://stitch.googleapis.com/mcp" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Goog-User-Project: YOUR_PROJECT_ID" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{}},"id":1}'
```

### 프로젝트 생성

```bash
curl -s -X POST "https://stitch.googleapis.com/mcp" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Goog-User-Project: YOUR_PROJECT_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "create_project",
      "arguments": {"title": "My Project"}
    },
    "id": 2
  }'
```

### 화면 생성

```bash
curl -s -X POST "https://stitch.googleapis.com/mcp" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Goog-User-Project: YOUR_PROJECT_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "generate_screen_from_text",
      "arguments": {
        "projectId": "YOUR_PROJECT_ID",
        "prompt": "Dark themed dashboard with charts",
        "deviceType": "DESKTOP",
        "modelId": "GEMINI_3_FLASH"
      }
    },
    "id": 3
  }'
```

---

## 토큰 자동 갱신 스크립트

`~/.agent/scripts/refresh-stitch-token.sh`:

```bash
#!/bin/bash

# Stitch MCP 토큰 갱신 스크립트
PROJECT_ID="gen-lang-client-0223191932"
CONFIG_FILE="$HOME/.gemini/antigravity/mcp_config.json"

# 새 토큰 생성
NEW_TOKEN=$($HOME/google-cloud-sdk/bin/gcloud auth print-access-token)

if [ -z "$NEW_TOKEN" ]; then
    echo "❌ 토큰 생성 실패. gcloud auth login 필요."
    exit 1
fi

# mcp_config.json 업데이트
cat > "$CONFIG_FILE" << EOF
{
  "mcpServers": {
    "sequential-thinking": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"],
      "env": {}
    },
    "stitch": {
      "serverUrl": "https://stitch.googleapis.com/mcp",
      "headers": {
        "Authorization": "Bearer $NEW_TOKEN",
        "X-Goog-User-Project": "$PROJECT_ID"
      }
    }
  }
}
EOF

echo "✅ 토큰 갱신 완료: $CONFIG_FILE"
echo "⚠️  Antigravity 재시작 필요!"
```

---

## 참고 링크

- [Stitch 공식 문서](https://stitch.withgoogle.com/docs/mcp/setup)
- [Stitch 웹 인터페이스](https://stitch.withgoogle.com/)
- [Google Cloud Console](https://console.cloud.google.com/)
