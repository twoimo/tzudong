# 투명 PNG·공통 헤더·필터·공개 폰트 전달 결과

검색창과 공통 헤더의 로고를 원본 투명 PNG에서 만든 129px PNG로 제공하도록 수정했고 운영 배포를 마쳤다. 실제 `www.tzudong.app`의 PNG 응답과 Chrome 154의 데스크톱·모바일·태블릿·가로 화면, 밝은/어두운 CSS 8조건에서 모서리와 가운데 빈 부분의 alpha0을 확인했다. 이 검사는 물리 Galaxy나 삼성 인터넷의 강제 다크 모드를 대신하지 않는다.

최종 main은 `3aebb1c6f446250fd49fceac5f1a4ccac2f5d8f0`, READY 배포는 `dpl_7A4fzTdQTHJ4b5qDPEyLihaKtjpG`다. 독립 www alias도 이 배포와 일치했다. 롤백은 `1ab5b7520357d56261a5961d8b10cdd235e12a99` / `dpl_G55TzNuyiMaUJPZ4tMBKiCpJjT3G`다. PR3100→3101 및 PNG 후속3103→이력 동기화3105→3104→3102를 보호 규칙과 현재 CI가 통과한 상태에서 병합했다. 승인 guard는 정확한 main SHA로 갱신했고 비활성화하지 않았다. 자동 Git 배포의 CANCELED 상태와 수동 재배포 요청·READY 확인은 별도 증거다.

