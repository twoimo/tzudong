# 🚀 OCI Server Migration Summary (2026-01-18)

이 문서는 Vercel OCR 기능을 **Oracle Cloud (OCI) 전용 서버**로 이관한 작업 내용을 정리합니다.

---

## 🏗️ 1. 전체 구조 (Architecture)

**Hybrid System**: 평소에는 빠르고, 유사시에는 강력하게 동작합니다.

1.  **Vercel (Client)**: 하루 **5회**까지는 Vercel(Google API)에서 직접 처리하여 가장 빠릅니다.
2.  **OCI Server (Fallback)**:
    *   5회를 초과하거나, Vercel에서 에러가 발생하면 **즉시 OCI 서버로 전환**됩니다.
    *   OCI 서버는 **하루 1,500회(개인 무료 한도)**까지 무제한 처리 가능합니다.
    *   **3456번 포트**를 통해 24시간 대기 중입니다.

---

## 📂 2. 주요 파일 위치 (서버 내부)

*   **프로젝트 폴더**: `/home/ubuntu/gemini-ocr/`
*   **실행 파일**: `/home/ubuntu/gemini-ocr/daemon.mjs`
*   **로그 파일**: `/home/ubuntu/gemini-ocr/.gemini/daemon.log`
*   **PM2 로그**: `/home/ubuntu/.pm2/logs/`

---

## 🛠️ 3. 관리 명령어 (Cheat Sheet)

서버 관리가 필요할 때 아래 명령어를 사용하세요.

### 상태 확인
```bash
# 데몬이 잘 살아있는지 확인
pm2 list

# 실시간 로그 확인
pm2 logs gemini-ocr
```

### 재시작 / 중지
```bash
# 데몬 재시작 (코드 수정 후 필요)
pm2 restart gemini-ocr

# 데몬 중지
pm2 stop gemini-ocr
```

### 방화벽 확인
```bash
# 3456 포트가 열려있는지 확인
sudo netstat -tuln | grep 3456
```

---

## ⚠️ 4. 주의 사항

1.  **이미지 보안**: 처리된 영수증 이미지는 `temp_images/` 폴더에 잠시 저장되었다가 분석 후 **즉시 삭제**됩니다. 용량 걱정 안 하셔도 됩니다.
2.  **자동 실행**: 서버를 재부팅해도 PM2가 알아서 데몬을 다시 켭니다. (`pm2 startup` 설정 완료)
3.  **소스 업데이트**: 만약 `apps/web/scripts/gemini-daemon.mjs`를 수정했다면, 반드시 서버의 `~/gemini-ocr/daemon.mjs`로 파일을 복사해주셔야 합니다.

---

## 🧐 5. 데몬 코드 해설 (Deep Dive)

어떻게 이 모든 게 가능한지, `daemon.mjs`의 핵심 원리를 아주 쉽게 설명해 드릴게요.

### 1단계: 전화기 켜기 (Server Start)
```javascript
const server = http.createServer(async (req, res) => { ... });
server.listen(3456, '0.0.0.0', ...);
```
*   제일 먼저 **3456번 포트**를 열고 전화벨이 울리기를 기다립니다.
*   `0.0.0.0`은 "누구든(Vercel) 전화 걸어도 받아줘"라는 뜻입니다.

### 2단계: "잠시만요, 담당자 연결해드릴게요" (Lazy Loading)
```javascript
if (!geminiClient) await init();
```
*   평소에는 아무 기능도 로딩하지 않고 메모리를 아낍니다.
*   첫 전화가 오면 그제서야 **Gemini 기능들을 로딩(`init`)**합니다. 이것 때문에 평소에 리소스를 거의 안 먹습니다.

### 3단계: 사진 받기 (Image Save)
```javascript
const tempDir = path.join(process.cwd(), 'temp_images');
fs.writeFileSync(tempImagePath, Buffer.from(imageBase64, 'base64'));
```
*   Vercel이 보내준 사진 데이터(Base64)를 받아서 `temp_images` 폴더에 진짜 사진 파일(`.jpg`)로 만듭니다.
*   **중요**: Gemini 보안 정책 때문에 꼭 `워크스페이스` 안에 만들어야 해서 이 경로를 씁니다.

### 4단계: "사장님, 이거 해석해주세요" (Internal Call)
```javascript
geminiClient.sendMessageStream(parts, ...);
```
*   별도로 `gemini` 프로그램을 켜는 게 아니라(느림), **이미 연결된 회선(Client)**으로 구글 본사에 바로 물어봅니다. 그래서 엄청 빠릅니다!

### 5단계: 흔적 지우기 (Cleanup)
```javascript
fs.unlinkSync(tempImagePath);
```
*   해석이 끝나면 만들었던 사진 파일을 **즉시 삭제**합니다. 개인정보 보호 + 용량 절약! 완벽하죠?

---

### 6단계: 비밀은 "메모리 상주" (Memory Residency)

