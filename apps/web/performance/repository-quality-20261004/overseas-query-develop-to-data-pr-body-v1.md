해외 주소 keyword 정제와 국가 조건 1회 재사용 수정(PR #3135)을 develop에서 data로 정상 보호 규칙에 따라 승격합니다. 현재 해외 config의 query 조건·순서, 국내 fallback과 기존 REST/singleton/dialog 계약을 보존합니다.

검증: 관련 unit25개, 변경 ESLint, TypeScript parity, PR #3135 전체 CI와 6개 언어 CodeQL 통과. fixture·소스 검증과 운영 실데이터·성능 성과를 구분하며, 후자는 승격·배포 뒤 별도로 확인합니다.
