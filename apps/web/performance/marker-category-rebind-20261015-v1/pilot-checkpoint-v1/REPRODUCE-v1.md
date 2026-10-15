# 재현과 증거 범위

이 폴더는 진단 체크포인트다. 실행 중인 자연40프로세스 표본·상태·최종 통계는 포함하지 않는다. 부모 폴더의 MEASUREMENT-PLAN-v2.json, protocol-inputs-v2.json과 별도 실행 결과를 사용한다. 기존 파일은 덮어쓰지 않는다.

1. 별도 checkout에서 Before275fb4bedcaabfe151658acebeaf4611d9db9115와 After1ec703840670c922dbccc661c1efdd10ad257cdb를 확보한다. 원래 사용자 worktree를 reset/stash/clean하지 않는다.
2. Node24.21.0/npm11.6.2, release package-lock, Bun1.4.0 및 Chrome155.0.8059.40을 사용한다. 환경·브라우저가 다르면 새로운 조건으로 분리한다. npm ci 후 정확한 Next16.3.8을 확인한다.
3. build-v1.mjs/build-v2.mjs의 owned root와 공개 런타임 설정 파일 경로를 자신의 격리 checkout에 맞춘다. 스크립트는 환경 파일을 RAM에서 읽고 네 가지 NEXT_PUBLIC 값만 전달한다. 서버 secret·Sentry DSN·토큰은 전달하거나 저장하지 않는다. 실제 Naver client-ID의 localhost 도메인 사용 권한은 별도 준비한다.
4. localhost/127.0.0.1 SAN이 있는 테스트 전용 TLS인증서를 private runtime cache에 만든다. 스크립트의 task TLS경로를 맞추고 파일 권한은 key0600/cache0700으로 유지한다. 시스템 신뢰 저장소는 바꾸지 않는다. 원본 키는 이 증거에 없다. 역사적 인증서는2026-10-16만료이므로 만료 후에는 새 실행에 자신의 인증서를 쓴다.
5. source Commit을 고정하고 각 named dist를 build-v1.mjs baseline <40자리SHA>, build-v2.mjs candidate <40자리SHA>로 만든다. 기존 dist가 있으면 덮어쓰지 않는다. build-receipts와 모든 원본 blob/hash를 검증한다. 각 dist의 BUILD_ID·lock·source hash·실제 CSS gate가 일치해야 한다.
6. 포트3000/3003을 기존 사용자 작업이 사용하지 않는지 확인한다. 실제 SDK 호출이 승인된 환경에서 diagnose-boundary-v2.mjs baseline <새label> 64 1 및 candidate <새label> 64 1을 직렬 실행한다. source root가 둘이면 receipt.root를 각각 맞춘다. 원래 label과 raw는 보존한다. SDK hash·fixture query·기능 동등성 오류가 나면 중단하고 실패를 보존한다. SDK를 stub으로 대체하지 않는다.
7. 자연 비교는 별도 폴더에 기록된 고정40실행 순서를 사용한다. measure-natural-v2.mjs에는 HeapProfiler/강제 GC가 없으며 각128검색×2회, 독립 Chrome/server 프로세스, 동일 CPU/viewport/cache 조건을 유지한다. 동작 실패 시 자동 재시도하지 않는다. run-natural-v2.mjs는 기존 상태가 있으면 거절하고 중단 신호를 체크포인트한다.
8. 전체40회가 끝나야 analyze-natural-v2.mjs와 validate-natural-v2.py를 실행할 수 있다. 20,000회 paired bootstrap으로 종료·idle heap20%/선택지연15%의 95%상한을 평가한다. within-run p95를 독립 사용자 모집단 p95로 부르지 않는다. A/A 노이즈는 면제 근거가 아니다.

canonical-zero-v1의 basis.json에 실제 scorer·validator 명령과 pin이 있다. 재실행은 이 폴더를 새 임시 위치에 복사해 새 output 경로를 사용하고, 원본 raw/scored와 hash를 유지한다. admitted0/releaseBlocked=true는 의도적으로 보존한 결론이다. canonical budget에는 memory metric이 없어 별도 메모리 검증을 대신하지 못한다.

독립 파일 검증은 repository docs/evidence/verify-marker-category-pilot-20261015-v1.py를 실행한다. detached map SHA도 같은 디렉터리에 있다. snapshot·쿠키·headers·localStorage·실제 Supabase 응답·private key는 포함되지 않는다. raw.json은 합성 fixture·구조 집계만 포함한다.
