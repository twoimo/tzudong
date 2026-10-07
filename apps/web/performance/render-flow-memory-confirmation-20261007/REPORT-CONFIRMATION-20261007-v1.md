후보 소스에서 반복 탐색 구간의 JavaScript heap 중앙값이 31.85→28.57MB로 낮아졌다. 9개 독립 실행 쌍에서 쌍별 중앙 감소량은3.332MB,95% 신뢰구간은2.383~3.551MB였다. 실제Naver SDK의 데이터 갱신에서도 기존2회 방문 배지가 중복1회로 바뀐 뒤 남는 결함을 재현했고 후보는 올바르게 제거했다.

이 결과는 로컬 production build와 합성 데이터 범위다. 종료 heap은 높은A/A 변동과 쌍별 결과 때문에 아직 불확실하다. 물리 Galaxy, 전체 픽셀 플리커,128개 검색 재방문,새field cohort,보호된 승격·운영 배포는 완료하지 않았다. 전체 목표는 활성 상태이며 완료로 표시하지 않는다.

대조는ca235e250957c4360ad713ffd29e118c11cc5b7c,후보는0f6b4d0798a0825178889e7d01da212457325ed7이다. Node24.21.0/Next16.3.6 후보(대조Next16.3.5)/Playwright1.62.1/실제Chrome154.0.8037.98,390×844 터치 화면 재현,CPU4,HTTP cache/SW 우회,네트워크 무감속,합성735행과Auth401,실제원격SDK·타일 요청을 사용했다. 각 프로세스는60종속 이동·복귀 주기를 포함하며9쌍은18개 독립 프로세스다. 원래20%heap/15%프레임guard와 준비·안정화 시간을 바꾸지 않았다.

|흐름|환경·표본 수|지표|Before|After|절대 변화|상대 변화|노이즈·신뢰구간|판정|증거 경로|
|---|---|---|---|---|---|---|---|---|---|
|735개 확장·60회 이동복귀|위환경,n9프로세스/소스|구간heap중앙값의 중앙값|31.846174MB|28.567980MB|3.278194MB감소|10.2938%감소|쌍별 중앙감소3.332062MB의CI[2.382980,3.550628],A/A차1.094523MB|측정범위에서중앙 working-set 감소 입증;20%guard내|warm-summary-original-confirm-v4.json|
|동일흐름|동일|peak heap중앙값|48.191180MB|45.679828MB|2.511352MB감소|5.2112%감소|쌍별CI[-0.197508,6.790436],A/A4.142822MB|20%guard내;peak개선입증안됨|warm-original-confirm-v4/raw.json|
|동일흐름|동일|종료heap중앙값|30.952064MB|28.840892MB|2.111172MB감소|6.8208%감소|쌍별CI[-9.501500,18.187092],A/A11.118842MB|기존집계guard내이나종료회귀해소불확실|paired-endpoint-uncertainty-v1.json|
|동일흐름|유한프레임창,n9/소스|rAF gap p95중앙값|16.8ms|16.8ms|0ms(0.1ms보고floor)|계산안함|사용자p95아님;시간해상도보다작은차이제외|15%guard내;프레임개선없음|warm-summary-original-confirm-v4.json|
|60회후30초자연idle|별도ABBA,n2/소스|idle heap중앙값|19.226632MB|19.375148MB|0.148516MB증가|0.7724%증가|표본부족,CI없음;after[19.322908,19.427388]MB|bounded관측과작은retained trade-off;기존primary면제아님|natural-idle-scopes-summary-v1.json|
|동일idle|같음,ownedrenderer3개합산|renderer RSS합산중앙값|664.002560MB|669.270016MB|5.267456MB증가|0.7933%증가|n2CI없음,공유페이지중복합산가능|heap/고유PSS/GPU VRAM과다른범위,개선입증안됨|idle-natural-scopes-v1/raw.json|
|동일idle|같음|DOM node중앙값|5258|5252.5|5.5감소|0.1046%감소|n2범위before[5252,5264],after[5252,5253]|node존재와픽셀표시분리;누수없음주장안함|natural-idle-scopes-summary-v1.json|
|동일idle|같음|JS event listener관측|6341|6341|0|0%|n2CI없음,SDK내부등록전체를의미하지않음|관측동일,모든listener수명주기증명아님|idle-natural-scopes-v1/raw.json|
|실제category재조회·리뷰중복갱신|SDK/합성6원본행→3맛집,n1/소스|2회배지의1회갱신|이전2회배지잔존|배지올바르게제거|기능불일치1→0|희소표본비율계산안함|코드·unit·실제compiledUI一致;field아님|구체적데이터정확성결함수정검증|review-history-refresh-browser-v2/raw.json|