보통의 웹사이트(PHP 등)는 요청이 끝나면 프로그램이 꺼지지만, **Node.js 데몬**은 꺼지지 않고 계속 실행됩니다.
그래서 한 번 로그인한 정보(`geminiClient` 변수)를 **메모리(RAM)에 계속 쥐고 있습니다.**

*   **일반 방식**: [앱 켜기 -> 로그인 -> 메시지 전송 -> 앱 끄기] (반복)
*   **데몬 방식**: [앱 켜짐 (유지) -> 메시지 전송 -> 메시지 전송 ...] (로그인 생략!)

이것이 바로 "이미 연결된 회선"의 기술적 실체입니다. ⚡️

### 7단계: 꺼지지 않는 불꽃 (Auto Token Refresh)

"로그인 풀리면 어떡하죠?" 걱정 마세요.

*   **Access Token**: 1시간짜리 입장권. (금방 만료됨)
*   **Refresh Token**: 무기한 재발급권. (`oauth_creds.json` 안에 숨어있음)

데몬은 입장권이 만료될 것 같으면, 사용자 몰래 **재발급권을 내밀고 새 입장권을 받아옵니다.**
이 과정이 0.1초 만에 자동으로 일어나기 때문에, **서버는 영원히 로그아웃되지 않습니다.** ♾️

---

## 🛑 6. 중단 가능성 (Risks)

"이 시스템이 멈춘다면 언제일까요?"

1.  **Google 정책 변경**: 구글이 무료 API 한도(1,500회)를 줄이거나 없애버릴 경우.
2.  **구글 계정 문제**: 사용 중인 구글 계정이 정지되거나 비밀번호가 변경되어 Refresh Token이 무효화될 경우. (이때는 서버에서 다시 로그인해줘야 함)
3.  **모델 단종**: 사용 중인 AI 모델(`gemini-3-flash-preview` 등)이 구글 측에서 서비스를 종료할 경우.

**결론**: 우리가 건드리지 않는 한, **구글이 서비스를 종료하거나 내 계정을 막지 않는 이상** 계속 작동합니다.

---

## 🚦 7. 동시 요청과 확장성 (Concurrency)

"여러 명이 동시에 쓰면 어떻게 되나요?"

*   **기본 상태**: 현재는 **싱글 스레드**로 동작하므로, 한 번에 하나씩 순서대로 처리합니다. (워낙 빨라서 사용자는 못 느끼지만요)
*   **충돌 방지**: 코드 내부에서 `resetChat()`을 사용하여, 유저 A의 영수증 내용이 유저 B에게 섞이지 않도록 방지하고 있습니다.
*   **확장 방법**: 만약 사용자가 엄청나게 늘어나면, PM2의 **클러스터 모드**를 켜면 됩니다.
    ```bash
    # CPU 코어 수만큼 서버를 여러 개 띄워서 동시 처리 능력 업그레이드!
    pm2 delete gemini-ocr
    pm2 start daemon.mjs --name gemini-ocr -i max
    ```

---

## 🔧 8. 문제 해결 가이드 (Troubleshooting)

갑자기 안 될 때, 이 2가지만 기억하세요.

### Q1. 구글 계정이 막혀서 로그인이 풀렸어요!
서버에 접속해서 다시 로그인하면 됩니다.
```bash
cd ~/gemini-ocr
npx @google/gemini-cli login
# 화면에 나오는 URL을 복사해서 내 컴퓨터 브라우저에 붙여넣기 -> 로그인 승인 -> 끝!
```

### Q2. 구글이 'gemini-3-flash-preview' 모델을 없앴대요!
설정 파일에서 모델 이름만 바꿔주면 됩니다.
```bash
nano /home/ubuntu/.gemini/settings.json
# "model": "gemini-3-flash-preview" 부분을 찾아서 새로운 모델명(예: "gemini-4-flash-preview")으로 수정
pm2 restart gemini-ocr
```

---

## 🛡️ 9. Supabase의 역할 (Role of Supabase)

"Supabase는 이제 안 쓰는 건가요?"
아닙니다. **이미지 저장소(Storage)**로서의 역할만 빠졌을 뿐, 여전히 중요한 관리자 역할을 합니다.

1.  **이미지 처리 경로 (Bypass)**:
    *   영수증 이미지는 **Supabase DB에 저장되지 않습니다.**
    *   [사용자] -> [Vercel API] -> [메모리] -> [Gemini/OCI] 순서로 처리되고 휘발됩니다.
    *   따라서 스토리지 용량을 차지하지 않습니다.

2.  **Supabase의 3가지 핵심 임무**:
    *   🔐 **인증 (Auth)**: 로그인한 사용자만 API를 호출할 수 있도록 검사합니다.
    *   📊 **사용량 제한 (Quota)**: `ocr_logs` 테이블을 확인하여 **'하루 5회'** 무료 사용량을 체크합니다.
    *   📝 **로그 기록 (Logs)**: 누가, 언제, 어떤 모델로 처리했는지 이력을 남겨 트래킹합니다.

---

**한 줄 요약**: "이제 OCR은 평생 무료, 무제한, 무중단입니다." 👍
