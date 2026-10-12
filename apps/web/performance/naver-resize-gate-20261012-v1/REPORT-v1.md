# SDK resize 측정 중복을 줄인 후보

후보87b78e839206a56a255a1d408a410bf4b1829cc4는 main056a에서3개파일만수정했다. 앞선query callback81d5와geometry cache723e는포함하지않았다. ResizeObserver 재구독의초기같은크기알림에서도 SDK가크기를다시측정하는것을피하면서기존320ms post-transition centering을유지한다. 실제width/height·map/elementidentity변경,initial/unknownmeasurement는기존SDKresize경로를탄다. 추가한것은마지막map/target/두치수의O(1)기록뿐이며viewportcache·새listener·새delay·데이터축소는없다.

관련47tests/2388assertions,lint,native7/compat6parity(3142logicalinputs),ownednpm11.6.2 ci(lockunchanged),productionWebpack·실제CSSgate가통과했다. fullunit3456pass/11skip/0fail이었다. 빌드jo80CUIB4QSh1rxNWDZX9와sourceSHA가연결됐고생성tsconfiginclude만정확히보존·복원했다. 소스는로컬이며PR/승격/운영배포는없다.

CPU/trace diagnostic의16동작에서resize관측75→50회였다. SDK내부호출도포함한숫자이며앱의정확한중복호출수로오해하지않는다. 기록된map size는390×844로같았다. 당장호출수가줄어도입력지연이나총layout비용이줄었다는증명은아니다. CPUprofile/trace/getter wrapper는시간을바꿀수있으며primary로합치지않는다. rawtraceargs/URL/code/key/실사용자응답은보존하지않았다.

자연pilot는각1독립process/실행내첫8검색+같은8재방문이다. 입력중앙값211.15→193.70ms(17.45ms,8.264%감소),종료heap30.281564→30.511052MB(+0.758%),idle31.507256→31.427464MB(-0.253%)다. 표본1개씩이므로CI/성능개선을주장하지않으며새128검색primary에서다시검증한다.20%heap/15%input guard를유지한다.

실제NaverSDK/합성REST735/Auth401,Next16.3.8production,Node24.21.0/npm11.6.2/Chrome154/Playwright1.63,CPU4/cacheoff/SWbypass조건이다. SDKhash802f8c5bb436eeb0014e0e8c72e7f675ae88e102766d2a923cd2c24c7eca74d1은같으며reportedversion은null이다.16/16동작에서선택·marker·중복0·map1이일치했고각실행page0/console2를관측했다. 실패요청·CSP차단을숨기거나보안경계를넓히지않았다.

같은모바일context에서390×844/390×540/844×390/768×1024/1440×900/390×844로변경했고전후6/6에서중심·줌·선택마커projection의차이0이었다. SDKsize와DOMsize,overflow0,markerpresence도통과했다.12정지captures중모바일·desktop폭을직접검토했고타일/마커가보였다. 이검사는mapgeometry의일치이며전체sidebar/overlay시각적품질을증명하지않는다. viewport축소는물리keyboard나주소창검사가아니며desktop폭도모바일context의breakpoint시험이다. 정지캡처로플리커발생률·지속시간을계산하지않는다. 물리기기는사용하지않는다.

primary는 sibling resize-gate-memory-primary-20261012-v1에서AA4+AB9쌍/22freshprocess/각256종속동작으로사전고정했다. ownbuild/test/profiler 없이실행한뒤독립통계·canonicaladmission·메모리회귀를평가한다. 현재이root는진단과로컬검증이며performance/field admission0이다. warm60/cold2000·수명주기·실제서비스/field·승격/배포는남았다. 운영readback은serving1884f87e...였으며새후보를배포한것이아니다. G037SQL예외승인은미응답이다.
