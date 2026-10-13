# Query cache 보유 진단

실제 SDK/production HTTPS/합성REST735/CPU4의 독립1회256동작에서 QueryClient를 React host fiber를 통해 읽기 전용으로 관찰했다. 초기5개가 첫128검색 후648개가 됐고 두번째동일집합 순회와idle5초까지648개를유지했다. idle에서639개가비활성이고9개가활성이다. 메모리성능개선이나누수인증을뜻하지않는다.

restaurant-search129개(모두inactive,gc10분), sibling review128개(127inactive,gc30분), restaurant-reviews128개(127inactive,gc5분), other261개(255inactive,coarse집계상gc10/15/30분), catalog2개를관찰했다. other그룹의개별query종류/키는저장하지않았고기간별개수를추정하지않는다. 두번째순회에서항목수가더늘지않았다는관찰은다른검색/장시간의무제한성장을배제하지않는다.

검사는rawquery키/검색문자열/데이터/IDs를보존하지않으며family/수/활성상태/배열항목수/gcTime의집계만남겼다. Fiber최대깊이128이며실패하면unavailable로기록한다. 이이번에는Client접근에성공했다. JSON길이계산이나provider원문저장도없다. reflection의오버헤드를측정하지않았으므로앞선natural A/A와latency/heap을개선율로비교하지않는다. 강제GC·소스·운영쓰기·field admission0.

우선 조사할 것은 inactive Query의queryFn/closure 보유경로와기존gc·freshness/재방문계약이다. 648개가 heap몇MB를보유하는지는아직직접측정하지않았다. 캐시기준·guard를유리하게바꾸거나임의로삭제해성공으로만들지않는다. 다음후보는보유경로를확인한뒤독립함수/최소입력스냅샷/검증된bounded정책 등해당경로에만적용하고128재방문·변경무효화·정확성·실제SDK A/B로검증해야한다.

재실행:PLAN-v1.md의고정환경과build-receipts를준비한뒤Node24로measure-query-ownership-v2.mjs baseline <새label> 128 2. 기존출력과증거를덮지않는다. raw.json/aggregate-v1.json의주기별집계와source/SDK/환경을함께확인한다.
