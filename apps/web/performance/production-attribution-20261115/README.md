# 운영 초기 탐색 원인 분리 — 2026-11-15 KST

이 디렉터리는 `https://www.tzudong.app/?__perf=initial-load`에서 읽은 숫자 전용 진단 화면의 **운영 브라우저 관측**을 보존한다. localhost fixture, Lighthouse 점수, 실사용 RUM, G003 측정과 다른 시리즈다. 과거 값이나 보이지 않는 값을 채워 넣지 않는다. 이번 시리즈의 field/G003 admission은 0이다.

## 먼저 고정할 것

`protocol.json`은 운영 baseline 전에 고정한다. 계측만 추가한 배포를 BEFORE로 사용하고, 같은 계측 코드를 유지한 최적화 후보를 AFTER로 사용한다. 각 phase는 정확한 Git SHA·tree·deployment·project와 별도로 확인한 provider/health identity를 보존한다.

브라우저가 정확한 viewport·CPU·network·cache 제어를 제공하지 않는 조건이다. 각 phase에서 **새 전경 탭으로 정확히 한 번의 warm-up 탐색**을 먼저 하고 ordinal 0으로 보존하되 채점에 넣지 않는다. BEFORE warm-up에서 실제 CSS width·height·DPR를 읽어 `cohort.json`에 고정하고, AFTER warm-up과 모든 측정 방문이 같은 값을 유지해야 한다. 이후 각 5회도 새 전경 탭의 `navigate`로 기록한다. 새로운 탭은 새 프로세스나 격리된 캐시를 뜻하지 않는다. 데스크톱만 비교하며 모바일·태블릿이나 cold-first-visit 결과라고 부르지 않는다. 첫 측정값을 본 뒤 느리다는 이유로 warm-up으로 바꾸지 않는다.

warm-up 한 번은 새 배포 파일을 한쪽 phase에서만 처음 접하는 차이를 일부 줄이기 위한 절차다. 모든 리소스가 캐시됐거나 전후 캐시가 같다는 증거가 아니다. 결과의 조건은 **운영 브라우저 재탐색·캐시 제어 불가**로 명시한다.

전후 각 5회가 계획된 표본이다. 화면은 탐색 시작부터 20초간 수집하고, 값을 고정하고 observer를 해제한 뒤 표시한다. 측정 중에는 탭 전환, 클릭, 키 입력, viewport 변경을 하지 않는다. 실패한 방문도 보존한다. 불완전한 표본을 반복해서 통과 5개로 갈아 끼우지 않는다.

## 지표 이름과 경계

- TTFB는 실제 운영 문서의 `responseStart - startTime`이다. 서버 내부 실행 시간과 같지 않다.
- FCP는 해당 문서의 paint entry다.
- `windowLcpMs`는 20초 안의 마지막 LCP 후보다. 사용자 세션이 끝난 뒤 확정한 field LCP라고 주장하지 않는다.
- controls/map 준비는 500ms 간격의 DOM 표본에서 처음 준비를 확인한 시각이다. 실제 준비보다 늦게 관측될 수 있으며 정확한 paint 시각이나 TTI를 대신하지 않는다. 비교에서도 500ms 이상 변화해야 절대 변화 기준을 통과한다.
- `completedWindowLongTaskExcessMs`는 20초 안에 완료된 긴 작업 각각의 `max(duration - 50, 0)` 합이다. Lighthouse TBT가 아니다. cutoff를 가로지르는 작업이 있으면 이 지표는 비교에서 보류한다.
- TTI는 이 관측 경로에서 `null`이다. 임의로 재구성하지 않는다.

캐시는 통제하지 않는다. ResourceTiming에서 알 수 있는 네트워크 전송·0바이트 전송·알 수 없음 수를 따로 기록한다. TAO로 숨겨진 cross-origin timing은 비용 0이 아니다. 캐시를 알 수 없다는 이유만으로 유효한 문서 TTFB/paint 관측까지 버리지는 않는다.

## 비교 판정

중앙값과 unscaled MAD를 계산한다. 감소 또는 증가가 최소 절대 변화량, 10% 상대 변화량, `2 × max(전 MAD, 후 MAD)` 초과를 모두 충족할 때만 작업 범위의 개선/회귀 기준 충족으로 표시한다. TTFB/FCP/window LCP의 최소 절대량은 100ms, 500ms 간격으로 관측하는 controls/map은 500ms, 완료된 고정 구간의 long-task excess는 50ms다.

전후 유효 5개씩이 아니면 `not-comparable`이다. MAD는 신뢰구간이 아니고, 이 판정은 통계적 유의성이나 코드만의 인과 효과를 증명하지 않는다. 모든 Before가 모든 After보다 앞서고 운영 데이터·CDN·외부 서비스·네트워크가 변할 수 있다. 불리한 방향도 함께 보고한다.

TTFB·FCP·LCP 세부 단계와 앱 단계는 **같은 방문의 timeline**으로 설명한다. 서로 겹치는 다운로드나 병렬 작업 시간을 더해 전체 로딩 시간이라고 하지 않는다. 따로 계산한 p75들을 합치지도 않는다.

## 근거 보존

진단 DOM에 표시된 JSON 원문을 그대로 저장한다. 공개 소스 식별자와 숫자·고정 enum만 허용한다. 원시 URL, header, cookie, credential, 사용자 식별자, DOM 텍스트·selector, provider 오류나 response payload는 보존하지 않는다.

원문과 bounded capture receipt, frozen protocol, cohort, phase source metadata를 SHA-256 artifact map에 묶는다. **map hash를 채점 전에 별도로 기록**한다. 최적화 선택 전에 baseline 근거를 먼저 봉인하고, 최종 map에서 같은 baseline 원문 hash가 유지됐는지 확인한다.

제공업체/health 확인은 별도의 배포 identity 확인이며 성능 표본이 아니다. 루트의 source/프로젝트/배포와 연결되지 않거나 숨김·입력·resize·redirect가 발생한 방문은 빠른 값이어도 유효 표본이 아니다. 실제 데이터·타일·marker·조작부·패널 준비가 20초 안에 끝나야 완전한 표본으로 인정한다.

기존 GitHub runner의 접근 차단을 재시도하거나 UA·proxy·IP·보호 설정을 바꾸지 않는다. 이 진단 화면은 정상 접근 가능한 운영 앱의 명시적 관측 기능이다.
