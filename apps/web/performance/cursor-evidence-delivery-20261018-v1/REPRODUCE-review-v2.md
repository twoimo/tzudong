# 최종 수정 검증 재현

원래 REPRODUCE.md와 frozen pre-promotion-checkpoint-v1은 이전 단계의 증거다. 이 문서는 source3ea4448758e140ca4f571641f82803262e4c18db 검증을 설명한다. 보존된 root에 출력 파일을 다시 쓰지 말고 새 checkout/새 evidence 폴더에서 실행한다. 원본 dirty worktree는 변경하지 않는다.

- CI Node24.21.0 /npm11.6.2, 로컬 Node24.22.0 /npm11.6.2 /Bun1.4.0. npm lock이 설치 권위다.
- Chrome Headless Shell153.0.8010.12 (Playwright revision1243). 로컬 shell은 별도 PLAYWRIGHT_BROWSERS_PATH에 설치했다.
- 원본 ZIP hash와 Cursor composer는 local-validation-v1 및 실행 목표 문서에 연결되어 있다. source manifest의 파일별 hash와 Git tree를 대조한다.

1. apps/web에서 npm ci, 관련 Bun test(public-popularity-publication, badge-ui-lifecycle, use-restaurants-merge, evidence-engineering-remaining, naver-map-marker-visuals, naver-map-render-guard)를 실행한다. 전체 npm run test:unit의 21개 lane 원본과 결과 집계를 따로 보존했다. 로컬 3728pass/11skip/0fail이다. 필수 CI 결과와 혼동하지 않는다.
2. npm run typecheck:parity, 변경 TS 파일 ESLint --max-warnings=0, git diff --check를 실행한다. native7.0.2/compat6.0.2 parity를 유지했다.
3. TZUDONG_NEXT_DIST_DIR에 새 dist 이름을 주고 NEXT_PUBLIC_SUPABASE_URL=https://dependency-proof.supabase.co, NEXT_PUBLIC_SUPABASE_ANON_KEY=dependency-modernization-browser-proof-anon-key로 npm run build를 실행한다. 두 값은 합성 fixture이며 실제 인증 정보가 아니다. actual CSS verifier를 같은 dist에서 실행한다. Next가 추가한 자신의 named-dist tsconfig 두 줄만 복구했다.
4. 같은 fixture와 named dist에서 Playwright dependency-modernization.spec.ts의 chromium3개 흐름을 실행한다. 원래 REPRODUCE.md의 포트18118과 next start 명령에서 dist만 v2로 바꿨다. 포트 소유권을 먼저 확인한다. 이 검사는 외부 요청을 차단하는 전체 앱 production bundle 검사다.
5. badge-browser-v1/build.mjs를 Bun으로 실행하고 run-v3.mjs를 Node24로 실행한다. 실제 PopularityBadge/Badge3DViewer/Three를 production-mode 번들로 사용한다. viewport430x860, DPR2, normal/reduced 각각 새 context이며 software WebGL이다. 동적 chunk 요청, CSS120/buffer240, RAF 정지, focus/Escape, 반복 teardown, 진짜 context loss1회 복구 후 fallback, 실패 이미지 후 다른 restaurant/tier key 회복을 검증한다.
6. historical-badge-before-v1에는 1d7ed099의 변경되지 않은 UI 두 파일과 hash가 있다. 같은 방식으로 build.mjs/run.mjs를 실행하면 잘못된 CSS240·reduced-motion RAF·focus/Escape 결함이 재현된다. 같은 생성 이미지 fixtures로 뷰어를 열기 때문에 배포 당시의 이미지 없음 상태를 재현한 것은 아니다. v3 비교의 RAF 관측 창은220ms이며 screenshot은 밖에 둔다. 모드별 단회 관측으로 p95/신뢰구간·FPS·배터리·프로세스 메모리·전체 UI 개선율을 계산하지 않는다.
7. run-live-readback-v2.mjs의 before/after와 정확한 운영 SHA를 지정한다. 익명 새 browser context에서 실제 SDK와 지도 이미지, 리뷰/도장/랭킹 heading, 공개 랭킹 RPC200을 확인한다. before/after 콘솔 CSP/resource 건수도 숨기지 않는다. 생성된 결과는 SHA/기능 증거이며 field나 속도 성과가 아니다. run-public-assets-readback-v1.mjs는 공개 endpoint/40·80 WebP의 상태와 SHA를 별도 기록한다.

공개 snapshot은 unpublished/빈 entries다. 운영 인기 cohort나 private shadow의 점수를 승인·발행했다고 주장하지 않는다. 256/512 lossless masters는15KB 목표를 넘었고 실제40/80 파일의 바이트·alpha/hash를 provenance에 기록했다. 실제 페이지는 작은 파생본만 요청한다.

전화/계정/리뷰 작성·DB/Storage·DNS·유료 용량 변경은 하지 않았다. 원래 메모리20% guard, 물리 기기, prospective field 및 기존 미완료 목표는 별개다. 배포/승격/실제 URL 결과는 각각 별도 영수증을 확인해야 한다.
