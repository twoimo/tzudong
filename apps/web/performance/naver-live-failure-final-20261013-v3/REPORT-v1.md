# SDK 실패 표시·복구 검증

실제 SDK의 오류를 테스트용 지도로 숨기던 경로를 제거했다. 자동 재요청 없이 접근 가능한 재시도로 복구한다. 로컬 offline 테스트 모드는 유지한다.

| 흐름 | 환경·표본 | 지표 | Before | After | 절대 변화 | 상대 변화 | 노이즈·CI | 판정 | 증거 |
|---|---|---|---|---|---|---|---|---|---|
| 실제 hook 오류·재시도 | Chrome controlled protocol, 독립 시나리오 7 | 실패 사례 | 5/7 | 0/7 | 5 사례 감소 | 100% 감소 (해당 검사 수) | 통계적 사용자 오류율 추정 아님 | 기능 수정 확인 | ../naver-live-failure-state-20261013-v1/ |
| 전체 앱 오류→실제 SDK 복구 | production HTTPS, CPU4, REST735, 독립 브라우저 4 | 복구 성공 | 비교 가능한 전후 없음 | 4/4 | 계산 안 함 | 계산 안 함 | n=4; 성능 추정 아님 | 동작 확인 | production-recovery-https-v2/summary.json |

네트워크 실패 3개 viewport와 HTTP200/API 없음 모바일 1개에서 오류 표시, 관찰250ms 내 자동 요청 없음, 명시적 재시도 후 실제 SDK/타일/지도 생성1, 요청2, stub0을 확인했다. SDK SHA256은 802f8c5bb436eeb0014e0e8c72e7f675ae88e102766d2a923cd2c24c7eca74d1이다. 모바일·태블릿은 데스크톱 터치 에뮬레이션이다.

각 case page error0. 네트워크 고장 사례는 의도적으로 유발한 network console1과 기존 Naver connect-src CSP1을 기록했고, missingAPI는 CSP1이다. 남은 CSP 오류를 성공으로 숨기지 않았다. 기존 HTTP+CSP 실험의 자산 취소 실패는 ../naver-live-failure-integration-20261013-v2/에 보존했다. 정확한 저수준 원인은 미확정이며 HTTPS에서는 같은 앱이 복구했다.

초기 CSS 후보는 HTTPS 기준선 정상3시나리오/page0에서 필요성이 입증되지 않아 최종 소스에서 철회했다. ID 풀 재사용 후보 역시 미채택이다. 현재 PR3198는 develop 갱신을 통합했고 새 HEAD의 CI가 진행 중이다. 검사 SHA 결속 오류라는 초기 진단은 잘못이었고, 실제 merge 거부 이유는 strict 보호의 base behind였다.

이 패킷은 소스·빌드·브라우저 동작 증거다. 운영 배포, 물리 Galaxy, field 성과, 메모리 guard, 전체 플리커 제거를 증명하지 않는다. 빌드 출처와 현재 source 연결은 current-source-binding-v1/v2.json에 구분했다.

재실행: Node24.21.0, npm11.6.2, Next16.3.8, Playwright1.63.0, Chrome155.0.8059.40과 build-receipts-v8.json의 별도 production 산출물, 네 개 public runtime 설정, 허용 local HTTPS origin을 준비한다. production-recovery-https-v2.mjs를 실행한다. TLS 개인키는 저장소 밖에서 생성하며 지정 SPKI만 예외로 인정한다. remote TLS/production CSP는 유지한다. 기존 출력은 덮지 않고 새 패킷·출력 경로로 복제한다.
