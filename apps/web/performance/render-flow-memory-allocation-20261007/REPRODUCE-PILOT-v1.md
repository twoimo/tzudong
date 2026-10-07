이 작업은 메모리 회귀 해결의 중간 실험입니다. 운영 성과나 기존 ca235 대비 회귀 해결을 선언하지 않습니다.

환경: Node24.21.0, Next16.3.6, Playwright1.62.1, 실제 Chrome154.0.8037.98, 390×844 터치 화면 재현, CPU4배 감속, 네트워크 무감속, 새 프로세스/컨텍스트, HTTP 캐시와 서비스워커 우회. 실제 Naver SDK·타일을 사용하며 REST735행과 Auth401은 합성 응답입니다. 물리 모바일은 0대이며 사용자 휴대폰 사용 중 보류 지시를 유지합니다.

기준 소스는91a2a629b784ea4fb89d522475921caa7152f1e5(운영 main ae177과 동일 트리), 후보는791795bccea2e1f57173ca33cd76de6444df9f46입니다. 실제 source tree, lock, build ID, 주요 파일 hash는 각 build receipt에 있습니다. 후보 변경은 map-render-guard.ts와 관련 테스트뿐입니다.

1. 현재 저장된 production build가 없으면 build-reproducible-signature-v1.mjs를 Node24로 실행합니다. TZUDONG_PERF_SOURCE_WORKTREE는 해당 Git 소스, PERF_BUILD_SOURCE_COMMIT은 정확한40자리 SHA, TZUDONG_PERF_DEPENDENCY_APP은 정확한 package-lock과 일치하는 기존 npm 설치 트리, TZUDONG_PERF_PUBLIC_ENV_FILE은 공개 빌드 설정3개가 있는 비공개 파일로 설정합니다. 공개 SDK 설정도 증거에는 저장하지 않습니다. 기존 build·출력 폴더를 재사용하거나 덮어쓰지 말고 새 label로 생성합니다.
2. 운영 대조 build의 원본 재현 스크립트와 receipt는 repository-quality-20261004에 있으며 frozen helper는 읽기만 합니다. signature-runtime-v1.mjs의 기본 baselineReceiptPath는 그 frozen 후보 build, candidateReceiptPath는 이번 후보 build입니다. 다른 label은 SDK_BASELINE_RECEIPT_PATH / SDK_CANDIDATE_RECEIPT_PATH를 지정합니다. 사용 중인3000 포트는 종료하거나 재사용하지 않습니다.
3. measure-warm-signature-v3.mjs <새-label>을 실행하면 ABBA4개의 새 Chrome 프로세스를 순차적으로 실행합니다. 각 프로세스에서60개의 종속 지도 away350ms/return1000ms 주기를 측정합니다. JS heap은 DOM ID 직렬화 이전에 읽으며 프로파일러는 켜지 않습니다. 마지막 측정 이후의 강제GC 값은 진단 전용입니다.
4. summarize-warm-signature-v1.py <label>로 프로세스별 중앙값·peak·endpoint와 프레임 관측치를 집계합니다. 표본 단위는 프로세스이며120개의 종속 주기를120명의 사용자로 계산하지 않습니다. 메모리20%, rAF p95 15% 회귀 허용치는 사전 고정됐고 이번 결과 후 변경하지 않았습니다. n2/버전이므로 모집단 CI·사용자 p95는 내지 않습니다. 프레임 차이0.1ms 미만 또는 기준선0이면 상대 개선율은 계산하지 않습니다.
5. diagnose-allocation-v2.mjs와v3.mjs는 HeapProfiler sampling64KiB에 수거된 객체까지 포함합니다. 이 estimated allocation은 retained heap/누수량이 아니며 성능 기준선에 넣지 않습니다. source-attribution-ast-v1.json은 public chunk basename·0-based line/column과 AST 호출/필드를 연결합니다. 전체 URL·문자열 literal·arguments·headers·body는 저장하지 않습니다.
6. verify-signature-values-interactions-v1.mjs는 실제 SDK/합성 REST로10개 동작과4개 trusted CDP 스와이프를 확인합니다. Chrome 모바일 재현일 뿐 실제 Galaxy·삼성 인터넷 검증을 대체하지 않습니다. QA경로로 field admission은0입니다.

이전20% warm endpoint 회귀 실패 및 Chrome154.0.8037.97의 A/A22.15% 변동은 보존됩니다. 이번 작은 matched-source pilot이나 측정 후 GC는 그 실패를 면제하지 않습니다. 현재 Chrome154.0.8037.98의 충분한 독립 반복·A/A와 original ca235 재대조, 실제 휴대폰·운영 재검증이 남습니다. 원본·frozen1770 artifact는 변경하지 않았습니다.
