# 랭킹 복구·페이지 헤더·리뷰 시간 표기 운영 전달

운영 `www.tzudong.app`에 main `f31904e6dca2d9b608259cf150c5d0894db0928e`가 READY로 배포됐다. 이 보고서는 이번 기능·표시 결함 수정의 증거이며, 전체 메모리·플리커·물리 Galaxy·field 목표의 완료 보고가 아니다.

| 흐름 | 환경·표본 수 | 지표 | Before | After | 절대 변화 | 상대 변화 | 노이즈·신뢰구간 | 판정 | 증거 경로 |
|---|---|---|---|---|---|---|---|---|---|
| 랭킹 첫 진입/재시도 | 실제 www, IAB390×844; 재현1회·복구1회 | RPC/화면 |404/PGRST202·오류 |200·19개 응답/첫15개 표시 |상태 전환 |0개 오류 기준 개선율 계산 안 함 |성능 통계/CI 미측정 |운영 기능 복구 |operating-ranking-retry-v1.json |
| 전체/월간/추가 목록 | 실제 www, 에뮬레이션; 각1회 |탭/표시/오류 |첫 조회 실패 |두 탭 정상·스크롤 후19개 |상태 전환 |미산정 |반복·기기 독립 표본 없음 |확인한 흐름 통과 |operating-ranking-periods-v1.json |
| 모바일 리뷰 제목 | 동일390×844; 전후 각1회 |CSS font/weight/높이 |14px/600/65px |20px/700/74px |+6px/+100/+9px |폰트 크기+42.86%; 성능 개선율 아님 |결정적 CSS 값; 성능CI 적용 안 함 |도장 페이지 스타일과 일치 |review-header-before-390.json, operating-headers-v2.json |
| 리뷰·도장·랭킹 헤더 |390/768/1440, 각3개 상태 |글꼴/넘침 |페이지별 스타일 차이 |페이지20/24px700·패널14px600 |스타일 일치 |미산정 |각 상태1회; 390도장 초기 미준비 표본 별도 보존 |9개 준비 상태에서 잘림/가로넘침0 |operating-headers-v2.json, operating-stamp-390-confirm-v3.json |
| 요청 식당 리뷰 본문 |실제 www390×844, 상세/스크롤1회 |내부[ts] 그룹 |원본4개·기존 표시4개 |원본4개 유지·표시0개 |표시−4개 |표시 그룹100% 감소; UI 성능 주장 아님 |단일 본문 관찰; CI 미산정 |운영 표시 수정 |operating-review-text-v1.json, operating-review-text-390.png |
| SDK 로드/상세 |실제 www, IAB1회 |SDK/이미지/오류 |이번 변경 전 동일 정량 실험 없음 |SDK Map 로드·pstatic 이미지73개·상세 준비 |미산정 |미산정 |SDK VERSION 속성 없음, 버전 미측정 |제한된 운영 SDK 확인 |operating-review-text-v1.json |
| 소유 작업 캐시 |Mac, 정리1회 |디스크 할당량 |2,256,646,144B |1,446,010,880B |−810,635,264B |−35.92% 작업폴더 할당량 |동시 외부 디스크 활동 때문에 전체 여유량 변화는 별도 |비활성 webpack cache만 회수 |storage-cleanup-v1.json |

랭킹 원인은 운영에 `read_public_profile_leaderboard_page`가 존재하지 않은 것이다. 함수는 기존100개 제한·커서·점수·UUID 정렬·7개 출력 필드를 유지했다. 호환되는 기존 함수는 원본 pg_proc 상태를 보존하고, 함수 본문/인자/결과/STRICT 등 계약이 다르면 거부한다. PG15와 PG16+ 역할 처리 경로를 구분했다. 실제 런타임 검사는 운영과 같은 Supabase PG17.6.1.038에서 수행했으며 전체 PG15/16 스택 실행 증거로 확대하지 않는다.

운영 적용 전후 회원 역할 해시와 기존 G014 검사 함수4개의 해시는 동일하다. anon/authenticated만 RPC 실행을 허용하고 service_role와 직접 profiles SELECT 차단을 유지했다. 소스 파일 버전은20261008084856이며, 관리 API가 기록한 실제 운영 ledger 버전은20261008124858이다. 두 버전의 대응과 정확한 SQL/본문 해시는 operating-sql-readback-v1.json에 있다. 다른 작업의 미적용 SQL3개는 실행하지 않았다.

헤더는 공통 MapPanelHeader의 page/panel 스타일로 구현했다. 리뷰·도장·랭킹의 모바일/태블릿은 도장과 같은 제목·설명·버튼 배치다. 데스크톱 사이드바는 공통 compact 스타일을 유지한다. MY의 기존 모바일 제목·설명도 같은 스타일 상수를 쓴다. 로그인 필요한 MY/관리자 화면의 운영 렌더링은 이번 익명 브라우저 검증에 포함하지 않았다.

