# Evidence Engineering 작업

기준일은 2026-10-17이다. 규범 요약은 `docs/evidence-engineering/`이다. 원본 키트는 저장소에 넣지 않는다. 모순은 `docs/evidence-engineering/contradictions.md`에 열려 있다. 작업지시서 파일 W001–W018의 제목이 마스터 플랜 4장의 번호 설명보다 우선한다.

완료 표시는 해당 작업의 코드와 테스트가 통과한 뒤에만 한다.

## Task 1: 기반 구조와 공유 타입·파서·가드·순수 불변식

- [x] 완료. `apps/web/lib/evidence-engineering/`와 `apps/web/tests-unit/evidence-engineering-foundation.test.ts`.
- [x] [Cross-Check: 교차검증] 반감기 `2000/3`, `D(460)=100/169`, `decay(460,0.5,460)=0.75`, `decay(1825,0.5,460)=549/914`, 고유 영상 승수, null과 0의 구분, 광역 단계의 자동 확정 금지, 검색 실패와 `closed_store`의 분리.
  `apps/web/tests-unit/evidence-engineering-foundation.test.ts`의 `locks the hyperbolic half-life correction`, `floor decay uses the decayable half-life`, `visit multiplier ignores duplicate video ids`, `counts keep null distinct from zero`, `broad Naver stages and search misses never become closed_store`가 여덟 절을 잠근다.

구현 범위는 타입, 파서, 가드, 순수 함수다. 추출, 크롤링, 업로드, 마이그레이션, UI, DB 쓰기는 없다.

내보낸 타입: `EvidenceLevel`, `EvidenceFrameType`, `ConfidenceLevel`, `ModerationStatus`, `PopularityTier`, `IdentityPipelineStage`, `IdentityTerminalState`, `ReviewedOperationalStatus`, `FetchDecision`, `EvidenceFamily`, `RestaurantEvidenceFrame`, `EvidenceFrameDraft`, `FrameSamplingPlan`, `PopularitySignals`, `UniqueCountAggregate`, `PopularityTierAssignment`, `PopularityMetricRecord`, `ClosureIdentityRecord`, `IdentityDecisionInput`, `IdentityMatchDecision`, `FetchRetryBudget`, `ScoringCohortIdentity`.

내보낸 동작: `decay`, `hyperbolicDecay`, `hyperbolicHalfLifeDays`, `visitsMultiplier`, `safeCount`, `aggregateUniqueCounts`, `assemblePopularitySignals`, `resolveAutomaticIdentityState`, `applyReviewedOperationalStatus`, `levenshteinDistance`, `levenshteinSimilarity`, `isInsideThesisProximityRadius`, `buildEvidenceSeekUrl`, `buildStorageObjectKey`, `planFrameSamplingWindow`, `parseEvidenceFrame`, `unionApprovedEvidenceFrames`, `classifyFetch`, `mayRetryFetch`, `parseTierAssignment`, `assertSameScoringCohort`, `parsePopularityMetric`.

## Task 2: W001 기존 Step 04에 키프레임 시작점과 디코드 후 2fps 샘플링을 연결한다

- [x] 완료. `backend/restaurant-crawling/scripts/evidence-frame-sampling.mjs`를 `04-extract-frames-with-heatmap.js`가 호출한다. 히트맵 추출은 키프레임을 디코드 시작점으로 쓰고, 근거 샘플은 목표 시각 ±5초를 디코딩한 뒤 `fps=2`로 남긴다.
- [x] [Cross-Check: 교차검증] I-frame 탐색과 디코드 후 `fps=2`는 다른 작업이다. I-frame 전용 2fps를 성공 조건으로 두지 않는다. Node가 전체 영상을 적재하지 않는다.
  `backend/restaurant-crawling/scripts/tests/test_evidence_frame_sampling.mjs`의 `decode start is the latest keyframe at or before the window, and output sampling is fps=2`와 `processSingleVideo writes a 2fps evidence manifest from the local file without loading it`가 세 절을 잠근다.

