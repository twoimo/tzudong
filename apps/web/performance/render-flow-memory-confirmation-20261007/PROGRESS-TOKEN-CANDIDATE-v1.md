현재 토큰 후보0f6b4d0798a0825178889e7d01da212457325ed7의 source·local·compiled actual-SDK 검증은 진행됐지만 메모리 회귀 해소·운영 배포·field 개선을 선언하지 않는다. 원래 ca235 기준의9개 독립 실행 쌍은 아직 실행 중이다. 같은 소스 A/A에서 큰 자연 heap 변동이 확인됐다.

| 흐름 | 환경·표본 수 | 지표 | Before | After | 절대 변화 | 상대 변화 | 노이즈·신뢰구간 | 판정 | 증거 경로 |
|---|---|---|---|---|---|---|---|---|---|
|735확장·60회 이동복귀|Chrome154.0.8037.98/390×844/CPU4/n2프로세스·소스|자연 heap 중앙값|31.821181MB|28.361375MB|3.459806MB 감소|10.8727% 감소|A/A1.094523MB; 모집단CI없음|20%pilot가드 내,9쌍 결과 대기|warm-summary-original-pilot-v4.json|
|같은흐름|같음|heap peak 중앙값|48.193238MB|49.173050MB|0.979812MB 증가|2.0331% 악화|A/A4.142822MB;CI없음|20%pilot가드 내,peak 감소 없음|warm-summary-original-pilot-v4.json|
|같은흐름|같음|60회 종료 heap 중앙값|32.523198MB|29.085684MB|3.437514MB 감소|10.5694% 감소|A/A11.118842MB;CI없음|노이즈를 넘는 개선 입증 안 됨|warm-summary-original-pilot-v4.json|
|같은흐름|동일 유한 프레임 창|rAF gap p95|16.8ms|16.8ms|0ms(보고 floor0.1ms)|계산안함|프레임 관측,사용자p95아님|15%pilot가드 내;프레임 개선 없음|warm-original-pilot-v4/raw.json|
|같은흐름|2프로세스씩·120종속 주기씩 합계|50ms초과 gap 관측 수|1(0+1)|12(6+6)|11회 증가|1100% 증가(희소 사건)|n2,정밀CI없음|tail 악화 관측;9쌍 재검증 필요|warm-original-pilot-v4/raw.json|
|동일소스A/A|동일91a2빌드/Chrome패치/ABBA4프로세스|종료heap 위치그룹 중앙값|21.962388MB|33.081230MB|11.118842MB 차이|50.6267% 변동|한A/A실행;노이즈0이라고 간주하지 않음|실제 코드 개선/악화 아님|warm-summary-aa-current-v4.json|

낮을수록 좋은 값의 감소는before−after,상대감소는(before−after)/before×100이다. 표의 증가율은 악화 방향이며,겹치는 효과를 합산하지 않는다.0기준선·0.1ms미만 시간차이는 배수/비율을 계산하지 않는다. 표의n은 독립프로세스이며60주기는 종속반복이다. 현재9쌍의paired bootstrap20,000회는 원시값이 모두 저장된 뒤 계산한다. 모집단 사용자p95를 만들지 않는다.

수정 전 동일길이 방문 이력이2개의 고유 방문에서중복1개로 바뀌어도 선택·비선택 마커 배지는2회를 유지하는 실패를 unit에서 보존했다. 현재ID와uniqueVisitCount를 양쪽 icon cache key/stamp에 반영해 수정했다. Token cache도현재 ID·좌표·주카테고리·방문수로 무효화하며원본배열의참조/독립출력 계약을 유지한다. 빈compact원본row가mergedRestaurants에 포함되는 실제mapper 조건에서도emptySet을 만들지 않도록 했다. 유효history는기존unique count계산을 사용한다.

39unit/148assertions,lint0,native7.0.2/compat6.0.2 parity2449입력/0진단,Next16.3.6 production/CSS gate를 통과했다. 실제NaverSDK/synthetic735에서10흐름·4trustedCDP스와이프 통과했고,6개persisted-video형식 fixture를 실제클라이언트병합기로3개1/2/3회방문맛집으로만들어배지가정확했다. 물리휴대폰·태블릿·운영·데이터갱신2-to1브라우저검사는아직이번최종소스에서완료되지않았다. 물리폰사용중이라는사용자hold를유지한다. Pixelflicker 제거·leak없음을주장하지않는다. 역할별최대5문자열을reachable row마다WeakMap으로보유하며새cache메모리/JIT/GC trade-off는최종원시값으로확인한다.

field집계의현재coarse metric totals는LCP29/INP19/CLS28이다. 고유사용자/보장된human표본이아니며후보0f6b의운영표본은0이다. 현재ae177 navigate DesktopLCP13/INP9/CLS14,Mobile5/5/5여서비교가능한field성과와CI는미검증이다. SQL은read-only이고QA syntheticPOST·schema/grant변경없음. 공식bracesregistry는3.0.3이며GHSA-vfj7-8cjw-p6xm는patched None으로현재확인됐다. 유료용량/unsafealias/억제/보호된승격/배포는수행하지않았다. 신규Astra agent spawn은0이다.

원래20%warm회귀 실패와이전Chrome154.0.8037.97의22.15%A/A변동은보존한다. 이pilot·측정후GC로면제하지않는다. 다음은현재실행중9쌍·UI데이터갱신·cold735/2000·원인별할당/tail frame진단·가능해진실기기·보호된승격/rollback/배포/readback·field이다. 현재draftPR3138은sourcehead0f6b를가리키며최종메모리판정은대기상태다.
