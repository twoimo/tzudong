# CMS 테이블 검증 · 2026-10-18

taste-skill의 dense-tiles 방향과 CMS 요구에 맞춰 맛집·제보·리뷰 목록의 정렬, 행 밀도, 검색/상태 도구, 상세 포커스를 정리했다. 최종 맛집 헤더는 1440px 한 행을 유지하고 834/390px에서는 모든 작업을 표시한다. 카드 내부의 가로 넘침 원인인 음수 margin을 제거했다.

| 목록 | 이전 행 높이 | 이후 행 높이 | 절대차 | 변화율 |
| --- | ---: | ---: | ---: | ---: |
| restaurants | 87.00px | 56.00px | -31.00px | -35.63% |
| submissions | 82.33px | 61.00px | -21.33px | -25.91% |
| reviews | 60.00px | 56.33px | -3.67px | -6.12% |

전후 viewport는 1440×960이다. 모듈별 독립 캡처 1회라 95% 신뢰구간은 산출하지 않는다. 같은 표의 행을 독립 표본으로 세지 않았다. 이전 증빙은 정확한 toolchain 전체를 기록하지 않아 수치는 레이아웃의 기술 통계다. 작업 속도·운영 성능·사용성 향상률로 해석하지 않는다.

최종 증빙은 `restaurant-header-final-cua.json`과 `restaurants-*-header-final.png`, `responsive-final-cua.json`의 1440×960 세 페이지다. 834/390px 헤더 컨트롤 모두 viewport 내에 있으며 내부 가로 overflow는 0이다. `interaction-cua.json`의 상세 열기, Escape 포커스 복귀, 외부 검색 포커스 보존, 검색·상태 초기화 11항목은 모두 true다. 자동 운영 이력·정책 열기도 확인했다.

`after-cua.json`의 9개 화면은 초기 수정 상태다. `restaurants-834-fixed.png` 등 중간 캡처는 태블릿 탭 잘림을 발견한 실패 증거로 보존한다. 최종 pass는 이름에 `header-final`이 있는 캡처로 판단한다. 20261016의 viewport 불일치 실험과 종전 fully-visible-row 계산은 개선 판정에서 제외했다.

검증은 합성 loopback fixture다. 실제 사용자 닉네임 로딩, 운영 승인·삭제, Gemini·Storage 호출, 배포된 전체 관리자 메뉴 검증은 증명하지 않는다. 맛집 자동 운영의 설정 비활성화는 판단 연결 미확인이라는 fixture 상태를 반영한다. 로컬 서버는 검증 후 중지했다.

`layout-summary.json`이 소스 바이트 해시와 한계를 기록한다. `artifact-map.json`과 분리 `.sha256`은 이 디렉터리 증빙의 무결성용이며 scorer 승인이나 운영 성과 영수증이 아니다.
