## 개요
- any 타입 및 안전하지 않은 프로퍼티 접근 로직 수정
- console.log를 debugLog 유틸리티로 대체

## 변경 내용
- `apps/web/admin/...`, `components/map/...` 등 컴포넌트 내 `any` 타입을 `unknown`으로 수정
- 객체 프로퍼티 접근 시 타입 안전성 강화 (`mergedYoutubeMetas` 등)
- 시스템 주요 파일에서 기존 `console.log`를 `debugLog` 유틸리티로 마이그레이션

## 테스트
- 로컬 환경 컴파일 및 린트/타입 체크 확인

## 관련 이슈
- (없음)
