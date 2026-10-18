# 재현 및 증거 판독

이 묶음은 Cursor의 네 가지 인계 작업(오케스트레이션 준비, 공개 패널 등급 계약, CI, 보호 승격·운영 readback)을 이어 수행한 기록이다. 전체 장기 성능 목표의 완료 증거가 아니다. 실패한 실행과 오래된 manifest·plan은 의도적으로 보존했다. 최신 결론은 최종 보고서 및 실제 SHA가 결합된 JSON을 사용한다.

## 환경과 불변식

- 로컬 Node 24.22.0: `/opt/homebrew/opt/node@24/bin/node`; CI Node 24.21.0. npm 11.6.2가 release lock의 기준이며 Bun 1.4.0을 사용했다.
- native TypeScript 7.0.2 / compatibility 6.0.2. Chromium 153.0.8010.12 / Playwright browser revision 1243. 운영 viewport는 1440×900, 834×1112, 430×860이며 물리 모바일을 의미하지 않는다.
- 실제 URL 실행은 익명·permission 없음·기본 네트워크/CPU, 각 실행 하나의 browser process와 viewport별 fresh context다. 서로 종속된 흐름은 독립 표본으로 세지 않는다. 필드 지표, 느린 CPU/네트워크, 인증 흐름, process memory, 고빈도 영상은 이번 자료로 검증되지 않았다.
- 3D 구성요소 실행의 navigator/clock/fetch는 합성 입력이다. software GL과 실제 React/Next 컴포넌트를 사용했어도 물리 기기·서비스 전체 성능 증거가 되지 않는다. 220ms 관찰 창은 사용자 지연을 가리는 제품 변경이 아니다.
- 실제 계정·위치·리뷰 쓰기·DB/Storage/DNS 변경 없이 검사했다. 공개 등급 API는 schema2/unpublished/null revision/entries0을 보존한다.

## 로컬 재현

먼저 새 checkout에 명시된 source commit과 pinned dependencies를 설치한다. 원본 dirty checkout이나 이 봉인된 폴더를 reset/clean하거나 기존 결과를 덮어쓰지 않는다. 재실행은 새 작업 식별자 아래에 스크립트와 필요한 harness를 복사하고, 루트 상대 import와 명시적 baseline SHA를 확인한 뒤 수행한다. 스크립트의 기존 결과 거부 검사는 제거하지 않는다.

```sh
export PATH=/opt/homebrew/opt/node@24/bin:$PATH
export PLAYWRIGHT_BROWSERS_PATH=/Users/twoimo/.codex/runtime-cache/cursor-evidence-browser-20261018
cd apps/web
bun test tests-unit/device-location-privacy.test.ts
npm run typecheck:parity
```

`location-precision-browser-v2/build.mjs before`는 Git의 실제 운영 baseline `2e5630fada4cd50fb71ff7542723ca6393afe7c0`에서 private API를 읽는다. `after`는 후보 `9228c1454393560bcd37240f793065e450f85683`의 해당 파일을 사용한다. 각각 Bun으로 build 후 Node로 `run.mjs before` / `after`를 실행한다. 각 phase에서 독립 browser process 1개, fresh context 4개, context당 종속 발급 시도 3회다. v1의 UI 갱신 대사 실패는 `location-browser-harness-race-v1.json`에 있으며, v2는 비동기 완료 receipt를 기다린다. 임의 지연이나 판정 완화로 해결하지 않았다.

`badge-mobile-capability-v1/`는 baseline `4696` 계열과 최종 3D caller gate의 10 navigator profile을 비교한다. profile당 context 1개, open/close 3회이며 전체 phase당 process 1개다. `badge-low-power-comparison-v1.json`의 signal-only 단계와 최종 caller gate를 구분한다. 서로 겹치는 절감률을 합산하지 않는다. bundle bytes는 미압축 구성요소 bytes이며 실제 CDN 전송량이 아니다.

production build는 `TZUDONG_NEXT_DIST_DIR`로 이름을 분리하고 해당 dist의 CSS boundary validator를 실행했다. build만으로 live/SDK 검증을 주장하지 않는다. `location-precision-production-build-v1.log`와 관련 CSS/offline browser 자료를 확인한다. Next가 자체 생성한 tsconfig include 두 항목 외의 사용자 변경을 되돌리지 않았다.

## 운영 재검증

`run-production-preflight-v4.py <exact-main-sha> <unique-label>`는 project/root/Node/Git 통합, protected main의 tree, 현재 READY rollback, www alias와 실제 health SHA를 결합한다. 읽기 전용이며 별도 운영 변경 권한을 만들지 않는다.

`run-production-verification-v2.py <exact-main-sha>`는 새 버전의 실제 URL 흐름·공개 자산·console 경계를 직렬 실행하고 four WebP의 live bytes/SHA256을 Git blob과 비교한다. 새 실행에는 출력명을 새 버전으로 변경해 기존 evidence를 보존한다. private 응답/헤더/token/전체 요청 URL을 저장하지 않는다.

추가로 public aliases v2, map visual v3, privacy readiness v2, strict history v3 및 diagnostic history v4를 실행한다. strict와 diagnostic은 서로 다른 계약이다. 뒤로 가기 후 detail이 돌아와도 원래 marker visibility가 실패하면 strict 실패를 유지한다. 정적 PNG는 플리커 영상이 아니며 캡처 사이의 프레임 결함을 배제하지 못한다.

## 통계와 무결성

낮을수록 좋은 지표는 절대 감소량=before−after, 상대 감소율=(before−after)/before×100이다. 성공률은 높을수록 좋고 percentage point 차이를 쓴다. 0 baseline에서 상대 배수/비율을 계산하지 않는다. phase당 process 1개이므로 population CI/p95 및 전체 UI 개선율을 산출하지 않는다. RAF 13↔14 차이는 성능 개선 입증 안 됨으로 분류한다. 메모리 guard와 field 성과는 미입증이다.

최종 complete-set artifact map은 모든 파일의 bytes와 SHA256을 포함하며 map 자체만 제외한다. pin은 `docs/evidence/`의 별도 파일이다. `verify-cursor-evidence-packet-20261018-v1.py`로 로컬 complete set을, `verify-cursor-remote-packet-20261018-v1.py`로 새 bare partial clone의 원격 blob bytes를 검증한다. credential scan은 제한된 패턴 탐지이며 개인정보 부재의 전면 증명이 아니다. 공개 map-only 이미지와 감사 전송 범위를 별도로 검토한다.

`pre-promotion-checkpoint-v1/`의 옛 map/pin은 불변이다. 외부 감사의 로그인·모드·업로드·전송·연구·전문 저장·판정은 각각 별도 단계이며, 로컬 decision matrix는 외부 보고서로 취급하지 않는다.
