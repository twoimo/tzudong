# 비활성 Query 함수의 얕은 closure 진단

실제SDK·production HTTPS·합성REST735·CPU4에서128검색×2를 실행한 뒤, 세 비활성 queryFn의 V8Closure metadata를 읽었다. restaurant-reviews와 sibling query는10/57slot 두 Closure를, search는11/26slot 두 Closure를 관찰했다. 그 범위에서 Array variable과 직접DOM variable은 관찰0이다. 슬롯5개가function인 렌더closure와 module object참조를 관찰했지만, 보유bytes·객체dominators·깊은도달경로를 측정하지 않았다.

따라서 ‘queryFn이 전체render배열/DOM을직접보유한다’는 앞선 추측은 이표본으로 뒷받침되지 않는다. 광범위한 함수이동·렌더리팩터링을 시작하지 않는다. 총캐시648/비활성639가 유지되는 관찰은 별도패킷과 일치한다. 다음조사는각 Query object/함수 slot의실제보유경로와적절한캐시수명·무효화·재방문계약이다. 캐시를삭제하거나강제GC로primaryguard를통과시키지 않는다.

삼성/물리기기·운영·field 결과가 아니다. 원문검색어/키/데이터/변수값·private properties·전체heapdump를 보존하지 않는다. 허용된static identifier/type/class와 Array length metadata만 기록한다. Global/Script scope를 제외하고각 object group을해제한다. unsupported는unavailable이며0으로채우지 않는다. 복수Array/DOM이없는직접scope관찰이 전체누수부재를증명하지않는다. instrumentation overhead는미측정이므로naturalA/A의heap/latency와비교해개선율을계산하지 않는다.

재현:PLAN-v1.md와build/fixture/SDK pin을준비하고Node24로measure-query-closure-v3.mjs baseline <새label>128 2를실행한다. 기존root/output은덮지않는다. source056a/Chrome155의진단이며source9f의after성능판정으로 사용하지 않는다.
