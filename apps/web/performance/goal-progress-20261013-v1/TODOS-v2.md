# 실행 Todo — 최신 상태 / 이전 문서는 당시 관찰로 보존

전체 목표는 진행 중이다. 최신 사용자 지시에 따라 휴대폰 없이 검증하며 물리 Galaxy·삼성 인터넷 범위는 미검증으로 표시한다. 이전 승인 범위의 배포·운영 작업은 유효하다. 이전 Todo의 ‘예외 답변 없음’은 새 허가가 필요한 근거가 아니다. 현재 적용기의 실제 기술 gate와 protected delivery 절차를 따른다.

| 우선순위 | 구체적 작업 | 현재 증거 | 다음 완료 조건 |
|---|---|---|---|
| P0 | 실제 SDK 실패→stub 위장 제거와 접근 가능한 재시도 | hook7/7, production HTTPS4/4, 통합18/18 | PR3198 최신b94996e3의 모든 관련CI 확인·보호merge |
| P0 | develop→data→main 소스 전달 | develop 최신683f8975 통합·푸시; Release/Promotion Path green | 각 단계 중복PR 확인·정상merge·exactSHA receipts |
| P0 | 리뷰·미디어11단계 DB readiness | 기존 canonical successor가 develop에 도입됨; 별도Astra 후보는 중복이라 미통합 | 기존successor의 source/main·rollback·7writer fences·실측12stage rehearsal, held→ready protected source, 원래UUID readonly 재확인, 한 번apply·readback |
| P0 | 검증 사진 private 전환 | 이전8개/9.81MB byteplan·오류복구 tests 보존 | fresh reference/bytes·권한 확인 후 private copy 검증→public 제거→권한·캐시검증.503을거부로세지않음 |
| P0 | 128검색×2 메모리 회귀 해소 | HTTPS A/A2프로세스/512동작 완료; 종료31.72 vs42.08MB, 큰변동 | 보유·할당원인 좁히기→측정된후보→독립A/A4·A/B9쌍.20%heap/15%latency guard 유지 |
| P0 | SDK 수명주기·할당 진단 | 별도256동작/WeakRef164마커, postGC22.33MB;16동작CPU/trace17112events | detached DOM/리스너와 cache·React/SDK 보유 경로를 연결.강제GC로primary실패면제금지 |
| P0 | 네비게이션 검은 사각형·공백 플리커 | 기존수정·화면증거보존;이번최종주요flow frame검증부족 | N회픽셀타임라인·max공백·노출률·capture한계;normal/reduced motion |
| P1 | 검색·필터·정렬·마커·상세·뒤로·패널·스와이프 | 현재512합성입력/실제SDK동등성 확인 | 빈/대량2000·느린network·cache·viewport·비활성/복귀매트릭스 완성 |
| P1 | 랭킹·리뷰/도장 공통헤더·로고·timestamp·필터count | 소스/이전검증존재 | 최종운영SHA에서desktop/tablet/mobile 정상·실패·empty별재검증 |
| P1 | 쯔양 리뷰 일관성 전수검사와 수정 | Gemini3.8FlashHigh1659행분류,최소23초안;확인된운영commit0 | 현재분모/preimage와원문재확인·admin47보존·불확실69/408보류·각Preview/Confirm/Apply/Readback/Audit |
| P1 | 트랜지션·스크롤 모션 | 설치·소스전달/이전검증 보존 | final실서비스의reducedmotion·keyboard·cancel/reinsert·scroll상태검증 |
| P1 | Cloudflare무료범위/대용량파일 | 실제publicbrowser200,자동HTTP403분리 | 현재origin/cache/object·transfer/요청량·무료한도내운영확인.유료변경0 |
| P1 | prospective field v2 | 기존v1실저장확인/Chrome·삼성/tablet·visit분모없음 | 사전고정release·cohort/분모/지원누락·독립성/CI·최소표본·기간·중단기준.코드→전송→저장→조회→실사용평가각확인 |
| P1 | 운영배포와롤백 | 이전serving1884f87e/READY·실브라우저200 확인 | freshrollback/정확한main guard·READY·alias/assets·핵심동작readback;READY만성공금지 |
| P1 | 증거전달 | 이번canonicalzero scorer/validator pass,admitted0/releaseBlockedtrue | 원자료·실패·script·report·artifactmap·detachedpin·독립tamper검사·원격byte일치 |

판정: CSS조기import 후보는HTTPS정상baseline에서필요성이입증되지않아철회했다. IDpoolO(P)후보도미채택이다. 새로운 SDK기능수정과 메모리/field 성과를혼동하지 않는다. 실제기기검증을에뮬레이션으로채우지 않는다. source delivery와운영 DB·배포는서로다른gate다.
