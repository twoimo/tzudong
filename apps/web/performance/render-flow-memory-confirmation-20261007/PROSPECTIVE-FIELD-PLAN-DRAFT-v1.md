새 prospective 평가의 수집 계획 초안이다. 현재 v1 legacy 집계(LCP29/INP19/CLS28)에 소급 적용하거나 이번 후보 성과로 바꾸어 부르지 않는다. 현재수집경로는実동작하지만 browser/tablet cohort와tab-session 중복제한이없어 아래新평가를시작하지않았다.

활성화 전결속: collector protocol sourceSHA·baseline운영SHA·candidate운영SHA·시작UTC·instrumentation sourcehash를읽어확정한후계획을freeze한다. SHA미결속상태는준비상태이며수집완료나field검증완료가아니다. baseline은현재performance source와같은동작을유지하고cohort계측만추가한별도배포, after는같은계측의performance 후보배포로한다. UI/data/runtime/CDN/계측변경이동시에있으면별도confound로기록한다.

대상: production root-document의첫visible window. Chrome/삼성인터넷/other/unknown을coarse enum으로분리하며mobile/tablet/desktop viewport breakpoint를현재CSS계약과일치시킨다. 실제device type·Galaxy모델을관측할수없으면unknown으로남기고viewport를hardware검증처럼표시하지않는다. 실제기기검증은독립이다. UA·hardware ID·rawmodel·검색어·위치·계정·쿠키·requestbody·개별eventtimestamp는저장하지않는다.

지표:지원되는LCP/INP/CLS의고정bucket분포. 기존100ms/16ms/0.01폭을유지하며overflow 상한은open-ended이다. 지원하지않는값은null/미측정이며0으로채우지않는다. 주요통계는cohort별p75,p95는표본충분한경우기술통계로분리한다. 기존實험실latency15%/heap20% guard는그대로독립실행하며field로대체하지않는다.

수집floor초안:각배포·browser/viewport·metric cohort에최소200accepted first-tab-visible-window표본및14完整UTC관측일을요구한다. 200표본은p75의독립표본rank 근사오차±약6percentile points 수준의floor일뿐충분한power보장이아니다. 최소14일은weekday2회를포함하는時間block floor이며실제同一사용자·跨tab相관을제거하지못한다. 기준확정전power/calibration방법과bin오차를검토한다. legacy데이터에맞춰floor를낮추지않는다.

포함:active servingSHA와clientSHA일치,production root allowedhosts, 지원되는metric과navigation, 첫visible window. 제외:QA/perf query,webdriver/알려진bot,preview/privatepath, stale source409, 현재pinnedweb-vitals BFCacheCLS unsupported path. 한tab-session/release/metric당최대1전송을clientnamespace boolean flags로제한하는수단을검증한다. 식별자를server에전송하지않으며跨tab·同一사용자依存性은미확인으로보고한다. flag/network전송실패·quota/NAT·adblock 누락은표본손실이며fake표본으로보충하지않는다.

추론:개별event를독립사용자로간주하지않는다. calendar-day block bootstrap과bucket interval bounds를사용하고day交換가능성·跨day사용자相관·seasonality·traffic/device mix制限을밝힌다. 精密한populationCI를뒷받침하지못하면불확실로남긴다. 사전Field판정값·rollback 조건·analysis date는protocol deployment전추가검토/freeze해야하며結果관측후유리하게변경하지않는다. 현상태초안이그완료를대신하지않는다.

費用·안전:既승인storage/service-role-only RPC·ratequota를재사용하고PUBLIC/anon/authenticated권한을늘리지않는다. global180writes/min과현재source counters를維持하며新schema는immutable適用migration을편집하지않고별도source/local검증을거친다. 고비용유료계측·billing upgrade없음. actual delivery/store/query와observer비용·重複制限·cohort分類를各검증해야新수집준비완료다.

次분석:新collector/baseline結속後최초14完整UTC日이지나고cohortfloor를충족한첫분석에서before/after를평가한다. 部足이면cohort별현재n/日/未지원/依存性/不足範圍와次候補日을보고한다. 候補日이지났다는이유로완료되지않는다. 現수집코드는확인됐지만新기준のfollow-up予約作業은미설정이다. 실제instrument/job/schedule을確認하기전후속실행을확약하지않는다.
