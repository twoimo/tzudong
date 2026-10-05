# PR2903 README historical semantic reconciliation

PR2903을 전체 `superseded`로 판정하지 않는다. 정확한 diff를 12개 문서 의도로 나누었다. 시작 상태는 `fulfilled` 3, `still needed` 5, `intentionally excluded under user constraints` 4, `active-owner dependency` 0이다. 살아 있는 의도 5개를 현재 source에 맞게 최소 반영한 뒤의 상태는 `fulfilled` 8, `intentionally excluded under user constraints` 4, 미해결 `still needed` 0, `active-owner dependency` 0이다. `fulfilled`는 로컬 문서 의도가 충족되었다는 뜻이며 PR 병합이나 운영 동작 증명이 아니다.

수정한 source는 지정 checkout의 `README.md`, `README.ko.md`뿐이다. 각 파일 +23/-2, 합계 +46/-4이다. 한글판은 영어 README가 직접 연결하는 대응 문서이므로 같은 시작 절차와 release 설명을 맞췄다. 코드·패키지·lock·workflow는 수정하지 않았다. commit/push/PR 댓글·종결/메시지 전송/설정 변경을 수행하지 않았다.

## 정확한 비교 기준

| 구분 | 확인값 |
| --- | --- |
| 작업 checkout | `/Users/twoimo/.codex/worktrees/promotion-sync-20261004/tzudong` |
| 작업 branch | `codex/historical-quality-20261004` |
| 권위 있는 통합 source | `7a430454cf90a4d9f1ba0ce35ad3ffd5022ceebd` |
| parent PR3114 | OPEN, head가 위 통합 SHA와 동일, base branch `develop` |
| old PR2903 | OPEN, base branch `main`, head branch `docs/clean-readme-1788926635` |
| old 정확한 base | `67df460dee73f90b93eee203ebcbe7bd9976cb03` |
| old 정확한 head | `da096e04baf979ac35531172c7a1de95090aa649` |
| 직접 부모 및 merge-base | 모두 위 old base와 동일 |
| old 변경 경로 | `README.md` 하나, +92/-54 |

GitHub에서 PR 메타데이터와 diff만 읽었다. old head의 직접 부모, merge-base, 전체 blob, base→head full-index diff를 로컬 Git object로 다시 확인했다. GitHub diff와 로컬 exact diff의 stable patch ID가 같다. line 근거는 `pr2903-head-README.md`, `pr2903-base-README.md`, `integration-README.md`이며 전체 diff는 `pr2903-exact.diff`다. PR 제목이나 변경 줄 수는 의도 판정 근거로 사용하지 않았다.

이 보고서는 remote `main` 포함 여부를 확인하거나 주장하지 않는다. PR3114의 통합 head와 지정 checkout source가 비교 권위다. parent PR의 source 통합을 원격 병합 또는 배포로 간주하지 않는다.

## 의도별 exact 대조

아래 `old H`는 old head README의 행, `old B`는 old base README의 행이다. `현재`는 수정 전 통합 SHA의 snapshot과 해당 source를 뜻한다.

