# 앱 뒤로가기/상태 유지 회귀 기준

이 문서는 웹앱을 Capacitor 앱으로 감쌀 때도 유지해야 하는 상태 보존 기준이다.

## 필수 시나리오

1. 리뷰 작성, 맛집 제보, 맛집 수정요청은 입력값과 현재 단계(`currentStep`)를 함께 복원한다.
2. 리뷰 수정은 일반 닫기/뒤로가기 때 draft를 지우지 않고, 본문/카테고리/새 사진/기존 사진 제거 상태를 재진입 시 복원한다.
3. 사용자가 직접 연 홈 좌측 패널은 브라우저/Android 뒤로가기로 닫을 수 있도록 `router.push`로 히스토리를 만든다.
4. 공지 패널은 `?panel=announcement` URL을 열자마자 지우지 않는다. 닫기 동작에서만 URL 상태를 정리한다.
5. Capacitor 도입 후에는 Android hardware back, iOS swipe back, background/foreground 복귀를 같은 기준으로 확인한다.

## 현재 구현 범위

- 아직 네이티브 Capacitor 셸은 없다.
- 현재 회귀 방지는 source-contract 테스트로 고정한다.
- 네이티브 셸 도입 시 `backButton`, `pause`, `resume` 이벤트를 이 문서 기준에 맞춰 추가 검증한다.