낮을수록 좋은 값의 감소는before−after,상대감소는(before−after)/before×100이다. 표의증가율은악화방향이다. 서로겹치는개선율을합산하지않는다. 쌍별CI는독립실행쌍의차이중앙값에대한bootstrap20,000회이고,before/after전체중앙값차이의CI로잘못표현하지않는다. n9로사용자populationp95를추정하지않는다.

종료값은특히주의가필요하다. 전체중앙값차이는2.111MB감소지만,쌍별중앙차이는−4.819MB,쌍별중앙회귀율은+22.186%이며9쌍중5쌍에서after가더높았다. 이조합은정해진기존집계guard통과와메모리회귀해소확정을분리해야한다는근거다. A/A동일91a2빌드의종료위치그룹중앙값은21.962→33.081MB(차11.119MB,50.627%)였다. 이전Chrome패치에서의22.15%변동과기존26.70→33.70MB의+26.2%실패를없애거나면제하지않았다.

원인은실제publicchunk/column·AST에서동일restaurant-role토큰과Set/sort/join생성이확인됐다. 현재ID·좌표·카테고리·고유방문수를매호출확인한뒤역할별최대5문자열을reachable row별WeakMap에재사용한다. 입력배열참조·독립출력계약은유지하고제자리수정도token비교에반영한다. 비어있는compact원본이mergedRestaurants에있더라도emptySet을생성하지않는다. 아이콘의weak stamp/strong key에현재고유방문수와ID를추가해동일길이중복수정과ID변경의stale content를막는다.

안정입력에서token문자열생성O(L)을피하고캐시값검사는O(N),고유방문계산은history가있는경우기존O(H)이다. 메모리는reachable row수와고정5역할에비례하며마커/DOM/callback을캐시가강하게보유하지않는다. 이는이론적모델이고모든고유객체의회수증명을대신하지않는다. 30초idle에서heap추가0.149MB와rendererRSS추가5.267MB는trade-off로공개한다.

39unit/148assertions,lint0,native7.0.2/compat6.0.2 parity2449입력/0진단,production/CSS gate통과. SDK10흐름/4CDP스와이프와실제원본병합경로1/2/3회배지검사를통과했다. 모든warm실행에서marker735/누락0/중복0/추가SDK map생성0/overflow0이었다. 이는pixel flicker0회관측이나Reactcommit/remount전체측정을의미하지않는다. pageerror0/consoleerror2는이후SDK/QA오류분류가필요하며rawprovider진단은저장하지않았다.

PR3138은draft,source0f6b이다. 현재Install/Release/PromotionPath,6언어CodeQL,Ubuntu/Windows npm/Bun검사와Vercelpreview상태가성공이다. develop현재필수context는Release/PromotionPath,admin집행활성/forcepush불허다. source승격·production배포는하지않았다. braces3.0.3/GHSA-vfj7-8cjw-p6xm의공식patched None은유지되지만이를현재Install실패로표현하지않는다. 현재후보production trace129개와standalone에서해당ownerchain경로를관측하지않았으며배포노출·전체보안증명으로일반화하지않는다.

Fieldlegacy집계는LCP29/INP19/CLS28로실제로증가했다. 고유사용자/보장된human표본이아니며browser/tablet/Galaxy cohort와새후보표본은없다. 새prospective수집기준초안은별도이고legacy에소급적용하지않는다. 新cohort계측/시작SHA/기간/표본/의존성/rollback조건의freeze와actualdelivery·storage를확인해야한다. 유료용량·unsafealias·audit억제·新Astra agent spawn없다. 휴대폰사용보류를유지한다.

새목표파일GOAL-OBJECTIVE-20261007.md에맞춘13개요구그룹은updated-objective-coverage-v1.json에분리했다. cold735/2000,128검색재방문,실제타일/pixel영상/SDKversion·오류분류·수명주기,태블릿/회전/키보드/주소창/background,실기기2브라우저,canonicaladmission,보호된승격/배포/자산/rollback,필요fieldcohort는남아있다. 기존검사를유효범위에서재사용하고새실패·변경·불확실성만추가검증한다. 전체완료주장없음.
