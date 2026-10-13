# 사용자 지정 SDK 주소의 공유 복구

source9fba35f92b9b0f517d1f726461f38bc4a91e49e6, production build p1-IJ-04eZu5YFbWfLGje를 검증했다. 주입한 SDK script에 전용 소유 표시를 붙이고, 같은 selector를 초기 요청 공유·지연 요청 재확인·완료 관찰에 사용한다. Naver 기본 주소와 명시적인 offline stub을 유지하며 CSP, 인증, provider 설정은 변경하지 않았다.

| 흐름 | 환경·표본 수 | 지표 | Before | After | 절대 변화 | 상대 변화 | 노이즈·CI | 판정 | 증거 |
|---|---|---|---|---|---|---|---|---|---|
| 지정 주소/공유 소비자 재시도 | Chrome155 통제SDK,network/API없음2시나리오·소비자2 | 실패 사례 | 2/2 | 0/2 | 2사례 감소 | 해당 검사 수100%감소 | 사용자 오류율/통계적CI 아님 | 기능 수정 확인 | local-validation-v1.json,source.patch |
| 공개 앱 오류→실제 SDK | production HTTPS/CPU4/REST735,3viewport·독립4회 | 복구 성공 | 비교 가능한 전체 전후 표본 없음 | 4/4 | 계산 안 함 | 계산 안 함 | n=4, 성능CI 추론 안 함 | 동작 확인 | production-recovery-https-v6/summary.json |

관련Bun59pass/0fail(브라우저15+admin source44), marker URL baseline7a9b19b1의 지정주소 검사0pass/2fail, 수정본 targeted2pass. lint/type parity/production build/actual named-dist CSS gate 통과. 각 실제SDK case는 요청2/stub0/map생성1/page error0. network 고장3회는 의도적인 console1+기존 Naver connect-src CSP1, missingAPI는 CSP1이다. SDK SHA802f8c5bb436eeb0014e0e8c72e7f675ae88e102766d2a923cd2c24c7eca74d1을 확인했다.

사용자 지정 host는 sdk.fixture.test의 통제된 API protocol이다. 실제 다른 공급자 host의 인증·CSP·타일을 검증했다는 뜻이 아니다. default 실제Naver/타일 검사와 구분한다. 모든 viewport는 데스크톱 Chrome 실험이며 Galaxy/삼성 인터넷의 물리 검증으로 부르지 않는다.

최신 exact-head CI와 보호된 develop→data→main·운영배포는 별도 단계다. 이 패킷은 자연메모리 guard·전체플리커·field성과를 증명하지 않는다. 이전 source 및 실패/빌드는 v4/v5에 보존했다. 원래 두 버튼을 모두 누르던 검사도 별도 체크포인트로 남겼으며 최신 테스트는 버튼 하나를 누른다.

재실행은 pinned Node24.21.0/npm11.6.2/Next16.3.8/Playwright1.63.0/Chrome155, build receipt와production-plan-v6의 정확한source/build, 네 public settings, 저장소 밖 private TLS key가 필요하다. 기존 outputs를 덮지 않고 새 root로 복제한다. HTTPS는 localhost SPKI만 예외, remote TLS/production CSP는 유지한다.