| 흐름 | 환경·표본 수 | 지표 | Before | After | 절대 변화 | 상대 변화 | 노이즈·신뢰구간 | 판정 | 증거 경로 |
|---|---|---|---|---|---|---|---|---|---|
| 데스크톱 지도 필터 | 실제 HTTPS·1440×900·CSS2조건 | 폭 | 기존 소스175px | 실측152px | 모델 대비23px 축소 | 모델 대비13.14% | Before는 같은 조건의 브라우저 실측이 아님 | 요청 크기 확인, 속도 주장 없음 | live-ui-production-v1/raw.json |
| 모바일 지도 필터 | 실제 HTTPS·384×824·모바일 에뮬레이션·CSS2조건 | 폭 | 기존 소스 모델130.56px | 실측111.359375px | 모델 대비19.200625px 축소 | 모델 대비14.71% | 물리 폰 수치/모집단 CI 아님 | 크기·넘침0 확인 | 동일 raw |
| 태블릿·가로 필터 | 실제 HTTPS·768×1024·1024×768·각 CSS2조건 | 폭 | 기존 소스148px | 실측128px | 모델 대비20px 축소 | 모델 대비13.51% | 기기 population CI 없음 | 크기 확인 | 동일 raw |
| 필터 세로 크기 | 위8조건 | 그룹 높이 | 기존 소스 모델130px | 실측114px | 모델 대비16px 축소 | 모델 대비12.31% | 모델과 실측 구분 | 버튼32px·넘침0 | 동일 raw |
| 지역·카테고리 수량 | desktop CSS2조건 | 오른쪽 끝 차이 | 기존 사용자 그림에서 상이 | 실측차이≤1px | After 정렬 확인 | 계산 안 함 | 이전 픽셀 수치 없음 | 두 수량의 위치 일치 | 동일 raw |
| 투명 로고 | 실제 PNG HTTPS +8화면 | 모서리4·중심·빈 부분 alpha | 원본 WebP도 alpha 보유; 신고 원인의 완전한 규명은 없음 | 6지점 모두0, 직접PNG, 배경rgba0 | 전달 형식과 빈 부분 보존 | 계산 안 함 | CSS 다크가 삼성 강제 다크를 증명하지 않음 | 운영 PNG 투명성 확인 | live-ui-production-v1/*-logo.png |
| 검토 중 PNG 대안 축소 | 원본 PNG variant→최종 PNG·HTTP본문 | bytes | 89,915 | 24,213 | 65,702 감소 | 73.071% 감소 | 결정적 bytes 비교·사용자 지연 CI 아님 | 큰 원본 PNG를 그대로 배포하지 않음 | original-derived-png-http-readback-v2.json, live raw |
| 공개 폰트 전달 | 실제 www HTTPS·FontFace1회 | legacy route·로딩 | web public에11,420,784bytes | 307/no-store/0B→R2·FontFace loaded | web public 패키지에서11,420,784bytes 이동 | 시간 개선율 계산 안 함 | 실제 제품은 Pretendard 사용, Chosun 소비자 발견 안 됨 | 운영 호환 URL·CSP·폰트 로딩 확인 | live raw, ../cloudflare-free-tier-20261003/*readback*.json |

PNG bytes 감소는 검토 중 89,915byte PNG 대안과의 비교다. 이전 운영의 Next 최적화 이미지 전송량은 측정하지 않았으므로 운영 네트워크 절감이나 LCP 개선으로 바꾸지 않는다. 기존 원본 WebP는5,578bytes이고, 직접 PNG 제공은 더 큰 payload를 만들 수 있다. 원본 PNG·WebP·apple icon은 보존했다. 최종 파일은 original256PNG에서 Sharp0.35.4의129px nearest 파생으로 만들었고, 이름/sha256 `8d374bb803469959cb37a2f6193f177d063265d077f717de0dc6dcc64bc3a646`, 모서리·중심·빈 부분 alpha를 독립적으로 검사했다. 기존180px apple icon과128px 대안의 중심 alpha47/97/100은 거부 기록으로 남겼다.

공통 MapPanelHeader는 높이·제목·수량·32px 동작 버튼을 통일했다. 맛집 목록·상세/뒤로가기·리뷰·도장·랭킹·공지·설정·프로필의 로딩/실패 분기 및 관리자 허용/거부 헤더에 적용했다. 34개 계약/route 검사, UI 관련48개 검사, PNG 관련18개 검사, decoded alpha/hash/size 검사, lint·compiler parity와 exact committed production build 및 CI를 보존했다. 로컬 actual SDK/합성735 데이터에서 필터 선택·초기화·키보드 닫기·목록/상세·패널 전환을 검증했다. 실제 개인 프로필이나 관리자 mutation을 실행한 증거로 확대하지 않는다.

운영 UI의 pageerror는 관찰0이었다. console는8조건에서1~3개씩 관찰됐고 별도 2개 페이지 진단에서 Naver SDK 계열 POST의 CSP 차단 및 REST401을 확인했다. 원시 메시지·쿼리·헤더·본문은 보관하지 않았고 고정 분류/상태만 남겼다. SDK 통계 차단으로 분류된 항목도 모든 기능 오류가 없다는 증거는 아니며 보안 allowlist를 완화하지 않았다. 새 로고 검증의 navTop은 selector 불일치로 null이므로 이를 새 바텀 플리커 검증으로 사용하지 않는다. 바텀 사각형의 기존 수리/실기기 관찰은 이전 frozen packet의 자기 소스/캡처 한계에 귀속한다.

이 전달에는 실험 중인 marker-pool 및 모바일 marker retention 소스를 포함하지 않았다. 메모리 후보는 별도 native-memory-final packet의 cold A/A9쌍·A/B9쌍/735·2000 및 warm ABBA4 fresh process×60cycles에서 기존 회귀 허용치를 통과했으나 초기 표시 개선은 입증하지 못했다. warm JS heap의 반복 후 증가량과 물리 Chrome·최종 삼성·field 비교 미검증은 남아 있다. prospective collector는 운영 중이고 이전의13개 metric instances는13명이 아니며 비교 가능한 field 성과를 입증하지 않는다. Galaxy의 최신 transport 확인은0ready였다.

새 UI 결과를 이전 canonical memory scorer의 admission으로 재분류하지 않는다. 이전 frozen canonical scorer/validator와 detached pin은 보존하고, 이 보고서는 G003/field 개선을 주장하지 않는다. 후속 메모리 소스가 최종화되면 해당 source/measurement/health를 새 canonical 실행에 정확히 결속한다.
