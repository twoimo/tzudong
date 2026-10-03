# Sentry 연동 검증 · 2026-10-04

Next.js 브라우저·Node·Edge 예외 수집과 관리자 `운영 → 오류 모니터링`을 구현했다. 현재 소스와 로컬 검증 단계이며, 실제 Sentry 조직·프로젝트 생성, 환경 설정, 수집 readback과 보호된 운영 배포는 남아 있다. 기존 Google 로그인에는 연결된 Sentry 조직이 없었고, 새 조직 `tzudong`의 생성 후 변경할 수 없는 저장 지역 선택을 요청했다. 조직 생성은 아직 제출하지 않았다.

공식 [Next.js SDK 설정](https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/), [Webpack 설정](https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/webpack-setup/), [SDK 데이터 수집 옵션](https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/), [조직 오류 조회 API](https://docs.sentry.io/api/events/list-an-organizations-issues/)를 실제 설치 인터페이스와 대조했다. SDK `11.4.0`, Next `16.3.8`, Node `24.21.0`, npm `11.6.2`, Bun `1.4.0`이다. 기존 의존성 버전 변경은 0건이며 npm 정본과 Bun 잠금 파일의 직접 의존성 불일치도 0건이다.

`instrumentation-client.ts`, `instrumentation.ts`, Node·Edge 설정, 루트 및 세 구간 오류 경계, 최상위 오류 경계를 연결했다. SDK 11의 요청·쿠키·본문·사용자·DB 값·AI 입출력·큐 인자·프레임 지역 변수 수집을 명시적으로 껐다. 로그·추적·프로파일·리플레이·브레드크럼도 껐다. 최종 전송 이벤트를 허용된 오류 유형과 코드 프레임으로 다시 만들고 정본 개인정보 검증기를 통과시킨다. 실제 SDK의 메모리 transport 검사에서 예외 이벤트 1건과 민감 값 노출 0건을 확인했다. 실제 Sentry 네트워크 호출은 이 검사에 포함하지 않았다. 오류 원문이 생략되므로 오류 유형·스택 위치·그룹별 발생 횟수로 진단한다.

SDK 11에서는 이전 `autoSessionTracking: false` 옵션만으로 기본 `BrowserSession`을 막을 수 없음을 설치 소스에서 확인했다. 해당 통합과 BrowserTracing을 명시적으로 제외하고 추적 코드를 번들에서 제거한다. Node SDK의 원문 출력·프로세스 종료/경고 핸들러 두 개도 제외해 Next의 기존 프로세스 처리와 `onRequestError` 수집 경로를 보존한다. Next 요청 hook 밖의 프로세스 예외는 자동 수집 범위에 포함하지 않는다. 전송 hint의 첨부 파일을 비워 별도 첨부 envelope로 원문 OCR이 나가지 않도록 했다. 실제 Node SDK 기본 통합 검사에서 추가 프로세스 핸들러 0개, 실제 Chrome 154 브라우저 SDK의 메모리 transport에서 이벤트 1개·세션 0개·첨부 0개·그 외 항목 0개·합성 민감 값 0개를 확인했다. standalone 브라우저 증빙은 Next의 환경 shim을 포함한 합성 환경이며 운영 수집 증빙과 구분한다.

관리자 API는 `requireAdmin` 뒤에서만 실행하며 `private, no-store` 응답을 쓴다. 토큰은 서버에만 있고, 읽기용 `event:read` 토큰과 CI 소스맵 업로드 토큰을 분리한다. 조회는 미해결·해결됨·보류, 최근 발생순, 최대 50건과 커서를 지원한다. 원문 오류 제목·culprit·사용자·임의 provider URL은 반환하지 않는다. Sentry 상세 링크는 검증한 조직과 오류 ID로 서버에서 생성한다. 호스팅 origin은 공식 Cloud 지역만 허용하며 다른 자체 호스팅 주소는 별도 확인이 필요하다.

같은 구성·질의의 읽기는 한 프로세스에서 진행 중인 Promise와 30초 결과를 공유한다. 동시 동일 요청 100개 실험에서 모의 upstream 요청은 1회였다. 서로 다른 요청 8개 검사에서는 4개만 외부 작업에 진입했다. 429/503의 `Retry-After`는 조직별 쿨다운으로 상태·커서·토큰 변경에도 공유하고, 기다리는 요청을 쌓지 않고 연결 불가 상태를 반환한다. 이는 기능과 자원 경계 검증이며 운영 지연·금액 절감 측정이 아니다. 표본은 동일 요청 100개를 묶은 실험 1회이고 95% 신뢰구간은 계산하지 않았다. 캐시·동시성 제어는 서버 프로세스별이며 여러 인스턴스의 공유 한도를 증명하지 않는다.

자원 모델은 페이지 크기 \(k\le50\), 캐시 슬롯 \(c\le32\), 동시 읽기 \(p\le4\), 응답 원문 \(B\le1\text{ MiB}\)다. 응답 읽기 버퍼는 고정 크기로 할당하여 청크 개수에 따라 배열이 늘어나지 않는다. DTO 캐시는 \(O(ck)\), 원문 읽기 버퍼는 \(O(pB)\)이며 JSON 파싱과 SDK 자체 메모리까지 포함한 RSS 보장은 아니다. 요청 제한 시간은 8초이며 자동 재전송을 하지 않는다. 이벤트는 예외 5개·예외당 프레임 40개까지 보존한다.

전체 웹 검사는 **2,690 통과, 9 건너뜀, 실패 0**이다. 이후 두 파일의 읽기 버퍼·프레임 입력 제한·쿨다운 보완은 관련 11개 검사로 확인했다. TypeScript native/compat parity는 진단 0이며, Next 프로덕션 번들·생성 route 타입과 CSS 경계 검증이 통과했다. 자동 생성한 개인 preview tsconfig 경로와 Next 안내 블록은 해당 추가분만 제거했다. 진행 중인 검수 조회의 광범위 SELECT를 명시 컬럼으로 바꾸고, 보존된 storyboard SQL 증빙의 이동 경로를 교정하여 전체 검사에서 발견한 실패 두 건을 해결했다.

합성 데이터 렌더링은 390×844·834×1112·1440×960, 각 1회다. 세 폭의 가로 넘침은 0px, 페이지 오류 overlay는 0건이었다. 50건 첫 페이지 → 3건 두 번째 페이지에서 첫 ID 51과 페이지 표시를 확인했고, 해결됨 빈 목록도 확인했다. 브라우저 오류 버퍼는 비어 있었으며 첫 대시보드 진입의 기존 Recharts 크기 경고는 별도로 관찰했다. 이 결과는 실제 인증·Sentry 호출·운영 오류 수집 성공을 의미하지 않는다.

증빙은 `apps/web/performance/sentry-20261004/`의 JSON·독립 SHA256·세 화면 PNG다. 실제 오류 이벤트를 생성해 Sentry에서 같은 이벤트 ID를 읽고, 관리자 API가 그 그룹을 반환하는 확인은 조직·프로젝트와 읽기용 토큰 설정 후 수행한다. 소스맵 업로드는 별도 CI 토큰과 조직·프로젝트가 모두 있을 때만 켜며, 빌드 telemetry는 끈다. 보호된 `develop → data → main`과 현재 운영 SHA를 기준으로 한 롤백 확인 전에는 운영 반영을 주장하지 않는다.
