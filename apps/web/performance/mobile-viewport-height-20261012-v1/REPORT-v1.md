# Viewport 읽기 후보: 개선 미입증

후보723e6cc572470eccfb5bf86ba9e62b2376df3a0f는 main056a에서5개 파일만 수정했다. 네비게이션 inline pixel과 resize/pageshow/visibility 갱신값을 읽고, 기존 offset 수식과 실제 변수 변경을 보존했다. 관련48개 검사, 린트, native/compat parity, 독립npm11.6.2 ci(lock607175e... unchanged), productionWebpack과실제CSSgate를통과했다. 원래모듈링크는runtime-cache로보존했고공유tree를수정하지않았다.

전체unit v1은runner PATH에서Bun을찾지못해실행0회로실패했다. v2는외부컴파일러를가리키는node_modules링크때문에Pin_Contract 1개가실패했다(3216pass/3skip/1fail). 오류를지우거나검사를완화하지않았다. 독립설치뒤v3에서3459pass/11skip/0fail이었다. 별도Pin_Contract10개도통과했다. 버전별출력과실패를모두보존했다.

최종독립설치빌드cRpp_0oVBXZCbSJIPsUPB를이용한자연pilot는main056a와각1freshprocess,실행당첫8검색+같은8재방문이다. CPU4/cacheoff/SWbypass/390×844/dpr1/원격SDK실제/REST735Auth401합성조건이다. SDK802f8c5... 동일,16/16동작·map1·마커선택·중복0이일치했다. 입력중앙값178.6→190.1ms(+6.44%), 종료heap24.915840→25.922312MB(+4.04%),idle25.484044→27.148508MB(+6.53%)였다. longtask합계3107→1547ms는같은실행내기술통계이며초기작업포함/스케줄링/외부부하에영향을받는다. 독립표본1개씩이어서신뢰구간이나유의미한개선을주장하지않는다.128검색primary20%heap/15%input기준을통과한것이아니다.

CPU/trace v7은자연pilot와분리했다. geometry읽기비용이Naver SDK의getBoundingClientRect→getSize→_resizeByTrigger→_onResize로이동한것을attribution-candidate-v2.json에서확인했다. 단순한읽기cache는DOM변경에필요한계산을없애지못했다. 새4listener와값cache의유지비용대비이득이입증되지않아채택·승격·배포하지않는다.

기본함수수식/숨김·표시nav/viewport변경·복귀·정리의unit은통과했지만실기기,모든반응형pixel,field는미검증이다. 휴대폰은사용하지않았고CSP를넓히지않았다. pageerror0/console2는각실행의관측일뿐오류확률0이아니다. rawURL/traceargs/key/private응답은저장하지않았다. 신규실험의본원인은선택상태마다재구독한ResizeObserver초기알림에의한SDKresize이고,후속naver-resize-gate-20261012-v1에서실제크기변화와같은크기를구별하면서기존post-transitioncentering을유지한다.