| ID | old diff 의도와 정확한 위치 | 현재 source/caller/tests 근거 | 시작 판정 → 최종 판정 및 처리 |
| --- | --- | --- | --- |
| R01 | 제품 이름, 한·영 문서 진입점, MIT 접근 유지 — old H 3–5, 13, 20, 116–118 | 통합 README 5–16, 로컬 `LICENSE`, `README.ko.md` 존재. 라이선스 문서 자체는 수정 불필요 | `fulfilled` → `fulfilled`. 기존 로고·제목·언어·라이선스 링크 유지. 별도 MIT footer 재도입 불필요 |
| R02 | 고정 v1.2.4 링크를 latest release 대상으로 변경 — old H 8 / old B 10 | 통합 한·영 README 모두 여전히 고정 v1.2.4를 “latest”로 표기 | `still needed` → `fulfilled`. 양쪽 링크를 old PR의 `/releases/latest`로 교체. 현재 릴리스 버전이나 배포 성공을 주장하지 않음 |
| R03 | Features / Product Tour / Tech Stack / Quick Start 이동 링크 — old H 15–21 | 통합 문서에는 해당 기능·스택·투어 내용은 있으나 내부 탐색 링크와 Quick start가 없음 | `still needed` → `fulfilled`. 기존 제목을 사용하는 Markdown 링크 4개씩 추가. 실제 anchor 존재 검증 |
| R04 | 핵심 제품 영역을 짧게 설명 — old H 27–34 | 통합 README 29–39에 이미 지도·커뮤니티·관리자·스토리보드·파이프라인 표가 있음. old base에도 동일한 기본 설명이 존재 | `fulfilled` → `fulfilled`. 표를 보존. 같은 문서 의도의 충족이며 지도·관리자 구현이나 운영 상태를 새로 검증했다는 의미는 아님 |
| R05 | 데스크톱/모바일 시각 투어 제공 — old H 38–79 | 통합 README 49–75 및 한글 대응 문서에 여섯 GIF 참조가 존재. GIF 파일 signature, 통합 blob 대비 동일성, 로컬 경로 검증 | `fulfilled` → `fulfilled`. 여섯 자산과 투어 본문 보존. 새 캡처나 재렌더링을 하지 않음 |
| R06 | 독자가 쓰는 frontend/UI/runtime stack을 한눈에 제공 — old H 83–89 | `apps/web/package.json`의 Next 16, React 19, Tailwind, Lucide, Node 24.x/npm 11.6.2 및 기존 native/compat TypeScript pin. App Router entrypoint `apps/web/app/layout.tsx` 존재 | `still needed` → `fulfilled`. frontend/UI 한 줄 보완. 기존 정확한 runtime/compiler/release-package 안내 유지 |
| R07 | 실행 가능한 local development 진입 경로 — old H 93–112 | 루트 `package.json`, `.env.example` 부재. `apps/web/package.json`/`.env.example` 존재. `dev` → `run-local-dev.mjs` → `dev-prewarm.mjs`; 로컬 stack/origin/ledger admission 후 webpack 시작. 기존 `local-supabase-runtime.test.ts` 280–290, 389–404에 관련 source contract 존재 | `still needed` → `fulfilled`. `cd tzudong/apps/web`, `npm ci`, 기존 로컬 stack 준비 안내, `npm run dev -- --port 8080`와 대응 loopback URL 추가. 명령은 실행하지 않고 경로/계약/셸 문법 검증 |
| R08 | 간결화를 위해 package 권위, promotion, 문서색인, privacy guardrail 단락 제거 — old B 43–47, 76–80 삭제 | 현재 `AGENTS.md`, `docs/agents/verification.md`, `release.md`, `privacy.md`가 같은 제약을 유지 | `intentionally excluded under user constraints` 유지. 현재 지침·package pin·보호장치·문서 링크를 삭제하지 않음 |
| R09 | “production-grade”, verified locations/receipt, geolocation routing, real-time feed 등 강화된 설명 — old H 27, 31, 34, 63 | 이 diff는 README만 수정함. 해당 표현을 입증하는 코드/테스트/운영 receipt를 old PR에 추가하지 않음. 이번 scope는 admin/CI/map 재조사를 제외함 | `intentionally excluded under user constraints` 유지. 근거 없는 기능·운영 성숙도 문구를 새로 도입하지 않음 |
| R10 | HTML header→badge/Markdown hero, emoji feature list, 모바일 cell 재포맷 및 storyboard width wrapper — old H 1–25, 29–36, 47–79 | 기존 제목/표/투어가 의도를 이미 전달하며 최소 문서 수정으로 기능 진입점 복구 가능 | `intentionally excluded under user constraints` 유지. 전체 cosmetic 재작성, 기존 역사·성능 본문 축약을 하지 않음 |
| R11 | old shell 예시와 Turbopack 표기를 그대로 채택 — old H 85, 99–109 | 루트에서 old `npm install`/`cp .env.example`는 현재 구조와 불일치. `dev-prewarm.mjs` 19–25, 40–49는 기본 webpack. Turbopack은 명시적 옵션 | `intentionally excluded under user constraints` 유지. old recipe를 그대로 재생하지 않고 R07에서 현재 source에 맞는 절차 제공 |
| R12 | privacy/release 설명 정합성 — old B 76–80을 old PR이 제거, 현재도 잘못된 release-block 문장이 살아 있음 | `docs/agents/release.md` 7 및 `privacy.md` 5: 외부 증거 gate는 2026-09-22 보류, 제품은 fail-closed 유지. release.md 9의 현재 promotion/rollback/readback 요건은 계속 적용 | `still needed` → `fulfilled`. guardrail 제거 대신 보류 사실과 현재 release 안내 링크로 한·영 마지막 문단 정정 |

