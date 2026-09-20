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

## 지도·리뷰 후속 로컬 점검

2026-09-20, 로컬 `127.0.0.1:3000`과 Postgres `tzudong-local-93b7ce882ecb`. 프로덕션 배포와 호스티드 KPI 수집은 포함하지 않는다.

- 로컬 `youtube_meta`의 조회수 필드는 비어 있으나, 호스티드 읽기 스냅샷 646건을 `youtube_video_kpi_snapshots`에 넣어 조회수 폭발 125·댓글 폭주 125·반응 찐함 63곳이 나온다. 지표 없음과 조건 불일치는 계속 구분한다.
- 최근 영상 필터는 브라우저에서 `32개의 맛집 발견`과 클러스터 마커를 유지했다.
- GPS 플로팅 버튼은 운영자 위치 증빙이 없어 fail-closed 토스트만 띄운다. 브라우저 위치 권한 창은 열리지 않았다.
- 리뷰 행은 로컬에 0건이라 탈퇴 회원 표시를 실데이터로 재현하지 못했다. 공개 프로필 조회는 배열/맵 구분과 100건 초과 배치를 코드에서 고쳤다.
- 모바일 국내/해외/카테고리 버튼 너비를 늘려 라벨 잘림을 줄였고, 상세 유튜브 썸네일은 16:9 `sddefault`와 재생 버튼 광학 정렬을 적용했다.
- 클러스터 클릭 후 개별 마커가 유지되고 바텀 시트에 맛집 목록이 열렸다. 로컬 리뷰 1건의 작성자는 `Nightly CI`로 표시되며 `탈퇴한 사용자`가 아니다. 동일 오리진 공개 스토리지 URL은 객체 키로 되돌린다. 지도 발견 다이어그램은 [map-discovery.html](../../../architecture/map-discovery/map-discovery.html).
- 로컬 리뷰 사진을 storage에 올린 뒤 피드에서 593×445로 디코딩됐다. 작성자는 Nightly CI. 재등장 맛집 필터는 20개의 맛집 발견.
- 이 워크트리에서 로컬 워커를 다시 띄운 뒤 프로젝트 acd96811 장면 1 재생성을 큐에 넣었다. revision 19→20, job claimed 후 워커가 image_started heartbeat를 유지한다. 이미지 저장 완료는 이 기록 시점에 아직 없다.
- 워커 MLX 타임아웃을 300s에서 600s로 올린 뒤 장면 1 재생성이 41.3초에 성공했다(revision 22 queued → 23 ready, image_saved). 이어 장면 1을 revision 19로 복원해 24 ready가 되었고 restored 이벤트는 새 큐 job 없이 기록됐다. export API는 200, 7,963,658 bytes JSON.
- export `storyboard-export-v1` 파일 20개(PNG 원본 5, WebP 15)를 Pillow로 모두 디코딩했다. 원본은 1024×576. [export-decode-rev24.json](export-decode-rev24.json).
- 관리자 스토리보드 화면에서 프로젝트 revision 24, 장면 1 제목 `(복원)`, 저장 장면 5개·이미지 5개, 로컬 워커 Krea를 확인했다. [화면](admin-storyboard-rev24.png).
- 장면 1 자막을 편집해 revision 25 ready가 되었다. 새 큐 job은 없었고 다른 네 장면 제목은 그대로였다.
- 로컬 MLX 전송 계약 테스트 46개가 통과했다. DNS·원격 IP·리다이렉트·클라우드 호스트 호출 거절과 외부 공급자 명시 동의, PNG/WebP 파생 검증을 포함한다.
- 5종 테마 로컬 검수: 최근 영상 32개, 재등장 20개. 조회수 폭발·댓글 폭주·반응 찐함은 지표 없음 안내. 바텀 시트는 클러스터 클릭 후 358곳을 열었다.

## 2026-09-20 후속 로컬 읽기

- 피드 작성자는 로컬 커뮤니티 픽스처 `먹보쯔양팬`이며 `탈퇴한 사용자`가 아니다. 로컬 로그인 닉네임은 `쯔동마스터`다. 프로덕션 계정 리뷰는 0건이라 호스티드 리뷰 행을 복사하지 않았다.

