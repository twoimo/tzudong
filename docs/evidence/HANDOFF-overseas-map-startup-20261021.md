# 해외 지도 표시 개선 인계 — 2026-10-21

소유 후보: `/Users/twoimo/.codex/worktrees/badge-next-runtime-20261020/tzudong`, branch `codex/detail-header-bookmark-shape-20261021`, base `de62e9426ffd761c4be974a4ca670c034d98489e`. 원래 `/Users/twoimo/.codex/worktrees/179f/tzudong`의 dirty 상태는 보존했다. 상세 헤더·도장 선행 변경도 그대로 남겨뒀다. 아직 새 커밋·PR·배포는 없다.

CSP의 OpenFreeMap origin 누락과 설치된 MapLibre6.11.2 worker/shared 모듈 제공을 수정했다. 식당 조회와 지도 준비를 분리했고 국가 전환은 canvas를 재사용한다. 모바일/PC intent preload, 청크 안내, 오류/느린 연결 안내와 재시도를 추가했다. OSM/OpenMapTiles 출처 및 worker LICENSE 원문은 유지한다.

검증 자료: `apps/web/performance/overseas-map-startup-20261021-v1/REPORT.md`. 497px5회 중앙값1599ms(1571–2107,MAD28); 320–1440px10회 모두5초 미만. 실제 OpenFreeMap 타일을 쓴 Next production fixture에서 후보13건 통과. 원본 baseline 관측 채널 오류는 raw에 보존하고2건 후속 검사로 확인했다. 실제 전체 앱 빌드·홈497/1440·TS parity3242입력/0진단·ESLint·관련 단위19건 통과. 실제 앱 worker/shared/LICENSE 응답200·원문SHA 확인. DB는 시작/초기화하지 않았다. 물리 기기·운영 망·실제 식당 핀 선택·Turbopack은 별도 미검증이며 상대 속도 개선율을 주장하지 않는다.

Artifact map SHA256: `0a1b4b209bb2698707d5e3d54bbcfdb8e2c5794d2bd1f5f62c8b69d3a8025725`. SHA는 이 문서와 별도 `.sha256`에도 기록했다. `verify-artifacts.py <이 SHA>`로 보존 바이트와 현재12개 소스 결속을 검증한다. 검증 결과는 이 디렉터리의 별도 validation JSON에 저장한다.

외부 감사는 실제 미전송이다. 준비된 delta bundle SHA256 `d0a61826ae75cccb95c76a362f20a6aeba8ad41fb99f050d080eca2bc0f85a28`. 공유 managed 예약 job `tzudong-overseas-de62e9426ffd-delta-20261021`, request `e3da7e53b57a5203b7a0f1bc`는 queued(exit75), FIFO 용량1/활성2/빈슬롯0. 다른 소유자의 연구와 대기 순서를 보존했다. 다음 실제 단계는 admission 허용 시 신선한 계정/모드/Deep Research/쿼터·GitHub 접근 관측, 준비된 질문 전송, 전문 보존과 finding 판정·수정·native 검사, Gemini 반대 감사와 GPT reverse다. 같은 예약의 입력과 source hash를 먼저 재검토하며 중복 전송하지 않는다.

운영 배포와 기존 Nightly 상태는 바뀌지 않았다. 해당 범위 감사가 완료됐다고 선언하지 않는다. 배포를 진행할 때는 별도 현행 release 지침과 보호 승격·exact-SHA·rollback readback을 적용한다. 기존 heartbeat를 재시작하거나 새 자동화/목표/채팅을 만들지 않았다.

소유18924/18925 임시 서버는 cwd/PID를 대조한 뒤 SIGTERM으로 종료했다. 사용자 IAB의 Network 진단을 해제하고 원래 국내 지도 선택을 aria-pressed=true로 읽어 확인했다. 다른 프로세스·컨테이너·계정은 대상으로 삼지 않았다.
