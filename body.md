## 개요
- 전반적인 UX/UI 컴포넌트 최적화 및 내부 로직 안정화
- Admin 및 Insight 화면, 파일 포맷팅 등 유지보수 개선

## 변경 내용
- 다수 API 라우트(`api/admin/insight/chat/*`, `api/ocr/*`) 및 UI 컴포넌트(`RestaurantDetailPanel.tsx` 등) 내부 로직 최적화 
- 스크립트 실행 환경 설정 및 ESLint/TSLint 규칙 적용에 따른 불필요/임시 코드 분리 및 정리
- README 및 AGENTS 마크다운 문서 최신화 및 포맷팅 처리

## 테스트
- 로컬 개발 서버 및 모바일 뷰 렌더링 확인
- 린트(`lint`) 및 타입 검사 통과

## 관련 이슈
- (없음)
