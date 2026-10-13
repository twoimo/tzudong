# 공유 SDK·관리자 재시도 후속 수정

최신 source는7a9b19b19416ce098f2f1a6fa5d36c8674b409b0, production build는J875HwIXEiKTund_tx7DG다. 실제 SDK 오류를 모의 지도로 숨기는 원래 수정에 더해, 한 소비자의 재시도가 다른 소비자의 오류도 해소하도록 완료 상태를 공유한다. 관리자 지도에도 재시도 버튼을 연결했다.

mounted consumer의 capture subscription은 unmount에서 해제한다. 완료된 script callback도 제거한다. lazyOnload의 예약은 소비자당 하나로 제한하고 실행 직전에 다른 소비자의 SDK 준비/요청을 재확인한다. shared completion과 unmount에서 idle/timer 예약을 취소한다. 기존2000ms idle deadline/fallback을 늘리지 않았다.

| 흐름 | 환경·표본 | 지표 | Before | After | 절대 변화 | 상대 변화 | 노이즈·CI | 판정 | 증거 |
|---|---|---|---|---|---|---|---|---|---|
| 단일 재시도/공유 소비자 | Chrome protocol, 오류 후 소비자2 | 두 소비자 복구 | 두번째 error 유지 | network/API없음 모두 ready | 기능 실패 해소 | 비율 계산 안 함 | 통계적 사용자 오류율 아님 | 기능 확인 | local-validation-v1.json |
| 관리자 오류 버튼 | 실제 leaf React UI/통제SDK,2오류 | 명시적 재시도 | 연결된 버튼 없음 | 두 오류 모두 복구 | 2경로 | 비율 계산 안 함 | 전체 authenticated admin 지도 검증은 아님 | UI 경로 확인 | source.patch |
| deferred request 공유 | idle callback을 통제한 Chrome,소비자2 | initial/retry 요청 수 | 기존관찰 timeout; 숫자 추정 안 함 | 1/1, 합계2; stub0 | 계산 안 함 | 계산 안 함 | 합성 protocol/lab만 | 기능 확인 | 13개 browser protocol 중 lazy case |
| unmount | Chrome protocol | 완료 구독/예약 | 일부 이전 예약 검사는 collateral 종료 | 구독0·미실행 예약0·요청0 확인 | 계산 안 함 | 계산 안 함 | natural memory guard 대체 아님 | 수명주기 확인 | local-validation-v1.json |
| 전체 앱 오류→실제 SDK | production HTTPS,CPU4/REST735,모바일·태블릿·데스크톱/독립4회 | 복구 성공 | 비교 가능한 전체 전후 표본 없음 | 4/4 | 계산 안 함 | 계산 안 함 | n=4, 성능 CI 아님 | 실제 SDK 복구 확인 | production-recovery-https-v4/summary.json |

Bun 관련57pass/0fail(브라우저13+admin source44), changed lint0, native7.0.2/compat6.0.2 parity0, production build/CSS gate 통과. 전체 최신 HEAD CI는 별도로 진행 중이다. 이전 HEAD green을 재사용해 병합하지 않는다. PR3198의 두 실제 리뷰 사항을 수정 후 해결 처리했다.

production4회 모두 요청2/stub0/지도생성1/actual SDK SHA802f8c5bb436eeb0014e0e8c72e7f675ae88e102766d2a923cd2c24c7eca74d1을 확인했다. page error0. 의도적 network-error의 console과 기존 Naver connect-src CSP가 남는다. 오류를 누락하거나 SDK 전체·field·물리 Galaxy 검증으로 확대하지 않는다. TLS는 localhost SPKI만 예외, remote TLS/production CSP 유지다.

새 harness를 이전 build plan에 잘못 연결한 실행2개는 browser 시작 전 SHA/BUILD_ID guard에서 거부됐다. 첫 수정은 runner가 아니라 plan을 변경해야 했으므로 잘못이었다. 원래runner/plan을 보존하고 정확한 새plan-v2/runner-v4로 실행했다. 그 검사와 결과를 삭제하거나 통과로 바꾸지 않았다. unit cleanup probe의 evaluate 문자열 오류와 prior lazy 테스트 timeout/브라우저 collateral 종료도 local receipt에 별도 분류했다.

메모리·렌더링·플리커의 전체 성과는 아직 입증하지 않았다. ../memory-https-baseline-20261013-v1/의 자연 A/A는 독립2회 큰 변동을 보였고 admission0이다. 이번 queue/구독 수정도 자연 상태의20%heap/15%latency guard를 별도로 재측정해야 한다. 픽셀 프레임·운영배포·field·실기기는 이 패킷으로 완료하지 않는다.

재실행: build-owned-v5.mjs after는 exact source SHA/runtime에 묶여 있다. 현재부동소스가다르면 새패킷으로복제하고 source binding을검증한다. production-recovery-https-v4.mjs는 새build-receipts와production-plan-v2를 검사한다. 기존 outputs는덮지않고 새디렉터리·label을사용한다. private TLS/.env는 저장소밖에서만사용하고 네 public settings만 RAM에서 전달한다.