시간 표기는 표시 계층에서만 제거했다. 문장·가격·영상 제목·발행일·원본 리뷰·편집 입력·방문 수 식별 의미를 보존했다. 관리자/제보/MY 읽기 요약도 같은 함수를 쓴다. 자유 형식 recommendation_reason은 제출 원문 그대로 보여 주며 내부 리뷰 fallback만 정리한다. 먼저 정리한 뒤 요약 길이를 자른다. 문자 길이L에 대한 선형 처리와 새 문자열 O(L)이며 장기 캐시를 만들지 않았다; UI 전체 속도 향상으로 주장하지 않는다.

소스 전달:3139→develop,3141 ancestry-only sync,3142·3143·3144 후속,3140 develop→data,3145 data→main. 모두 정상 보호 절차/정확한 head로 병합했다. 필수 Release/Promotion Path 통과와 검토 대화 해결을 각각 확인했다. force/admin 우회 없음. 운영 배포 dpl_HXG5n1x3k4E2PBA4Vf4pEvXcqfye, 원격 URL tzudong-niao9yn3r-twoimos-projects.vercel.app. www/루트/internal 별칭과 독립 www 조회 SHA가 일치한다. 루트는 www로 이동해200을 반환한다; HTTP x-tzudong-release 헤더는 제공되지 않아 해당 방식의 버전 확인은 미측정이다. 실제 자산 제공·렌더·상세·기간 변경은 별도로 확인했다.

로컬 검사:핵심 전체 unit2884pass/9skip/0fail. 추가 표시 코드 후 전체 suite도 통과했으나 실행 중 소스2개 변경이 있어 이를 최종 불변 HEAD 전체 실행으로 과장하지 않는다. 변경별 집중 테스트, lint, native7.0.2/compat6.0.2 parity, production build4회/CSS gate 통과. 원장/발행87개, 로컬 manifest/replay27개, 회복 probe3개 안전 검사 및 동일 probe의 실제 PG17 실행이 통과했다. CI nightly에는 missing-function 설정+hosted fixture+원상 롤백 검사를 연결했다; 추가한 scheduled workflow의 실제 실행 성공은 별도 미확인이다.

실패·범위:Catalog CI generate는 GitHub Docker CLI의 image inspect --platform 미지원으로 SQL 재생 전에 실패했다. 검사/digest/architecture gate는 약화하지 않았으며 이 CI 환경 문제는 남아 있다. 로컬 IAB home/detail ChunkLoadError도 보존했다; 파일과 전달 바이트는 동일했고 새 문서에서도 관찰했다. 운영 배포와 구성된 프리뷰에서는 관련 흐름이 확인됐다. Preview에 없던 기존 Development 공개 설정 두 개의 target만 Preview에 확장했고 값·타입은 유지했다. SDK 허용 도메인/보안 헤더/서버 비밀키를 변경하지 않았다. 프리뷰 Naver 인증 실패는 SDK 성공으로 세지 않았다.

TinyFish baseline run306a81d5-7e4a-4bff-9309-e7a6917e7192는 completed였지만 detail_loaded=false였다. 반환된0 marker/false error를 성공·field 증거로 채택하지 않았다. 요청12step/60s, 실제13step/82s로 서비스가 보고한 경계도 공개한다. 기존 잔액만 사용했고 top-up/auto-reload 변경/새 유료 용량 없음. 출력 schema 첫 거부는 실행 접수 전400이었다. 원문/계정/요청 본문/인증값/화면·영상 캡처를 받지 않았다.

관찰한 예는 범위 내 성공이며 오류 확률0/전체 플리커 제거/누수 부재/field 개선을 뜻하지 않는다. 물리 Galaxy는 사용자 사용 보류가 유지돼 신규 검증0회다. Chrome 에뮬레이션을 삼성 인터넷 실기기로 표현하지 않는다. 기존 메모리 후보PR3138과 frozen 근거는 별도이며 운영 배포에 포함되지 않았다. 역사적 warm endpoint+26.2% 실패와 불확실성을 면제하지 않는다. 실제 SDK 전체 반복·128검색 재방문·물리 두 브라우저·prospective field 표본 및 평가가 남아 전체 목표는 미완료다. 이번 상태에서 새로운 G003 performance admission은0이다.

롤백:배포 전 정상 앱 SHA ae1771af10df0ffe96ed09817d902e7aab9e8053/dpl_CJJfWDo5AioLmHRWDb5krkfQx1sX. 앱 롤백이 DB 함수를 삭제하지 않는다. 새 RPC는 이전 앱과 이미 실제 Retry로 호환을 확인했다. 되돌려야 할 새 DB 코드/권한만 별도 검토·회수하고 다른 applied SQL/사용자 행을 바꾸지 않는다. 롤백 후 www SHA·기본 지도/검색/상세/랭킹/권한을 다시 확인한다.

실행·원자료·예외는 REPRODUCE.md와 같은 폴더의 개별 vN JSON/log/PNG에 연결했다. 원문 개인 데이터와 인증값은 포함하지 않았으며 최초 과도한 헤더 캡처는 최소화하고 원래 해시만 별도 남겼다. 이전 frozen baseline과 원시 실패는 덮어쓰지 않았다.
