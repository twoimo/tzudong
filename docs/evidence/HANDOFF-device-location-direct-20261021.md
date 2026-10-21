# 현재 위치 직접 실행 인계

소유 후보 `/Users/twoimo/.codex/worktrees/badge-next-runtime-20261020/tzudong`, branch `codex/detail-header-bookmark-shape-20261021`, base `de62e9426ffd761c4be974a4ca670c034d98489e`.

앱 확인창 제거, 모바일/PC 사전 안내와 aria-describedby, readiness 시작부터 pending/중복 방지, 취소된 readiness/GPS 응답 세대 격리. 기존 메모리·Naver provider·capability·watcher·브라우저 권한 경계 유지. 브라우저 자체 위치 승인창은 별도다.

`device-location-direct-20261021-v1/REPORT.md`에 원인·수정·잔여 조건을 연결했다. 실제 이전 빌드에서 dialog1회 재현, 새 실제 빌드의320/497/768/1440px에서 dialog0·위치조회1회 확인. 개인정보/위치 단위21, 모바일/PC 소스13, 브라우저7(재시도0), 전체 앱 빌드·CSS경계·TSparity0진단·ESLint 통과. 초기 테스트 타입/기대값 오류는 원래 로그와 함께 보존했다. 실제 개인 GPS·운영망·물리기기/Safari 센서 성능은 미검증.

Evidence map SHA256 `8b461c51ca0a6866e5d5ddde47b857dc404b16bf3eac753064d0692343f00246`. 별도 .sha256 및 validation JSON 참조. 이번8개 소스의 현재 바이트와 snapshot을 포함한다. 이전 해외지도 성능 증거는 덮어쓰지 않았으며, 그 이전 bundle에는 이번 위치 UI 변경이 없으므로 다음 통합 감사/릴리스 전에 최종 소스를 갱신해야 한다.

운영 배포·새커밋/PR·Nightly전체실행·새외부연구는 하지 않았다. 기존 배포/Nightly와 감사 큐는 보존했다. 원래 dirty worktree·다른 프로세스/컨테이너·탭/계정도 보존. 소유18925 서버만 cwd/PID대조 후 SIGTERM 종료했고 생성된 tsconfig include만 복원했다. 후속 운영 배포는 별도 현행 release 절차와 권한에 따른다.

초기 실패 JSON에서 로컬 테스트 환경·bypass metadata를 제거했고 artifact map의 sanitization이 이전 hash와 연결한다. 제품/시험 결과는 바꾸지 않았다.
