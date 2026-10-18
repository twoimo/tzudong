# 검증 범위와 원인

지도 compact 조회는 youtube_meta를 생략하고 전체·검색 조회는 포함한다. 기존 대표 선택은 publishedAt을 우선하므로 같은 병합 그룹에서도 대표 ID가 바뀔 수 있다. 기존 대표 ID로만 발행 등급을 조회하면 compact public-a/fire → full public-z/standard가 재현됐다. 기존 대표 이름·정렬·방문 데이터 선택은 보존하고, 공개 schema2에 검수된 멤버 집합을 명시해 어느 승인 멤버로 들어와도 같은 등급을 조회한다. 새 멤버·미승인 멤버·서로 다른 발행 등급이 섞이면 전체 그룹을 standard로 처리한다. 더 높은 등급을 고르지 않는다.

모바일 feed 등은 raw restaurant 행을 공유 상세 패널에 직접 전달하므로 목록 hook만 고치면 배지가 빠진다. 실제 공유 패널 JSX의 tier/key가 번들 발행 resolver를 사용하도록 바꿨다. 테스트는 실제 JSX prop 바인딩을 AST로 추출해 react/jsx-runtime과 resolver를 가진 VM에서 실행한다. 전체 상세 패널을 실제 데이터로 mount한 시험으로 표현하지 않는다. 현재 운영 발행 entries는 의도적으로 비어 있어 실제 식당의 fire/rainbow 활성화 검증은 아직 없다.

발행 인덱스의 승인 멤버 수를 M, 현재 병합 그룹 크기를 k라고 하면 모듈당 인덱스 구축은 시간/공간 O(M), 단일 행 조회는 평균 O(1), 병합 그룹 검사는 O(k)다. M≤5000, 직렬화 스냅샷≤512KiB, 식별자·버전·키 허용 목록을 강제한다. 현재 빈 스냅샷의 기본 해석은 O(1) 빠른 경로다. 이론적 상한이며 실측 UI 속도·메모리 이득은 주장하지 않는다. 새 네트워크 요청·무제한 쿼리 캐시·개인정보 수집은 추가하지 않았다.

배지 뷰어는 DPR2에서 CSS 크기가 의도한120×120이 되도록 하고, 모션 축소 시 반복 RAF를 예약하지 않으며, 포커스 복구·Escape 전파 차단·GPU 자원 해제를 처리한다. 구성요소 production harness 한 독립 브라우저 프로세스/버전, 모션별 한 context의220ms 관찰에서 모션 축소 RAF13→0, CSS240→120, 포커스 복구 false→true, 외부 Escape1→0을 확인했다. 보통 모션 RAF14→13은 노이즈를 평가하지 않았으므로 개선 입증 안 됨이다. 물리기기 FPS·배터리·전체 프로세스 메모리나 일반 지도 누수의 해결 근거로 쓰지 않는다.

256/512 투명 lossless 마스터는15KB를 넘는다. 실제 표시는40/80 WebP srcSet만 사용한다. 각 파일의 실제 바이트·알파·해시는 badge-asset-provenance-v1.json에 보존한다. 작은 파생본의 일부 가장자리 픽셀은 안티앨리어싱 알파가 남으므로 모든 파일의 테두리가 완전히0알파라는 주장을 하지 않는다.

실제 www 기준선은 새 익명 context3개(1440×900,834×1112,430×860)에서 SDK200, 지도 타일, 실제 클러스터/마커 선택, 상세 열기·닫기, 리뷰·도장·랭킹 제목과 공개 ranking RPC200을 확인했다. pageerror0/가로 overflow0이지만 console error는6/2/2였다. 추가1.5초 제한 관찰에서는 Naver nelo connect-src와 eval script-src 차단, announcements/ad_banners401이 확인됐다. 이유를 단정하거나 CSP/권한을 완화하지 않았다. 이 표본은 독립 사용자 표본이나 field 지표가 아니다.

기존 전체 목표의 메모리 guard, 물리 Galaxy Chrome·삼성 인터넷, 충분한 prospective field cohort, 전체 플리커 제거는 이번 승격으로 완료되지 않는다. 폰 없이 검증하라는 최신 사용자 지시를 지킨다. 성능 관측을 canonical admitted slice로 바꾸어 부르거나 CI/READY/health만으로 사용자 성과를 선언하지 않는다. 미패치 braces advisory와 미실행 외부 작업도 유지한다.
