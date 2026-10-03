# UI·공개 자산 검증 진행 기록

지도 필터 축소·패널 헤더 통일·투명 PNG 직접 제공은 실제 Naver SDK를 사용한 production 빌드에서 확인했다. 이 기록은 로컬 렌더링 증거이며 새 운영 배포 완료를 뜻하지 않는다. 초기 폰트 config redirect는 실제 응답에 no-store가 없어 채택하지 않았고, 명시적 GET/HEAD route로 수정했다.

| 흐름 | 환경·표본 수 | 지표 | Before | After | 절대 변화 | 상대 변화 | 노이즈·신뢰구간 | 판정 | 증거 경로 |
|---|---|---|---|---|---|---|---|---|---|
| 데스크톱 필터 | Chrome·1440×900·CSS 2조건 | 폭 | 소스175px | 렌더152px | 소스 대비23px 축소 | 소스 대비13.14% | Before는 동일 브라우저 실측 아님 | 요청한 축소 확인, 속도 주장 없음 | responsive-ui-v9/raw.json |
| 모바일 필터 | Chrome 에뮬레이션·384×824·CSS 2조건 | 폭 | 소스130.56px | 렌더111.359px | 소스 대비19.201px 축소 | 소스 대비14.71% | 물리 기기 수치 아님 | 요청한 축소 확인 | responsive-ui-v9/raw.json |
| 태블릿·가로 필터 | 768×1024·1024×768·각 CSS 2조건 | 폭 | 소스148px | 렌더128px | 소스 대비20px 축소 | 소스 대비13.51% | 기기 population CI 없음 | 요청한 축소 확인 | responsive-ui-v9/raw.json |
| 필터 세로 크기 | 위 8개 화면 | 그룹 높이 | 소스130px | 렌더114px | 소스 대비16px 축소 | 소스 대비12.31% | Before 모델과 실측 구분 | 버튼32px·넘침0px | responsive-ui-v9/raw.json |
| 지역·카테고리 수량 | desktop CSS 2조건 | 오른쪽 끝 x | 이전 그림에서 상이 | 두 값 모두533px | After 차이0px | 개선율 계산 안 함 | 픽셀 정렬 확인 | 정렬 일치 | responsive-ui-v9/raw.json |
| PNG 로고 | 8개 화면·원본256px | 모서리 alpha | 원본 WebP도 alpha 보유 | 직접 PNG·alpha0·배경rgba0 | 형식 변환 경로 제거 | 배수 계산 안 함 | 삼성 인터넷 강제 다크 미검증 | 로컬 투명성 확인 | responsive-ui-v9/*-home.png |

34개 관련 계약/route 검사, UI 관련48개 검사, lint와 compiler parity가 통과했다. marker-pool 실험 소스는 UI 커밋에서 제외했다. 범용 헤더의 실제 식당 목록·상세 닫기·리뷰·도장·랭킹·공지 및 필터 선택/초기화·키보드 닫기 흐름을 확인했다. 관리자 mutation이나 실제 개인 프로필을 브라우저에서 실행한 증거로 확대하지 않는다.

V6의 dark 표기는 OS 색상 요청뿐이었다. V7 class 주입은 script 치환 불일치로 실행되지 않았으며 guard 추정은 폐기했다. V9는 실제 root dark class와 배경 rgb(28,25,23)을 확인한 CSS 분기 검사다. 사용자 브라우저 설정이나 제품 theme 동작을 변경하지 않았다.

로고 PNG는89,915bytes이며 기존 원본 WebP는5,578bytes다. 이것은 원본 파일 크기의 차이이고 최적화된 이전 브라우저 전송량과 직접 비교한 값이 아니다. PNG 요청은 format/alpha 보존을 위해 최적화 변환을 건너뛴다. 실제 사용자 입력 지연·field LCP 개선을 이 UI 검사만으로 주장하지 않는다.

배포 대기: PR3100의 이전 CI 실패는 공통 헤더로 이동한 CSS/접근성 이름을 예전 개별 컴포넌트에서 찾던 source assertions다. 수정된 bca48572 소스의 CI와 새 font route production 응답 검증이 필요하다. Galaxy ADB는 끊겼으며 기존 포트와 mDNS 발견이 모두 실패했다. 현재 접속 주소/USB 재연결 질문이 대기 중이다.