소유할 경로:

- `backend/restaurant-crawling/scripts/04-extract-frames-with-heatmap.js`
- `backend/pipeline/test_data_contracts_unittest.py`의 프레임 관찰 계약
- 소비만 하는 기존 순수 계획: `planFrameSamplingWindow`

입력은 로컬 영상과 목표 시각이다. 키프레임 타임스탬프는 디코딩 시작점이다. ±5초 구간을 디코딩한 뒤 2fps로 샘플한다. 출력은 기존 `video_id`, `recollect_id`, `start_sec`, `end_sec`, `rank`, `file_names`, `frame_count`를 깨지 않는다. 프레임 PTS, 추출 설정, 추출기 버전을 결과 메타데이터에 남긴다. 유튜브 429, 401, 403, 인증 챌린지는 `classifyFetch`로 나누고 쿠키나 토큰 우회를 넣지 않는다.

## Task 3: W002 콘텐츠 SHA-256과 frame_id를 분리하고 기존 프레임과 대사한다

- [x] 완료. `evidence-frame-identity.mjs`가 바이트 해시와 `frame_id`를 분리하고, Step 04가 `storage-key.mjs`의 키 규칙으로 원장을 대사한다. 609/763/663은 성공 조건이 아니다.
- [x] [Cross-Check: 교차검증] 바이트 해시와 `frame_id`는 서로 대체하지 않는다. 같은 해시는 같은 키 프리픽스를 만든다. 같은 `frame_id`의 해시가 다르면 충돌이다.
  `backend/restaurant-crawling/scripts/tests/test_evidence_frame_sampling.mjs`의 `content hash and frame id stay separate and the same hash keeps one key prefix`가 분리, 해시 프리픽스, 충돌을 잠근다.

소유할 경로:

- `backend/restaurant-crawling/scripts/` 아래 기존 프레임 산출물에 붙는 해시 대사 모듈
- `apps/web/lib/evidence-engineering/frames.ts`의 키 규칙을 재구현하지 않고 호출

작업지시서와 마스터 플랜 4장은 기검토 프레임 609개를 말한다. 참조 세션의 763개 식당 행과 663개 영상은 다른 모집단이다. 셋 중 어느 숫자도, 실제 파일 목록과 해시를 대사하기 전에는 성공 조건으로 쓰지 않는다.

## Task 4: W003 간판·자막 영역을 나누고 상호명과 지점명만 추출한다

- [x] 완료. `detected_place_names.py`를 `06-frame-caption.py`가 호출한다. 원문 OCR은 결과에 남지 않는다.
- [x] [Cross-Check: 교차검증] 원문 OCR은 저장하지 않는다. 전화, 이메일, 사람 얼굴, 번호판을 필드에 남기지 않는다.
  `open cross-check clauses stay locked without new formulas`가 이메일, 얼굴, 번호판 필드를 `personal_data_forbidden`으로 거부한다.

소유할 경로:

- `backend/restaurant-crawling/scripts/06-frame-caption.py`
- `apps/web/lib/privacy/sanitize.ts`의 기존 차단 규칙

출력은 `detected_shop_name`과 `detected_branch_name`뿐이다. 빈 추출은 `null`이다. L1은 간판과 공식 자막에만 붙인다.

## Task 5: W004 명세된 1–5단계 질의만 생성한다

- [x] 완료. `naver_query_plan.py`가 1–5단계만 만들고, `10-rule-evaluation.py`는 exact 1–3단계만 검색한다.
- [x] [Cross-Check: 교차검증] 6–10단계 문구가 없으므로 그 번호의 질의를 만들어 실행하지 않는다. 4단계와 5단계는 후보 목록만 만든다.
  `test_query_plan_executes_only_exact_stages`가 4·5단계는 후보만 만들고 6단계 이상은 만들지 않는다.

