## 개요
- 모바일 UI 최적화 완료 (`mobile-sheet-layout` 및 `viewport-height-fix` 추가, CSS 수정) 
- 시스템 구조 최적화: `eslint` 규칙 최적화 및 `tsconfig` 경로 재정의, `video-compression` 로직 모듈화 추가
- 불필요/임시 파일 정리 및 미사용 코드 최적화 진행, 테스트 항목 보강

## 변경 내용
- 모바일 뷰 전용 `mobile-sheet-layout` 컴포넌트 추가 및 뷰포트 높이 버그 수정을 위한 스크립트(`viewport-height-fix.js`) 추가
- 전역 모바일 지원 스타일시트 변수화 적용 및 사이드바/패널 관련 코드 리팩토링 수행 (`Sidebar.tsx`, `RestaurantDetailPanel.tsx` 등)
- 개발자 도구 및 통합 테스트(QA) 스크립트(`insight-chat-*.test.ts`, `qa-integration.spec.ts`) 추가/보강
- 불필요한 테스트 파일, 데모 코드 일괄 삭제 및 정리

## 테스트
- 로컬 환경 컴파일 및 린트/타입 체크 확인
- 모바일 브라우저(사파리/크롬 모바일 모드) 뷰포트 UI 깨짐 현상 해소 확인
- `npm run test` 통과 확인

## 관련 이슈
- (없음)
