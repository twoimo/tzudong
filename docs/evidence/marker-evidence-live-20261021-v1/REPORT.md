# 실제 마커 불 효과·근거 프레임 연결 결과

소스 기준: `13ded67a820549ae51f5b966104bf900c22aeb1a`. 계획은 [PLAN.md](PLAN.md)를 따른다.

## 공개 데이터

- 인기 등급: `video-views-20261021-v1`. 승인 식당 그룹 735개 중 fire 36, rainbow 71, standard 628. 지도별(국내/해외) 연결 영상 최다 조회수의 nearest-rank P95/P85 기준이며, 조회수는 2026년 6–7월 수집값이다. 맛 평가가 아니라는 문구를 상세 배지에 표시한다. 근거: [popularity-cohort-evidence.json](popularity-cohort-evidence.json).
- 근거 프레임: 4개 식당, 12장(모두 `on_site_scene`, L1 신원 증거로 승격하지 않음). WebP는 `apps/web/public/evidence-frames/`에 불변 키로 두고, 운영 `restaurant_evidence_frames`에 12행을 적재한 뒤 readback이 정확히 일치했다([live-frame-readback.json](live-frame-readback.json)). 승인 식당 763개 대비 프레임 커버리지는 4곳이다.

## 이번에 고친 문제

- 해외 링크(`?restaurant=…&mapMode=overseas`)가 모드 전환 초기화에 밀려 상세가 닫히고 지역이 헝가리로 고정되던 문제. 운영에서도 재현됐다. 상세 식당이 새 모드에 속하면 유지하고 그 도시 지역으로 맞춘다.
- 선택된 국내 마커의 `z-index: 100`에 불꽃이 가려지던 문제. 마커 래퍼를 격리하고 불꽃을 마커 위에 올렸다.
- 상세 배지의 설명과 `3D 보기`가 스타일 없이 흩어지던 배치.
- 불꽃 키프레임의 `0.82`가 미채택 cutoff 금지 검사에 걸리던 문제.

## 검증

- 단위 테스트 전체 통과, `typecheck:parity` 통과(진단 0), 변경 파일 ESLint 통과, 프로덕션 빌드와 route CSS 경계 검사 통과.
- 실제 운영 데이터를 읽는 로컬 프로덕션 빌드(`localhost:3000`, 실제 Naver SDK 인증)에서 PC 1440·태블릿 820·모바일 390 viewport를 확인했다. 9개 조합 모두 프레임 3장 decode, 국내/해외 fire 마커와 불꽃 1개, 오류 경계 없음. 결과: [viewport-verification.json](viewport-verification.json), 화면: [screens/](screens/).
- 물리 기기 검증과 운영 배포 확인은 이 로컬 검증에 포함되지 않는다.

## Nightly

Nightly 상태는 [nightly-status-separate.json](nightly-status-separate.json)에 별도로 둔다. 이번 배포 결과와 합산하지 않는다.
