# Lazyweb design improve: 사용자 프로필 패널

- 대상: `components/profile/UserProfilePanel.tsx`
- 현재 캡처: `references/current.png`
- 참고 이미지: `references/ref-*.png`

## 진단
현재 UI는 기능적으로는 맞지만, 헤더/통계/탭/콘텐츠가 모두 같은 시각 강도로 쌓여 있어 “프로필 요약 → 활동 전환 → 활동 카드”의 위계가 약합니다. 특히 탭은 클릭 가능한 컨트롤처럼 보이기보다 단순 밑줄 텍스트처럼 보여 사용자가 눌러도 변화가 없다고 느끼기 쉽고, 통계 카드도 회색 블록이라 프로필의 핵심 성과 지표로 보이지 않습니다.

## Lazyweb 참고 패턴
1. GitHub 프로필: 아바타/이름/활동 지표와 탭이 명확한 프로필 대시보드 구조를 만듭니다.
2. OpenSea 프로필: 여러 콘텐츠 섹션을 탭으로 전환하되, 선택 상태와 리스트/그리드 컨텍스트를 명확히 보여줍니다.
3. Scoopz/Pandora/AllTrails 계열 모바일 프로필: 짧은 지표 카드와 활동 탭을 한 화면 안에서 단단하게 묶어 프로필 화면의 목적을 빠르게 이해시킵니다.
4. Any Distance/Audible 계열 업적 화면: 도장/랭킹 같은 업적성 지표는 아이콘 칩과 숫자 강조가 있을 때 훨씬 더 잘 읽힙니다.

## 적용 결정
- 기존 데이터/탭 상태 관리는 유지합니다.
- Radix Tabs 재도입 없이 현재 버튼 기반 탭의 접근성 속성(`role`, `aria-selected`, `aria-controls`)을 유지합니다.
- 통계 카드와 탭을 더 명확한 인터랙션 표면으로 정리합니다.
- 카드형 도장 UI와 `stampSize="compact"`는 유지해 최근 회귀를 막습니다.

## 구현 포인트
- 헤더 배경을 미세한 그라디언트로 바꾸고 프로필 설명 한 줄을 추가했습니다.
- 통계는 1행 3열 유지 + 아이콘 칩 + 카드 테두리/그림자 형태로 개선했습니다.
- 탭은 밑줄형에서 segmented/pill 형태로 바꿔 클릭 가능한 영역을 분명히 했습니다.
- 각 탭 콘텐츠 상단에 섹션 제목/설명/개수 배지를 추가했습니다.

## 기대 효과
- 사용자가 도장/리뷰/좋아요 탭을 누를 수 있는 영역으로 더 쉽게 인지합니다.
- 도장/좋아요/랭킹 지표가 한 행에 유지되면서도 더 읽기 쉬운 프로필 요약 카드가 됩니다.
- 도장 카드의 과한 확대 문제를 재발시키지 않고, 기존 카드형 리스트의 시각 위계를 보완합니다.

## QA evidence
- `bun test tests-unit/web-quality-performance-source.test.ts`: 11 pass / 0 fail / 257 expectations.
- Targeted ESLint on touched files: pass, 0 warnings.
- `tsc --noEmit --pretty false`: pass.
- Local Playwright smoke: `리뷰`, `좋아요` tabs both toggled to `aria-selected="true"`; screenshots saved to `references/after.png` and `references/after-compact.png`.

- Compact stamp viewport screenshot saved to `references/after-compact-stamps.png`; stamp overlay remains within the card and does not dominate the thumbnail.