R12는 old PR의 삭제를 그대로 수용한 것이 아니라, 살아남은 해당 문단을 현재 사용자 제약에 맞춘 조정이다. `fulfilled` R01/R04/R05는 PR2903 이전 base에도 있던 내용이므로 PR2903이 통합되었다는 근거가 될 수 없다.

PR2903의 문서 범위에 남은 active-owner dependency는 없다. admin/CI/map worker의 범위와 parent dependency test의 Next 버전 hardcoding은 재조사하거나 수정하지 않았다. 공유 checkout의 `.github/workflows/security-audit.yml` 변경은 다른 소유자의 작업으로 기록만 했다.

## 검증과 한계

- `validate-readme.py`: **14/14 정적 검증 통과**. 정확한 base/head 및 GitHub diff의 stable patch ID 일치, 현재 HEAD, README 링크/anchor, 명령 경로/셸 문법, manifest↔lock 최상위 계약, 변경 범위의 whitespace를 확인했다.
- 로컬 경로 참조 **62개**, 문서 내부 anchor **8개**, 누락 **0개**. 외부 HTTP 링크나 live URL은 요청하지 않았다.
- 각 README의 Product tour/제품 투어부터 Privacy/개인정보 직전까지 본문이 통합 SHA와 byte 동일하다. 기존 성능 수치·frozen evidence·역사적 배포 설명을 수정하거나 새로 검증했다고 주장하지 않는다.
- 투어 GIF **6개**는 통합 SHA의 blob과 byte 동일하다. 다른 worker의 파일이나 읽기 전용 `pipeline-performance-20261002/tzudong` checkout에는 쓰지 않았다.
- `git diff --check -- README.md README.ko.md`: 통과. `git apply --reverse --check readme.patch`: 통과. 통합 checkout의 tracked `apps/web/performance` 변경 경로: 0개. 새 산출물은 사용자가 지정한 별도 checkout의 `readme/` 안에만 저장했다.
- full build, full unit, Naver 측정, dependency 설치, 개발 서버/로컬 DB 시작, browser render, hosted 요청/쓰기, Vercel/배포/원격 설정 작업: **실행하지 않음**. 기존 관련 unit test는 source 대조 근거이며 이번 통과 결과로 세지 않았다.

개발 예시는 현재 source 계약에 맞춘 문서이며 이 worker가 전체 onboarding을 실행했다는 뜻이 아니다. `apps/web/node_modules`가 없고 global Node 26이라는 사용자 readback을 존중하여 Node/Bun 실행을 하지 않았다. Python 표준 라이브러리, Git, `bash -n`만 검증에 사용했다.

모델은 현재 세션의 local `turn_context`에서 `gpt-6-astra` / `xhigh`를 관찰했다. 사용자 readback은 parent와 세 subagent의 provider `openai`도 확인했다고 명시했다. 이를 구성 메타데이터로만 기록하며 실제 serving-model attestation은 미제공이다. `readme/model-metadata.json`에 관찰 출처를 분리했고 중앙 파일은 수정하지 않았다. credentials와 raw provider logs는 수집하지 않았다.

## 산출물과 재현

- `pr2903-metadata.json`, `pr3114-metadata.json`: read-only GitHub 기준값.
- `pr2903-base-README.md`, `pr2903-head-README.md`, `pr2903-exact.diff`, `pr2903-github.diff`: 정확한 old 문서와 diff.
- `integration-README.md`, `integration-README.ko.md`: 권위 SHA의 수정 전 문서.
- `source-evidence.json`: 비교한 current source/기존 tests의 SHA와 필요한 행만 보존.
- `readme.patch`: README 두 파일만 포함한 미커밋 patch.
- `validate-readme.py`, `validation.json`, `delivery.json`: 재현 검증과 최종 수량/범위.
- `baseline.json`, `model-metadata.json`: 작업 및 메타데이터 증거 경계.
- `REPRODUCE.md`: 읽기 전용 재현 명령.

사용자가 승인한 README 문서 범위는 완료했다. 원격 반영, PR disposition, 통합 commit, release 판단은 이 worker의 결과가 아니다.
