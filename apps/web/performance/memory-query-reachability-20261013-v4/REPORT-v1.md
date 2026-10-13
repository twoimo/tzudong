# Query 객체의 heap graph 진단

source056a/Chrome155/production HTTPS/REST735/CPU4, 독립1회128검색×2 뒤 heap snapshot을RAM에서만 분석했다. snapshot은49473347bytes,492881nodes,2378833edges다. 문자열/원문snapshot은저장하지않았다. snapshot이GC를유발할수있으며naturalmemoryguard를대체하지않는다.

queryKey/queryHash/state의정적edge로649개Query형태객체를분류했다. snapshot직전QueryClient648개와1개차이가있다. 관측시점/shape검출 차이를분리하지못했으므로같은census로단정하지않는다. 세고정family는128/128/129개이며나머지는other로만분류했다.

strongedge만따른counterfactual에서모든Query형태node를제외하면JS타입self-size합계가1822324bytes줄었다. 이것은실제cache삭제나GC의회수량/정확한retainedsize/성능개선이아니다. weak/ephemeron semantics,DOM·GPU·process범위,dominators와실제eviction을검증하지않았다. family별값은겹칠수있어합산하지않는다. 실제Query object의shallow합계는49284bytes다.

이근거만으로캐시648개가전체메모리회귀의주원인이라고주장하거나임의로LRU를추가하지않는다. 다음진단은상대적으로큰보유경로/할당비용을분리하고실제변경후naturalA/A·A/B와기능/재방문/무효화검증을수행해야한다. 기존20%heap/15%latencyguard는유지한다.

분석기는각조건에O(V+E) BFS를쓰고,rawgraph문자열·userquery·데이터·IDs를emit하지않는다. 합성graph4검사는cycle/shared/weak/invalid-target를검증했다. 실제graph원문이보존되지않으므로저장된집계만으로수치를재계산할수는없으며, script/고정환경으로다시측정해야한다. 이진단은후보performanceadmission을지원하는완전한증거가아니다. admission0/field0/physicalfalse다.

재현은PLAN-v1.md와고정build/SDK/fixture를준비하고Node24로measure-query-reachability-v4.mjs baseline <새label>128 2. rawsnapshot은RAM128MiB로제한하고 cap/unsupported는unavailable로기록한다. 기존outputs는덮지않는다.