소유할 경로:

- `backend/restaurant-evaluation/scripts/10-rule-evaluation.py`에 연결되는 질의 생성 모듈
- `apps/web/lib/evidence-engineering/constants.ts`의 `NAVER_QUERY_STAGES`

요청 간격은 고정 1.5초 폴링이 아니다. 일시적 429와 인증 차단을 구분한다. 캡차 우회는 넣지 않는다.

## Task 6: W005 영업·이전 자동 판정을 순수 상태 기계에 연결한다

- [x] 완료. `evidence_identity.py`를 `build_location_result`가 검색 실패 경로에서 호출한다. 자동 `closed_store`는 만들지 않는다.
- [x] [Cross-Check: 교차검증] 성공 위치는 독립 증거군 2개 이상이다. 광역 단계는 그 조건을 만족해도 자동 `supported`가 아니다. 검색 실패의 기본값은 `needs_review`다.
  `apps/web/tests-unit/evidence-engineering-foundation.test.ts`의 `exact stages need two families, and a complete closure record stays a candidate`와 `broad Naver stages and search misses never become closed_store`가 세 절을 잠근다.

소유할 경로:

- `backend/restaurant-evaluation/scripts/10-rule-evaluation.py`
- `backend/DATA_CONTRACTS.md`의 rule evaluation 행

레벤슈타인 거리와 150m 반경은 설명 값이다. 0.82와 50m는 컷오프가 아니다. 인허가 폐업은 원장 식별자, 사업장 주소, 유효일, 지점 구분, 갱신일이 있을 때만 `closure_candidate`다.

## Task 7: W006 관리표 반영을 검수 소유권과 분리한다

- [x] 완료. `review_ledger_import.py`는 수집 입력이 기존 검수 상태를 바꾸면 거부한다.
- [x] [Cross-Check: 교차검증] 수집 행 갱신은 검수 상태 삭제 권한이 아니다. 양방향 덮어쓰기는 하지 않는다.
  `test_collection_import_cannot_overwrite_review_status`가 승인→거절과 거절→승인 모두 거부한다.

소유할 경로:

- 관리표 가져오기 모듈. 검수 열은 읽기 전용 투영으로만 내보낸다.
- `restaurant_evidence_frames.moderation_status`는 관리자 경로만 변경

마스터 플랜의 양방향 동기화 문장과 합의록 A15가 충돌한다. 이 작업은 A15를 따른다.

## Task 8: W007 evidence_frames와 popularity 위성 테이블을 추가한다

- [x] 완료. `backend/supabase/migrations/20261017043000_evidence_frames_and_popularity.sql`만 추가했다. 호스티드 DB에는 적용하지 않았다.
- [x] [Cross-Check: 교차검증] `evaluation_results`에 프레임과 점수를 넣지 않는다. 식당 `updated_at`을 점수 갱신으로 바꾸지 않는다. Gemini SQL을 그대로 적용하지 않는다.
  `test_migration_does_not_cascade_or_force_source_observed`가 INSERT/UPDATE, `timestamp_ms integer`, `USING (true)`, `SOURCE_OBSERVED` 강제를 거부한다.

소유할 경로:

- `backend/supabase/migrations/`의 새 마이그레이션 파일 하나. 이미 적용된 마이그레이션은 수정하지 않는다.
- 기존 `restaurants.id` 타입과 RLS를 읽은 뒤 FK를 맞춘다.

`timestamp_ms`는 bigint다. `evidence_level`을 `SOURCE_OBSERVED` 하나로 고정하지 않는다. `ON DELETE CASCADE`는 보존 정책이 정해지기 전에는 넣지 않는다. 인기 지표의 공개 무조건 읽기는 넣지 않는다. 200행 RPC와 CAS는 SQL 본문을 확인하기 전에는 동작 변경을 하지 않는다. `hosted_apply`는 비인가로 유지한다.

