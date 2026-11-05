# 현재 위치 버튼 — 확인창 없는 직접 실행

앱 내부 `window.confirm`을 제거했다. 모바일·태블릿·PC의 버튼 옆에 위치의 지도 제공자 전달과 앱 미저장 안내를 미리 표시하며, `aria-describedby`로 버튼과 연결한다. 버튼을 누르면 기존 서버 readiness·일시적 권한 경계를 통과한 뒤 브라우저 위치 API를 직접 호출한다.

## 원인과 실제 수정

| ID | 판정 / 원인 | 수정과 검증 |
| --- | --- | --- |
| DL-01 | ACCEPT: 매 탭마다 앱 확인창이 반복됨 | `home-client.tsx`의 위치 확인창 제거, `DeviceLocationDisclosure.tsx`를 모바일·PC 버튼에 연결. 기존 빌드에서 dialog1회·GPS0회를 재현했고, 수정 빌드4화면에서 dialog0회·GPS1회 확인 |
| DL-02 | ACCEPT: readiness await 동안 pending 상태가 아니어서 중복 요청 가능 | 클릭 즉시 pending과 동기 요청 잠금 설정. 같은 이벤트에서3회 클릭해도 readiness1회, 취소 후 새 클릭은 정상 실행 |
| DL-03 | ACCEPT: 취소 이전 readiness/GPS 응답과 새로운 요청의 소유권을 구분하지 않음 | 요청 세대를 취소 시 무효화. 취소된 readiness는 GPS를 호출하지 않고, 오래된 GPS 오류는 새 요청을 취소하지 않음. 지도 모드 전환과 visibility 변경으로 재현·통과 |
| DL-04 | ACCEPT: 브라우저 테스트의 readiness 존재 여부 탐지가 import된 helper를 보지 못해 거부 검사를 skip할 수 있었음 | 해당 분기 제거. 실제 readiness가 unavailable이면 GPS/watch0회이고 버튼이 다시 활성화되는지 무조건 검사 |

위치 저장 정책, 승인된 Naver 경계, capability 만료, 위치 오차 반경, 지도 포커스, 위치→방향→해제 흐름은 유지한다. 앱의 확인창을 없앤 것이 브라우저의 위치 권한을 자동 승인했다는 뜻은 아니다. 브라우저 권한이 아직 허용되지 않았다면 해당 권한 요청이 필요하며, 수명도 브라우저별로 다르다. [MDN Geolocation API](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation_API#security_considerations)

## 검증

- 실제 전체 앱 `npm run build`와 route CSS 경계 검사 통과. 별도 산출물 `.next-device-location-20261021` 사용.
- TypeScript parity: 3,249개 입력, diagnostics0. 최종 변경 파일 ESLint 통과.
- 위치/개인정보 단위 검사21건, 모바일·PC 소스 계약13건 통과.
- 실제 빌드에서 Playwright7건 모두 재시도0으로 통과: 직접 실행과 사전 안내, readiness 거부, 중복 클릭·취소, 오래된 응답 격리, 권한 거부 후 재시도, 시간 초과 후 재시도, 방향 표시 해제와 watcher 정리.
- 320/497/768/1440px 모두 안내가 화면 안에 있고 필터를 가리지 않으며 가로 overflow가 없음. 각 화면에서 앱 dialog0회, readiness1회, 위치 조회1회. `responsive.json`과 `inline-*.png` 보존.

실제 사용자 GPS 대신 공개 도심의 합성 좌표, Naver SDK와 데이터 fixture를 사용했다. 실제 개인 위치, 브라우저 위치 권한 설정, 센서 권한을 읽거나 변경하지 않았다. 물리 기기 GPS 정확도·현장 속도·Safari 센서 권한을 검증했다고 주장하지 않는다. 속도 수치나 운영 성능 개선율도 새로 주장하지 않는다.

초기 빌드는 새 테스트의 Window 타입 단언 오류로 실패했으며 명시적 fixture 타입 단언을 수정한 뒤 통과했다. 첫 브라우저 실행은 테스트가 기존 최소 오차 반경12m를10m로 예상한2건과 토스트 중복 텍스트 선택1건으로 실패했다. 테스트 기대값/선택자를 바로잡은 뒤 전체7건이 통과했다. 원래 실패 로그·영수증은 `*-attempt-1*`로 보존했으며 제품의 위치 오차 정책은 바꾸지 않았다.

## 소스와 전달 경계

후보는 `/Users/twoimo/.codex/worktrees/badge-next-runtime-20261020/tzudong`, branch `codex/detail-header-bookmark-shape-20261021`, base `de62e9426ffd761c4be974a4ca670c034d98489e`다. `source-bindings.json`과 `source-snapshot.txt`에 이번8개 파일을 결속했다. 이전 해외 지도·상세 헤더·도장 수정과 원래 dirty worktree는 보존했다.

이 수정은 로컬 구현·검증 상태이며 새 커밋·PR·운영 배포는 하지 않았다. 기존 배포 완료 및 Nightly 상태를 변경하지 않았고 Nightly 전체를 재실행하지 않았다. 새 외부 연구를 전송하거나 외부 감사 완료를 주장하지 않았다. 이전 해외 지도 감사 대기열과 증거도 덮어쓰지 않았다. 이전 지도 bundle에는 이번 위치 UI delta가 없으므로 향후 최종 통합 검토/릴리스 전에 갱신해야 한다.

검사가 만든 tsconfig의 임시 dist include만 복원했다. 소유 테스트 서버18925는 PID·cwd 대조 후 SIGTERM으로 종료했다. 다른 서버·컨테이너·계정·탭과 예약은 대상으로 삼지 않았다.
