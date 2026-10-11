# 과거 GIF 인증 사진 미리보기

관리자 미리보기에서 과거 GIF가 404가 되고 표시 URL도 생성되지 않는 두 경로를 재현해 수정했다. 소유자·verification 용도가 확인된 기존 GIF는 관리자 표시 경로에서만 허용한다. 현재 업로드·편집·보상 삭제 경로와 Storage bucket 제한은 유지한다. 임의 URL·다른 소유자·food 용도·SVG·새 canonical GIF는 거부한다. 허용된 응답은 기존 바이트, private/no-store, nosniff, no-referrer를 유지한다. 관리자 인증이 DB·Storage보다 먼저 적용된다.

Source Before f72355616112c462708b76c3b091f13c1c264a45 → After b143ba4fc5747d4b26ddaea690861dcf82be3324. PR3193은 검토·현재 head CI 후 정상 merge되어 develop dd0c790be7ffc94a86f95126aa60019ded8ff9b7에 반영됐다. 소스·API fixture 검증 결과이며 운영 배포 또는 실제 관리자 GIF 픽셀 검증으로 확대하지 않는다. 운영 SQL/Storage/실사용자 변경0.

| 검증 | Before | After | 증거 |
|---|---|---|---|
| 과거 GIF 응답·미리보기 URL |12 pass/2 fail|관련28 pass/0 fail|legacy-gif-before-v1.log / legacy-gif-after-v1.log|
| 전체 web general+isolated |공유 dependency 경로에서 compiler 검증1 fail|3452 pass/11 skip/0 fail|legacy-gif-full-unit-v1.log / v2.log|
| 컴파일러 provenance |공유 node_modules 경로 미인정|별도 npm11.6.2 설치 후10 pass|legacy-gif-own-npm-ci-v1.log / legacy-gif-pin-rerun-v1.log|
| Targeted lint |—|0 diagnostics|legacy-gif-lint-v1.log|
| Native7.0.2/compat6.0.2 parity |—|0 diagnostics, initial3142/post-build3291 inputs|legacy-gif-parity-v1.log / v2.log|
| Production build |비정식 기본 Turbopack /_document 실패|정식 Webpack Next16.3.8 build+actual named-dist CSS gate pass|legacy-gif-build-v1.log / v2.log, receipts|

최종 build: .next-legacy-gif-review-v2 / qeT8F8h0nl6MoAMj4Zuwd / Node24.21.0. build는 source SHA/lock 실제 bytes와 연결돼 있다. 실패한 Turbopack 출력은 보존했다. post-build parity에는 보존한 generated build types가 포함되며 입력 수 차이를 소스 개선으로 해석하지 않는다. tsconfig의 두 generated include 추가만 검증 후 원래 source bytes로 돌려놓았다.

초기 raw build receipt의 serverKeyRead:false는 private 파일 bytes를 읽지 않았다는 증거가 아니다. runner는 기존 env 파일을 RAM에서 parse하고 네 가지 public 프로젝트 설정만 명시적으로 전달했다. 값은 출력/저장하지 않았다. legacy-gif-build-receipt-clarification-v1.json과 수정된 v2 receipt가 정확한 범위다. PR body 작성의 stdin encoding 실패도 보존했고 structured UTF-8 파일로 기존 PR을 갱신했다.

재현: source-binding-v1.json의 두 SHA를 각각 별도 checkout으로 준비하고 npm11.6.2 authority lock으로 자체 설치한다. Before에 after 테스트 두 개를 추가하면 해당 두 실패를 재현한다. After에서 private-review-verification.test.ts와 review-photo-url-security.test.ts, test:unit, run-typecheck.mjs --compiler parity를 pinned Node24/Bun으로 실행한다. 빌드는 npm run build의 정식 Webpack/CSS 명령과 새 TZUDONG_NEXT_DIST_DIR을 사용한다. build runner에는 기존 로컬 설정 파일의 경로만 있고 값은 없다. 경로는 새 checkout에 맞게 조정하며 private 값을 증거에 복사하지 않는다. source snapshot6개는 정확한 bytes/hash를 바인딩한다.

승격은 develop→data→main이며 이 파일의 merge 기록은 develop까지만 증명한다. 실제 운영 전후 개선율·latency·GIF 발생률 또는 field 성과를 주장하지 않는다. 휴대폰은 사용자 요청대로 사용하지 않았다.