## Task 9: W008 불변 스토리지 키로 WebP를 업로드한다

- [x] 완료. `upload-evidence-frame.ts`가 `buildStorageObjectKey`와 WebP 바이트, 콘텐츠 해시를 검사한다. 테스트는 가짜 스토리지 경계를 쓰고, 운영 스토리지는 호출하지 않는다.
- [x] [Cross-Check: 교차검증] 경로는 `{video_id}/{timestamp_ms}_{sha256 앞 12자}.webp`다. 초 단위 경로는 금지한다.
  `apps/web/tests-unit/evidence-engineering-remaining.test.ts`의 `uploads only the immutable webp key and refuses collisions`와 `evidence-engineering-foundation.test.ts`의 `seek URLs keep the canonical watch form and storage keys keep milliseconds`가 밀리초 키와 초 단위 경로 금지를 잠근다.

소유할 경로:

- 서버 전용 업로드 모듈. 브라우저에 서비스 롤을 두지 않는다.
- `buildStorageObjectKey`의 결과를 경로로 사용

`image_url`은 업로드 결과의 투영이고 정본이 아니다. 같은 키 충돌은 실패로 남긴다.

## Task 10: W009 관리자 프레임 검수 API

- [x] 완료. `app/api/admin/evidence-frames/route.ts`는 `requireAdmin` 뒤에 Preview, Confirm, Apply, Readback을 검사한다. 이 저장소에는 이 흐름의 로컬 저장 대역이 없고, 행 저장은 로컬 Supabase Docker 스택과 미적용 마이그레이션이 있어야 한다. Apply는 그 전까지 `persistence_unavailable`로 닫는다. 호스티드 DB에는 연결하지 않는다.
- [x] [Cross-Check: 교차검증] `requireAdmin` 이전에는 검수 상태를 바꾸지 않는다. 순서는 Preview, Confirm, Apply, Readback, Audit다.
  `open cross-check clauses stay locked without new formulas`가 POST 안에서 `requireAdmin` 다음 Preview, Confirm, Apply, Readback, Audit 순서를 고정한다.

소유할 경로:

- `apps/web/lib/auth/require-admin.ts`를 호출하는 `apps/web/app/api/admin/evidence-frames/route.ts`
- `apps/web/app/api/admin/audit-events/route.ts`와 같은 감사 기록 경계

오류는 고정 코드만 반환한다. 요청 본문, OCR, 제공자 진단문을 로그에 남기지 않는다.

## Task 11: W010 RestaurantDetailPanel 근거 프레임 캐러셀

- [x] 완료. `RestaurantEvidenceCarousel`는 승인된 간판·자막 프레임만 16:9로 보여 주고 상세 패널에 연결했다.
- [x] [Cross-Check: 교차검증] 공개 캐러셀은 승인 프레임의 아이디 합집합만 보여 준다. L3 합성 점수를 방문 증거로 보여 주지 않는다.
  `open cross-check clauses stay locked without new formulas`가 묶음 사이 `frame_id` 합집합에서 L3 합성을 뺀다.

소유할 경로:

- `apps/web/components/restaurant/RestaurantDetailPanel.tsx`
- 새 캐러셀 컴포넌트 `apps/web/components/restaurant/RestaurantEvidenceCarousel.tsx`

제목은 `이 맛집이 등록된 이유 (영상 속 실제 간판·장면)`이다. 카드 비율은 16:9다. 승인되지 않은 프레임은 공개 패널에 넣지 않는다.

## Task 12: W011 프레임 활성화 시 시크 URL로 이동한다

- [x] 완료. 캐러셀 링크는 `youtube_seek_url`이다.
- [x] [Cross-Check: 교차검증] 클릭 대상은 `youtube_seek_url`이다. 신원용 `youtube_link`에서 `t`가 잘린 주소를 프레임 시크로 다시 쓰지 않는다.
  `open cross-check clauses stay locked without new formulas`가 시크 URL을 클릭 대상으로 두고 `t`가 없는 시청 주소를 거부한다.

