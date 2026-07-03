# 관리자 실험실: 유튜브 썸네일 생성기

## 접근 경로

- 관리자 콘솔 → **실험실** → **유튜브 썸네일 생성기**
- 직접 URL: `/admin?module=youtube-thumbnail-generator`
- 관리자 인증이 필요한 서버 API: `/api/admin/youtube-thumbnail-generator`

## 기본 사용 흐름

1. 이미지 생성 모델을 선택합니다. 로컬 점검과 시안 검토는 **Mock / 안전 미리보기**를 사용합니다.
2. 다음 업로드 영상의 콘텐츠 주제, 메인 문구, 스티커 문구를 입력합니다.
3. 쯔양/진행자 참고 이미지, 음식, 사물, 기타 인물 참고 이미지를 최대 8장까지 첨부할 수 있습니다.
4. 안전 확인 체크박스가 켜져 있는지 확인한 뒤 **썸네일 초안 생성**을 실행합니다.
5. 캔버스에서 문구를 직접 편집하고 PNG로 저장합니다.

## 캔버스 편집 기능

- **문구 추가/삭제**: 새 텍스트 레이어를 추가하거나 불필요한 레이어를 삭제합니다. 마지막 1개 레이어는 안전하게 남깁니다.
- **드래그 이동**: 1280×720 캔버스 위 텍스트를 마우스/포인터로 직접 이동합니다.
- **폰트 프리셋**: Impact, Arial Black, Pretendard 계열을 빠르게 적용합니다.
- **외곽선/그림자 프리셋**: 검정 외곽선, 노란 포인트 외곽선, 강한/부드러운 그림자, 그림자 없음 옵션을 적용합니다.
- **세이프 에어리어 가이드**: 썸네일 크롭/플랫폼 UI에 가려질 수 있는 영역을 점선 가이드로 확인하고 숨길 수 있습니다.
- **PNG 저장**: 현재 캔버스를 `tzudong-youtube-thumbnail-1280x720.png`로 내보냅니다.

## Provider 설정

라이브 이미지 API는 실수 과금과 불완전한 모델명을 막기 위해 기본 비활성입니다.

### 공통 게이트

```bash
THUMBNAIL_GENERATOR_ENABLE_LIVE_API=1
```

### OpenAI GPT Image API

```bash
OPENAI_API_KEY=...
# 선택: STORYBOARD_AGENT_OPENAI_API_KEY=...
THUMBNAIL_OPENAI_IMAGE_MODEL=gpt-image-1.5
```

허용 모델은 코드 allowlist에 고정되어 있습니다. 현재 `gpt-image-2`는 UI 요구사항 표기/로컬 probe 대상이지만, API allowlist에는 공식 검증 전 추가하지 않습니다.

### Google Gemini / Nano Banana 계열

```bash
GEMINI_API_KEY=...
# 또는 GOOGLE_API_KEY=...
THUMBNAIL_GEMINI_IMAGE_MODEL=gemini-3-pro-image-preview
```

지원 별칭:

- `nano-banana` → `gemini-2.5-flash-image`
- `nano-banana-pro` → `gemini-3-pro-image-preview`

`nano-banana-2-pro`처럼 검증되지 않은 마케팅명은 서버에서 거부합니다.

### Codex CLI local probe

```bash
ALLOW_LOCAL_CLI_THUMBNAIL=true
```

현재 로컬 Codex 경로는 `codex --version`/`codex --help` 탐지만 수행합니다. 검증된 파일 출력 명령 계약이 생기기 전까지 실제 생성 결과 대신 안전한 mock 결과를 반환합니다.

## Durable release readback readiness

`/api/admin/youtube-thumbnail-generator/releases/current`는 기존 `status`, `release`, `diagnostics.reason` 필드를 유지하면서 `readiness`를 함께 반환합니다.

- `readiness.provider`: `youtube-thumbnail-durable-release`
- `readiness.status`: `ready`, `degraded`, `unavailable`, `unknown`
- `readiness.reasonCode`: 운영자가 조치할 수 있는 안정적인 사유 코드
- `readiness.checkedAt`: 서버가 readback 상태를 확인한 ISO 시각
- `readiness.remediation`: 다음 운영 조치
- `readiness.diagnostics`: allowlist된 값만 포함하며 raw storage path, service-role key, provider secret, raw DB/provider error는 포함하지 않습니다.

주요 사유 코드와 조치:

| reasonCode | 상태 | 의미 | 운영 조치 |
| --- | --- | --- | --- |
| `ready` | `ready` | 활성 durable release가 admin asset proxy로 안전하게 제공됩니다. | 별도 조치 없음. |
| `local_release_candidate_fallback` | `degraded` | Supabase durable registry를 읽지 못해 이미 공개 폴더에 mirror된 exact 후보를 read-only fallback으로 사용합니다. | Supabase 환경/테이블/RPC를 복구한 뒤 후보를 durable release로 publish합니다. |
| `durable_release_empty` | `degraded` | registry는 접근 가능하지만 활성 release row가 없습니다. | 검증된 exact gpt-image-2 후보를 publish합니다. |
| `missing_supabase_env` | `unavailable` | `NEXT_PUBLIC_SUPABASE_URL` 또는 `SUPABASE_SERVICE_ROLE_KEY`가 없습니다. | 서버 환경변수를 설정하고 재시작합니다. |
| `missing_release_table` | `unavailable` | `youtube_thumbnail_releases` 테이블 또는 publish RPC가 없습니다. | Supabase migration을 적용합니다. |
| `invalid_release_row` | `unavailable` | 활성 row가 strict public contract를 통과하지 못했습니다. | row를 폐기/수정하고 안전한 후보를 다시 publish합니다. |
| `thumbnail_durable_release_current_failed` | `unavailable` | current route의 예기치 않은 실패가 redacted payload로 bounded 처리되었습니다. | 서버 로그에서 원인을 확인하되 API 응답에 raw error를 노출하지 않습니다. |

## 안전/운영 제약

- 실제 개인 이름, 계정명, URL, 가격, 주소, 전화번호, 실제 브랜드 로고를 생성 지시나 렌더링 텍스트에 넣지 않습니다.
- 참고 이미지는 PNG/JPEG/WebP만 허용합니다.
- 파일 제한: 최대 8장, 파일당 8MiB, 총 32MiB.
- API 응답은 `Cache-Control: no-store`입니다.
- 운영 DB나 외부 provider 과금 경로는 별도 환경변수 없이 활성화되지 않습니다.
