# 스토리보드 생성 UX와 과거 버전 복원 검수

2026-09-20, 로컬 `127.0.0.1:3000`. 프로덕션 배포·호스팅 DB 적용·외부 ChatGPT Web 검수는 이 보고서의 성공 범위에 포함하지 않는다.

## 변경

- 새 생성 폼을 넓게 배치하고 텍스트·이미지 공급자를 각각 선택한다. 외부 AI 기본 비활성화와 명시적 동의를 유지한다.
- 저장된 프로젝트는 장면 편집부터 연다. 썸네일 선택과 선택한 장면의 이미지·설명을 함께 표시한다.
- 장면 편집 / 버전 이력 / 결과 가져오기를 분리한다. 모델·워커 진단과 이전 작업 공간은 연결 설정 안에 있다.
- 버전 미리보기와 확인 후 프로젝트 전체 또는 장면 하나를 복원한다. 현재 공급자 설정을 유지하고 모델을 호출하지 않는다.
- 불변 스냅샷과 복원을 하나의 DB 트랜잭션에서 기록한다. 오래된 요청, 진행 중 작업, 소유권 불일치, 누락된 원본을 거부한다. 중복 요청은 한 번만 적용한다.

## 실데이터 복원 증거

기존 실모델 프로젝트 `acd96811-9c82-4164-a825-876187055321`에서 v12 → 편집 v13 → 장면 1 복원 v14 → 전체 v13으로 복원 v15 → 전체 v12로 복원 v16을 수행했다. v14의 다른 네 장면은 그대로였고, v16 본문은 버전 카운터를 제외하면 v12와 일치했다. 원본과 WebP 파생 파일 20개의 SHA-256과 디코딩을 검증했다. 세 복원 작업이 생성한 큐 작업은 0개였다.

정량 결과: [restore-proof.json](restore-proof.json). 저장되지 않은 v12 이전 본문을 복구했다고 주장하지 않는다. 스냅샷은 로컬에 적용한 `20260920021531_storyboard_historical_restore.sql`부터 시작한다.

## 검증

- 격리 Playwright UI 계약: 24 통과. 모의 HTTP 테스트이며 실제 모델 성공의 증거로 사용하지 않는다.
- 실제 PostgreSQL 컨테이너 통합: 15 통과. 동시 claim, lease, 권한, 중복 복원, 스냅샷 UPDATE 거부 포함. 정식 Supabase 전체 migration replay와는 별개다.
- 관련 Bun 스토리보드 테스트: 112 통과, 플랫폼별 8 skip. 프로필 조회 테스트 24 통과.
- Node 24 `typecheck:parity`: 양쪽 컴파일러 오류 0. 변경 파일 ESLint 통과.
- 실제 브라우저: 390×844, 768×1024, 1440×900에서 장면 선택·편집·복원·이미지 로딩을 검수했다. 생성 폼은 별도로 데스크톱/태블릿/모바일 확인했다. 전체 사이트 검수 완료를 뜻하지 않는다.

```sh
cd apps/web
bunx playwright test --config=playwright.storyboard.config.ts
bun test tests-unit/storyboard-production-api.test.ts
npm run typecheck:parity
cd ../..
python3 backend/supabase/tests/storyboard_mlx_worker_integration.py -v
```

## 화면

[새 생성 폼 · 데스크톱](storyboard-create-ux-desktop.png) · [새 생성 폼 · 태블릿](storyboard-create-ux-tablet.png) · [새 생성 폼 · 모바일](storyboard-create-ux-mobile.png)

[장면 편집 · 데스크톱](storyboard-after-ux-desktop.png) · [태블릿](storyboard-after-ux-tablet.png) · [모바일](storyboard-after-ux-mobile.png)

## 남은 검수

지도·GPS·리뷰 데이터 전체 검수와 외부 Web 리뷰, 보호된 브랜치 승격, 프로덕션 적용은 별도로 남아 있다. 모델 호출 없는 복원 성공과 실제 생성 성공을 구분한다.

## 워커 복구 후 실제 재생성

로컬 워커 heartbeat를 복구한 뒤 브라우저에서 장면 1만 재생성했다. v17 큐 등록 → claim → Krea 이미지 생성 → v18 저장/성공을 확인했다. 다른 네 장면은 바뀌지 않았다. 이어 브라우저에서 v16의 장면 1을 복원해 v19가 되었고, 과거 자산 ID·출처·바이트가 일치했다. 20개 내보내기 파일도 디코딩/해시 검증했다.

동일 프롬프트의 재생성 결과는 새 자산과 생성 시각으로 저장됐지만 이미지 바이트는 기존과 동일했다. 이미지가 시각적으로 달라졌다고 주장하지 않는다. 생성 호출의 seed/변형 UX는 후속 점검 대상이다. [재생성·복원 증거](regenerate-restore-proof.json).

## 외부 화면 검수 후 보완

ChatGPT Web xhigh 요청에 첨부한 화면 2장에 대한 응답을 받았다. 생성 동작 중복과 동의 설명을 정리했고, 모바일 마지막 필드·버튼의 실제 키보드 접근과 메뉴 겹침을 직접 확인했다. [외부 응답과 반영 기록](external-ui-review.md). 이는 전체 소스/런타임 외부 검수 또는 프로덕션 검수 완료를 뜻하지 않는다.