소유할 경로:

- `RestaurantEvidenceCarousel`의 활성화 동작
- 기존 `apps/web/lib/youtube-url.ts`

## Task 13: W012 일일 인기 점수 배치

- [x] 완료. `popularity_score_batch.py`는 감쇠와 방문 승수를 분리해 계산하고 단일 곱셈 점수와 티어를 만들지 않는다. 호스티드 DB에는 쓰지 않는다.
- [Cross-Check: 교차검증] 단일 곱셈 `S_i`와 선형 `0.2` 승수와 베이지안 리뷰 식은 쓰지 않는다. 고유 `video_id`만 센다. 티어 백분위 추정법을 배치 안에서 명시하고 shadow 비교 전에 운영 값을 덮어쓰지 않는다.
  `test_migration_does_not_cascade_or_force_source_observed`가 선형 `0.2`, 베이지안, 백분위 문자열이 배치에 없음을 고정한다. shadow 저장소는 명세에 없어 이 줄은 열어 둔다.

소유할 경로:

- `backend/`의 기존 배치 실행 경로. 요청 핸들러 안에서 돌리지 않는다.
- `restaurant_popularity_metrics`에만 기록

계수가 잠기기 전에는 `PROPOSED_DECAY_DEFAULTS.locked === false`를 유지한다. 재현되지 않은 상관계수를 게이트로 쓰지 않는다. 호스티드 프로덕션 직접 갱신은 하지 않는다.

## Task 14: W013 마커 외곽을 transform과 opacity로만 움직인다

- [x] 완료. 기존 핀 HTML 바깥에 `data-popularity-tier` 래퍼를 둔다. `will-change`와 `drop-shadow` 애니메이션은 없다. `markerType`은 바꾸지 않는다.
- [x] [Cross-Check: 교차검증] 마커당 WebGL 컨텍스트는 0이다. drop-shadow 키프레임과 무조건 `will-change`는 넣지 않는다. 지도 조작 중 애니메이션은 멈춘다. `prefers-reduced-motion`을 지킨다.
  `open cross-check clauses stay locked without new formulas`가 마커당 WebGL 컨텍스트 0을 고정한다. `marker wrapper stays on transform and opacity`가 나머지 모션 절을 잠근다.

소유할 경로:

- `apps/web/lib/naver-map-marker-visuals.ts`
- `apps/web/tests-unit/naver-map-marker-visuals.test.ts`

기존 `createIndividualMarkerHTML`의 내부 핀은 유지하고 바깥 래퍼만 추가한다. `MapMarker.markerType`의 `fire | star`를 인기 티어로 덮어쓰지 않는다.

## Task 15: W014 상세 패널의 실험 3D 배지

- [x] 완료. 기본 배지는 정적 WebP다. 파이어·무지개 티어는 지정된 경로를 그리고, 이미지 로드가 실패하면 깨진 이미지를 남기지 않는다. 실험 3D는 기본 꺼짐이다. 사용자가 켠 뒤에만 `Badge3DViewer`가 `three`를 로드하고, `PopularityBadge`는 `three`를 직접 import하지 않는다. 배지 호버는 `scale(1.15)`이고 모션 축소 설정에서는 확대하지 않는다.
- [x] [Cross-Check: 교차검증] 기본 렌더는 정적 WebP다. Three.js는 사용자가 켠 뒤 `next/dynamic`과 `ssr: false`로만 로드한다. 마커에는 로드하지 않는다.
  `open cross-check clauses stay locked without new formulas`가 `ssr: false`와 마커에 3D 뷰어가 없음을 고정한다.

소유할 경로:

- `apps/web/components/restaurant/` 아래 배지 컴포넌트
- 패널이 닫힐 때의 렌더러 해제

