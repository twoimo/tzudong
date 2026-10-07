# 검색 요청과 모델 선택 후속 검증 · 2026-10-04

검수 검색의 서버 질의는 마지막 입력 후 250ms 동안 추가 입력이 없을 때 변경한다. 입력 표시·저장과 기존 legacy 검색은 즉시 반영하며, 저장된 검색 조건은 복원 시 서버 질의에도 함께 복원한다. 필터·정렬·딥링크 변경은 이 타이머의 대상이 아니다. 연속 입력 간격이 250ms 미만이면 검색 구간당 서버 질의는 1회다. 느린 입력에는 글자별 질의가 발생할 수 있고, 빠른 입력의 최종 조회 시작에는 250ms 대기가 추가된다.

실제 Next 화면과 Chrome 154, Node 24.21.0에서 8글자를 25ms 간격으로 입력하는 실험을 7회 수행했다. 각 구간의 검수 페이지 요청은 1회였고 최종 검색어는 모두 일치했다. 이전 화면의 요청·지연을 같은 실험에서 측정하지 않았으므로 전후 성능 개선율·금액 절감·95% 신뢰구간을 주장하지 않는다. 자료는 `apps/web/performance/ui-renewal-20261003/query-model-capability-20261004.json`과 독립 SHA256이다.

스토리보드의 사용 가능한 모델은 온라인 worker의 Gemini 소유·기능·허용 모델 ID로 정한다. 원격 모델은 디스크/상주 바이트 0과 `loaded=false`여도 허용한다. 제공되지 않는 Nano Banana Pro 옵션과 해당 모델의 새 프로젝트 생성은 차단한다. 이미 선택한 Pro가 사용 불가로 바뀌어도 모델을 자동 교체하지 않는다. 사용자가 Nano Banana 2를 선택하면 생성 가능 상태로 돌아오며, worker가 오프라인이면 다시 생성이 차단된다. 실제 화면에서 이 상태를 확인했고 운영 쓰기와 공급자 호출은 0회였다.

Security workflow는 `run_parallel_laaj.py`, `backend/utils/**`, `backend/restaurant-evaluation/scripts/**`의 변경에도 기존 재시작 검사를 실행하도록 trigger를 보완했다. 이전 필수 체크를 제거하거나 우회하지 않았다. 관련 pagination/Gemini 검사 14개, TypeScript native/compat parity 진단 0, targeted ESLint를 확인했다. UI 상태 검증은 모의 응답이며 운영 연결의 증빙이 아니다.

이 변경 전 `b8765c35` head는 Release·Promotion·Security, 두 번의 깨끗한 catalog replay와 비교, Linux/Windows npm/Bun 검사를 통과했다. 별도 Copilot code scanning quota 오류와 GitGuardian의 경고 2건은 남아 있다. GitHub annotation은 제공되지 않아 현재 경고를 오탐으로 단정하지 않는다. 새 head의 CI와 경고 상세 확인·보호된 승격·실제 서비스 readback은 별도 완료 조건이다.
