## 개요
- 모바일 드래그/리사이저블 컴포넌트 터치 최적화
- Next.js 캐시 클린업 스크립트 오작동 메시지 로깅 최적화 및 중복 발생 방지

## 변경 내용
- `apps/web/components/home/home-map-container.tsx` 및 `apps/web/components/ui/bottom-sheet.tsx`의 내부 드래그 컨트롤 UI에 `WebkitAppearance: 'none'`, `WebkitTapHighlightColor: 'transparent'`와 같은 모바일 사파리 특화 Webkit 스타일 추가 및 X 버튼 제거/수정
- `apps/web/scripts/clean-next.mjs`에서 `.next-stale-*` 캐시 삭제 시 발생하는 EBUSY, EPERM 등의 락 관련 에러에 대해 `verbose` 옵션 도입 및 중복 린트/에러 로깅 누락 현상 수정

## 테스트
- iOS/Android 모바일 터치 이벤트 오동작 검수
- 윈도우/맥OS `npm run build` 스크립트 실행 후 `clear-next` 구동 및 무시 메시지 정상 동작 확인

## 관련 이슈
- (없음)