성능 기준선을 재기 전에는 3D를 기본값으로 켜지 않는다.

## Task 16: W015 정적 배지 에셋 계약

- [x] 완료. 배지 경로는 `badge_popular_fire_3d.webp`와 `badge_popular_rainbow_3d.webp`다. 이미지 파일은 생성하지 않았고, 없으면 이미지를 렌더하지 않는다. 15KB는 합격 수치가 아니다.
- [x] [Cross-Check: 교차검증] 필요한 파일은 파이어와 무지개 두 종류다. 바이트 수 15KB는 Thesis 목표이지 합격 수치가 아니다.
  `open cross-check clauses stay locked without new formulas`가 배지 종류를 파이어·무지개로 두고 15KB를 합격선으로 두지 않는다.

소유할 경로:

- `apps/web/public/assets/badges/`
- 에셋 파일명과 대체 텍스트를 묶는 상수

이미지 생성 호출은 이 작업의 자동 성공 조건이 아니다. 파일이 없으면 배지 자리는 비워 두고 깨진 이미지를 두지 않는다.

## Task 17: W016 폐업·이전 안내

- [x] 완료. `closure_candidate`와 검수된 `closed_store`/`relocated`만 안내한다. 링크는 상호명 검색이며 기기 좌표를 넣지 않는다.
- [x] [Cross-Check: 교차검증] 자동 판정의 `closure_candidate`와 검수된 `closed_store`, `relocated`만 안내한다. 검색 실패는 안내 배지가 아니다.
  `open cross-check clauses stay locked without new formulas`가 검수된 `closed_store`는 안내하고 검색 실패는 안내하지 않는다. `operational caution ignores a plain search miss and does not use device coordinates`가 `closure_candidate`와 검수된 `relocated`를 잠근다.

소유할 경로:

- `RestaurantDetailPanel` 상단 상태
- 네이버 플레이스로 이동하는 링크. 좌표를 사용자 기기 위치로 바꾸지 않는다.

## Task 18: W017 다중 방문 병합에 승인 프레임을 포함한다

- [x] 완료. `collectRestaurantMergedMedia`가 승인 프레임을 `frame_id`로 합친다. 더 높은 티어로 바꾸지 않는다.
- [x] [Cross-Check: 교차검증] 합집합은 `frame_id`다. 서로 다른 `computed_at`의 티어 중 높은 값을 고르지 않는다.
  `open cross-check clauses stay locked without new formulas`가 다른 `computed_at`의 더 높은 티어를 `mixed_scoring_cohort`로 거부한다. `merged media unions approved frames and does not promote a higher tier`가 `frame_id` 합집합을 잠근다.

소유할 경로:

- `apps/web/lib/restaurant-merged-media.ts`
- `apps/web/tests-unit/restaurant-merged-media.test.ts`

`youtubeLinks`, `tzuyangReviews`, `youtubeMetas`의 기존 병합 결과를 유지한다.

## Task 19: W018 모바일 렌더 측정

- [x] 완료. `summarizeRenderSamples`는 p50, p95, 50ms 초과 횟수만 계산한다. 60fps와 Paint 0ms는 합격 조건이 아니다. 기기 기준선 숫자는 기획서가 정하지 않아 임계값을 만들지 않았다.
- [x] [Cross-Check: 교차검증] 60fps 고정과 Paint 0ms는 합격 조건이 아니다.
  `apps/web/tests-unit/evidence-engineering-remaining.test.ts`의 `render summary records percentiles without a 60fps gate`가 두 절을 잠근다.

소유할 경로:

- `apps/web/tests/`의 기존 Playwright 경로 중 상세 패널과 지도에 해당하는 스펙
- 측정 항목은 p50, p95 프레임 시간, 50ms 초과 Long Task, 배지 전후 차이, 패널 반복 개폐 후의 메모리 추세, WebGL 컨텍스트 손실 복구, Reduced Motion, 키보드 이동

