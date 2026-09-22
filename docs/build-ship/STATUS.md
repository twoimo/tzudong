# 상태

- 단계: 프로덕션 반영 확인
- 기준: `main` `592e5de43374c57b87b64934551cfbf2b361147c`
- 검증: 소스 계약 테스트 통과. Ubuntu npm, Windows npm, Admin 통과. 프로덕션 `https://www.tzudong.app` 초기 로딩에서 인기/최근 맛집 스켈레톤이 각각 한 번. 모바일 `/stamp`에서 `도장 페이지를 불러오는 중` 반복 없음.
- 배포: `www.tzudong.app` `/api/health` `gitSha`가 위 커밋과 같고, 배포 ID는 `dpl_Au2A4uHk9B14VA2tzz3VaWHxtdGX`
- 롤백 후보: `7bd4d00573ccefc97989076aab2f82077e08daf2`
