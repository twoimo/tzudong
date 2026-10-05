해외 지역 조회가 주소 키워드를 OR 조건에 바로 넣어 빈 값·구분자가 포함된 조건을 만들 수 있었습니다. 기존 PostgREST 정제기를 연결하고 빈 term을 제외하며, 국가 주소 조건을 한 번 만들어 재사용합니다. 현재 12개 해외 config의 정상 query 조건·순서, 국내 fallback, projection과 반환 ID 순서는 보존합니다.

검증: 실제 hook initializer/query callback의 격리 경계·fixture를 포함한 관련 25개 unit(205 assertions), 변경 hook/test ESLint, native7.0.2/compat6.0.2 parity(0 diagnostics/2449 inputs) 통과. 고정 transport fixture이며 실제 hosted 데이터·성능 이득을 뜻하지 않습니다. PR #3032의 이미 동등한 REST/singleton/dialog 코드는 유지했고, #3031의 부정확한 WeakMap·로그 경로는 포함하지 않습니다.