- 호스티드 읽기 재확인: 닉네임 `쯔동마스터` 프로필 1건, 리뷰 7건(인증 2, 미인증 5, 중복 2). 마이페이지가 0으로 보인 것은 행이 없어서가 아니라 프로필/리뷰 조회 실패를 0으로 접은 클라이언트 경로 때문이다. 호스티드 행은 로컬로 복사하지 않았다.
- 로컬 피드 `/feed`는 인증 리뷰 2건을 보여 준다. 작성자는 `쯔동마스터`, `먹보쯔양팬`이며 `Nightly CI`/`탈퇴한 사용자`가 아니다. 로컬 `쯔동마스터`는 nightly-ci 로그인 프로필이고, 프로덕션 계정 리뷰 본문은 가져오지 않았다.
- 로그인 세션 `display_name`에 남아 있던 `Nightly CI`는 공개 닉네임 후보에서 제외했다. 피드 작성자는 프로필 RPC의 `쯔동마스터`/`먹보쯔양팬`을 쓰고, 이메일 로컬파트 fallback은 제거했다. 호스티드 리뷰 행은 복사하지 않았다.
- `hasNaverMarkerCoordinates` 타입 가드와 중복 `formatCoordForSignature`를 고쳐 `typecheck:parity` 0건, 홈/피드 HTTP 200을 복구했다. 커밋 `cd62dfa9`.
- 로컬 `youtube_video_kpi_snapshots`에 호스티드 읽기 스냅샷 646건을 넣었다(최신 버킷 2026-07-16, 조회수 최대 29,750,577). 홈 KPI POST를 100개씩 나눠 8KB 한도를 피한 뒤 브라우저에서 조회수 폭발 125곳, 댓글 폭주 125곳, 반응 찐함 63곳이 나왔다.
- GPS 버튼은 운영자 증빙 없음 토스트만 띄우고 브라우저 위치 권한 창은 열리지 않았다. 조회수 폭발 상태에서 서울 클러스터 65를 누르면 개별 마커가 남고 왼쪽 목록이 맛집 목록 66곳으로 열린다. 스토리보드 프로젝트 acd96811은 revision 25, 공급자 local-mlx, externalAI false.
- 공개 지도/홈 `shadow-xl` 8곳을 `shadow-sm`으로 낮췄다.
- ChatGPT·Grok 수동 가져오기는 외부 공식 API 동의 없이 텍스트/이미지 공급자로 독립 선택할 수 있다. OpenAI·xAI 공식 API만 externalAI 게이트를 통과한다. 로컬 MLX 어댑터는 수동 공급자에 소켓을 열지 않는다.
- 390px에서 테마 칩 5개(조회수 폭발·댓글 폭주·최근 영상·재등장 맛집·반응 찐함)와 국내/해외/카테고리 라벨이 잘리지 않는다. 보물섬 상세 유튜브 16:9 썸네일의 재생 버튼은 중앙이다.
- 공개 지도/피드의 남은 shadow-lg와 hover:scale을 shadow-sm/무스케일로 낮췄다. 재생 버튼 광학 정렬(translate-x-[1px])은 유지했다.
- 공개 바텀시트 shadow-xl을 shadow-sm으로 낮췄다. 로컬 스토리보드 UI 계약 Playwright chromium 24건 통과. 수동 ChatGPT/Grok 프로젝트는 워커 재생성 버튼이 비활성이다.
- 관리자 `/admin?module=storyboard`에서 외부 AI 동의 없이 텍스트/이미지 공급자에 로컬 MLX, ChatGPT 수동, Grok 수동이 활성화되어 있고 OpenAI/xAI 공식 API는 disabled다. [화면](admin-storyboard-providers.png).
- 스토리보드 프로젝트 acd96811 revision 25 ready 재확인. export `storyboard-export-v1` HTTP 200, 7,963,672 bytes, 파일 20개(PNG 5 · WebP 15). 공급자는 local-mlx 텍스트/이미지, externalAI false.
- 같은 export 20개 파일을 Pillow로 모두 디코딩했다. SHA-256이 일치하고 원본 PNG는 1024×576, WebP 파생은 960×540과 480×270이다.
- 버전 이력 API는 revision 12–25 목록을 반환한다(preview 없음). 로컬 피드 작성자는 여전히 `쯔동마스터`, `먹보쯔양팬`이며 GPS readiness는 `DEVICE_LOCATION_OPERATOR_EVIDENCE_REQUIRED`다.
- revision 24 미리보기는 장면 5개, 장면 1 제목 `가게 앞 인트로 (복원)` revision 14, original PNG + WebP 3개를 반환한다. 복원 RPC는 호출하지 않았다.
- 현재 revision 25 장면 1 캡션은 `매운 짜장라면 맛집 탐방 (편집 검수)`이고, 24/19/16 미리보기는 `(복원)`이다. 장면 revision은 15→14→11→9로 다르고 원본 PNG 경로는 같다. 복원은 호출하지 않았다.












- GPS는 운영자 증빙 없음 토스트로 fail-closed. 최근 영상 32곳, 서울 클러스터 17곳 목록과 개별 마커 유지.
- 귀일만두 상세 유튜브 썸네일은 16:9, 재생 버튼 중앙. 390폭에서 국내/해외/카테고리 라벨 overflow 없음.
- 공개 시트·로그인·지도 플로팅 버튼의 그라데이션 타이틀과 두꺼운 테두리를 토큰 보더/solid primary로 줄였다. 프로덕션 배포와 GPS 실사용, 조회수 KPI 수집은 포함하지 않는다.
- 공개 알림/북마크/프로필 헤더의 `from-background via-background to-muted` 그라데이션을 평평한 `bg-background`로 낮췄다. 커밋 `3f937664`.
- 모바일 `/feed`에서 로그인·맛집 상세·리뷰 시트가 열리면 리뷰 작성 FAB를 숨긴다. 320px 로그인 시트에서 FAB가 안내 문구를 가리지 않았고, 설명은 `break-keep`이다. 커밋 `1986b54b`.