임계 숫자는 기준선이 생기기 전에 적지 않는다.

## Task 20: 마스터 플랜에만 있고 작업지시서 번호가 없는 Safe Area·레이지 이미지

- [x] 완료. 공개 카드는 `loading="lazy"`와 Safe Area 하단 여백을 쓴다.
- [x] [Cross-Check: 교차검증] 고해상도 프레임을 패널 오픈 때 한꺼번에 받지 않는다. 공개 카드는 저용량 표시용이고, 확대는 별도 요청이다.
  `open cross-check clauses stay locked without new formulas`가 공개 카드를 lazy로 두고 일괄 고해상도 수신과 확대를 분리한다.

소유할 경로:

- `RestaurantEvidenceCarousel`의 레이지 로딩과 모바일 Safe Area
- 데스크톱과 모바일 뷰포트의 기존 상세 패널 스펙

W019–W024 파일은 키트에 없다. 이 작업을 그 번호로 만들지 않는다.

## 하지 않는 일

- 쿠키, PO 토큰, 계정 세션으로 유튜브나 네이버 차단을 우회하지 않는다.
- 호스티드 프로덕션 DB에 이 작업 목록만으로 쓰지 않는다.
- 보존 기간, 법적 승인, 외부 접수 번호를 코드나 문서에 만들지 않는다.
- 재현 자료가 없는 Gemini 상관계수를 운영 실측으로 적지 않는다.

## 최종 검증

날짜: 2026-10-18. 이 절은 명령 결과만 적는다. 완료된 작업의 체크는 바꾸지 않았고, 목표 완료를 선언하지 않는다.

로컬 Task 13 교차검증은 `[x]`가 아니다. `origin/main`(`a3f34fbfa8b7e189a68478c861c071edd2f62066`)의 같은 줄은 체크되어 있다. 로컬 줄은 `- [Cross-Check: 교차검증] 단일 곱셈 S_i와 선형 0.2 승수와 베이지안 리뷰 식은 쓰지 않는다. 고유 video_id만 센다. 티어 백분위 추정법을 배치 안에서 명시하고 shadow 비교 전에 운영 값을 덮어쓰지 않는다.` origin/main 줄은 `- [x] [Cross-Check: 교차검증] 단일 곱셈 S_i와 선형 0.2 승수와 베이지안 리뷰 식은 쓰지 않는다. 고유 video_id만 센다. 티어 백분위 추정법을 배치 안에서 명시하고 shadow 비교 전에 운영 값을 덮어쓰지 않는다.`

이 체크아웃에 없던 테스트는 `tzudong-evidence-promote`에서 실행했다. 그 파일 블롭은 `origin/main`과 같다.

- `npm run typecheck:parity` (`apps/web`). 종료 코드 0. `diagnostics` 0. 통과.
- `bun test tests-unit/evidence-engineering-foundation.test.ts tests-unit/evidence-engineering-remaining.test.ts --timeout 30000` (`apps/web`). 종료 코드 0. 27 통과, 0 실패.
- `.venv/bin/python -m unittest backend/restaurant-evaluation/scripts/tests/test_evidence_follow_on.py`. 종료 코드 0. 6 통과, 0 실패.
- `node --test backend/restaurant-crawling/scripts/tests/test_evidence_frame_sampling.mjs`. 종료 코드 0. 9 통과, 0 실패.
- `bun test` 여섯 파일 (`evidence-badge-viewer-session`, `evidence-context-events`, `evidence-render-recorders`, `evidence-merge-tier-rule`, `evidence-panel-caution`, `evidence-cohort-shadow`, `--timeout 30000`). 종료 코드 0. 6 통과, 0 실패.
- `.venv/bin/python -m unittest backend/restaurant-evaluation/scripts/tests/test_shadow_percentile_tiers.py`. 종료 코드 0. 1 통과, 0 실패.
