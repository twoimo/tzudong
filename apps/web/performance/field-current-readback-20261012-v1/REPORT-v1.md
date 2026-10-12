# 운영 field 저장 재확인

2026-10-12T12:46:07Z(한국21:46:07)에 현재 서빙1884f87e53c4567ead7c9a0fb394b09b91a70396의 기존v1 집계 테이블을 읽기 전용으로 조회했다.17 histogram행,CLS6·INP6·LCP10개 metricinstance가 저장돼 있다. device별metricinstance는mobile19/desktop3, 관측일은UTC2026-10-12다. 실제 데이터가 저장됐음을 확인했지만22명의 사용자 또는22독립세션을 뜻하지 않는다.

현재 수집 경로는mobile/desktop·metric·navigation·bucket·release·observed_day 집계만 유지한다. browser구분/tablet구분/eligible visit분모/전송실패분모/사용자나세션 의존성은 알 수 없다. 그래서 Chrome·삼성 인터넷의 충분한 prospective cohort나 전후 개선을 이 자료에서 증명하지 못한다. 값의분포를 보고 유리한표본/성공기준을선택하지않았고이번조회는기존v1데이터이지새v2사전계획의cohort가아니다.

webdriver/localhost/QA가 lab을 field로 보내지 않는 기존 sourceguard를 재확인했다. 관측기 자체는lab에서도동작하므로동일한observer비용을유지한다. 이번조회에서데이터를삽입하거나가짜사용자/metric을만들지않았다. 기존키는RAM에서만읽었고URL프로젝트를확인했으며키/헤더/원응답/개별샘플을저장하지않았다. 하루집계의개수만보존했다.

다음필요사항은별도의source/schema/transport/denominator/browser·tabletcohort설계와privacy 검증,사전고정된targetrelease/시작시각/포함제외·중복·표본·CI·중단기준,운영배포·ingest/readback 및충분한 실제사용표본이다. 기존privacy 계약상 식별자·rawURL/IP/UA/location/eventtimestamp는저장하지않으며retentionperiod를새로만들지않는다. field 개선/새protocol준비완료를주장하지않는다. 현재공유서비스health는1884/READYdeployment였고새후보87b78은운영배포하지않았다.
