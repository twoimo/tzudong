# 로컬 readiness 검증 재현

현재 소스는 codex/user-readiness-20261009의 미커밋 통합 작업이다. 운영 반영·전체 완료 증거가 아니다. 원본179f와 이전 실험 증거는 보존한다. 실제 기기 보류를 해제하지 않으며 운영 회원가입/리뷰/도장은 작성하지 않는다.

Node24.21.0/npm11.6.2/Bun1.4.0/Next16.3.6/nativeTS7.0.2·compat6.0.2/Playwright1.63.0 및 실행 당시 native Chrome을 사용한다. private .env와 node_modules/Next build는 증거에 넣지 않는다. 필요한 SDK/서비스 설정은 운영자가 별도로 제공한다.

apps/web에서 named dist `.next-user-readiness-v1`에 production build했다. 기본 .next를 읽는 CLI 대신 `verifyBuildRouteCssBoundaries({nextDirectory:'.next-user-readiness-v1'})`로 실제 빌드를 검사했다. Next가 자동 추가한 tsconfig named dist includes만 되돌렸다. browser-readiness-flow-v3.mjs는 새 Chrome context 세 개(390×844,820×1180,1440×900)와 합성 REST735/Auth401을 쓴다. OAuth/가입 POST는 로컬에서 가로채고 거절한다. 표시·callback next 전달 검증이며 실제 OAuth 완료/계정 생성 증거는 아니다. 본문의 인증 요청·식별자·사진·provider diagnostics는 저장하지 않는다. 실제 원격 SDK 요청은 허용하되 field/QA 수집은 제외한다.

```sh
PATH=/opt/homebrew/opt/node@24/bin:$PATH npm run typecheck:parity
TZUDONG_NEXT_DIST_DIR=.next-user-readiness-v1 PATH=/opt/homebrew/opt/node@24/bin:$PATH node node_modules/next/dist/bin/next build --webpack
PATH=/opt/homebrew/opt/node@24/bin:$PATH node performance/user-readiness-20261009/browser-readiness-flow-v3.mjs unique-run-label
```

스크립트는 출력 파일을 exclusive create하고 3000 포트 점유 시 기존 프로세스를 종료하지 않는다. 본인 server/browser만 종료한다. v1/v2의 JSON date sort unsupported query와 v1 false-result exit0 결함을 보존했다. v7 fixture가 JSON publishedAt.desc.nullslast를 offset/limit 이전에 처리하는지 Node 검사로 확인한 후 v3에서 10개 검사/unsupported0/page error0을 얻었다. 남은 console8(CSP4/미분류4)을 공개하며 오류0이나 SDK 픽셀 정상으로 확대하지 않는다.

exact engine: owned context colima-tzudong-catalog-20261007 / tzudong-ranking-clone-20261008 / networknone / portsnone / Supabase Postgres17.6.1.038 이미지. test_review_media_commit_cleanup.py는 새 고유 fixture DB를 만들고 검증 후 그것만 지운다. 기존 ranking_clone와 schema-only G0141963행을 보존했다. auth/profiles/reviews 원본 데이터0이며 fixture만 사용한다. 순수 PostgreSQL17.11 결과와 실제 운영17.6를 구분한다.

저장소 루트에서 다음의 owned container 모드로 6개 권한·원자성·legacy·private Storage 시나리오를 실행했다.

```sh
REVIEW_TEST_DOCKER_CONTEXT=colima-tzudong-catalog-20261007 REVIEW_TEST_DOCKER_CONTAINER=tzudong-ranking-clone-20261008 python3 -m unittest -v backend.supabase.tests.test_review_media_commit_cleanup
```

full schema-only `user_readiness_clone_20261009`는 ranking_clone을 TEMPLATE로 복제했다. nonsuper postgres의 실제 LOGIN으로 두 media migration이 각각 적용됐다. 표준 Storage owner/SET 권한false 자체를 차단으로 단정하지 않았다. 기존 Supabase supautils.policy_grants의 storage.objects 허용과 실제 local CREATE POLICY 성공을 확인했으며 전역 권한/config 변경0이다. G014 통합 세 번째 migration/strict catalog/전체 mandatory CI/hosted 적용·Storage8개 이동·보호된 승격·배포·readback은 아직 미완료다.
