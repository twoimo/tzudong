# 릴리스

- 대상: 웹. iOS/Android 스토어는 해당 없음.
- 경로: develop #3033 `47e9342b` / #3036 `c71e8122` → data #3038 `5943eb34` → main #3040 `95e598e37ff2eb86efe21951b8c79d2bc890d44a`
- 프로덕션: `https://www.tzudong.app` 가 그 커밋을 서빙. 배포 ID `dpl_5MC4XZygfsu8a7MRmeTKBreUDFRN`. 프로젝트 `prj_sau35J5uUtShIQ9OKofRtOVVnTSl`.
- 확인: `GET /api/health` 의 `gitSha`가 `95e598e37ff2eb86efe21951b8c79d2bc890d44a`.
- 롤백: 이전 프로덕션 `febbc76fd78ff4cbe9fe3aa29df16e8199088953` 를 다시 승격. 코드만 되돌리고 데이터는 되돌리지 않는다.
