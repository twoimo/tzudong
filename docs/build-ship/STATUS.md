# 상태

- 단계: 프로덕션 반영 확인
- 기준: `main` `95e598e37ff2eb86efe21951b8c79d2bc890d44a`
- 검증: 홈 셸 계약 테스트 38개 통과. Release와 Promotion Path가 develop, data, main 승격에서 통과. 프로덕션 health의 `gitSha`와 배포 ID가 위 커밋과 같다.
- 배포: `www.tzudong.app` `/api/health` `gitSha`가 위 커밋과 같고, 배포 ID는 `dpl_5MC4XZygfsu8a7MRmeTKBreUDFRN`
- 롤백 후보: `febbc76fd78ff4cbe9fe3aa29df16e8199088953`
