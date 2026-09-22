# 릴리스

- 대상: 웹. iOS/Android 스토어는 해당 없음.
- 경로: develop #3019 `46339e2e` → data #3020 `77c3e83d` → main #3021 `592e5de43374c57b87b64934551cfbf2b361147c`
- 프로덕션: `https://www.tzudong.app` 가 그 커밋을 서빙. 배포 ID `dpl_Au2A4uHk9B14VA2tzz3VaWHxtdGX`. 프로젝트 `prj_sau35J5uUtShIQ9OKofRtOVVnTSl`.
- 확인: `GET /api/health` 의 `gitSha`가 `592e5de43374c57b87b64934551cfbf2b361147c`.
- 롤백: 이전 프로덕션 `7bd4d00573ccefc97989076aab2f82077e08daf2` 를 다시 승격. 코드만 되돌리고 데이터는 되돌리지 않는다.
