# 릴리스

- 대상: 웹. iOS/Android 스토어는 해당 없음.
- 경로: develop #3025 `501a8afd` → data #3026 `9776db9f` → main #3027 `febbc76fd78ff4cbe9fe3aa29df16e8199088953`
- 프로덕션: `https://www.tzudong.app` 가 그 커밋을 서빙. 배포 ID `dpl_BKFuHVQy8o5HttDnLw16fEKFSm8X`. 프로젝트 `prj_sau35J5uUtShIQ9OKofRtOVVnTSl`.
- 확인: `GET /api/health` 의 `gitSha`가 `febbc76fd78ff4cbe9fe3aa29df16e8199088953`.
- 롤백: 이전 프로덕션 `592e5de43374c57b87b64934551cfbf2b361147c` 를 다시 승격. 코드만 되돌리고 데이터는 되돌리지 않는다.
