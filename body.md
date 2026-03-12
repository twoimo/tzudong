## 개요
- 프로젝트 내부 관리 문서 및 임시 로그 파일 정리 (Cleanup)

## 변경 내용
- **문서 삭제**:
  - `AGENTS.md`, `OMX_MODERNIZATION_WORKLOG.md`: 더 이상 유효하지 않거나 검증이 완료된 구버전 관리 문서를 삭제했습니다.
- **임시 파일 및 로그 삭제**:
  - `all_web_files.txt`: 파일 목록 생성용 임시 파일을 삭제했습니다.
  - `backend/restaurant-crawling/data/_test_temp/crawling_errors/5kvyjueOvxE.jsonl`: 크롤링 테스트 과정에서 생성된 임시 에러 로그를 삭제했습니다.
- **작업 파일 삭제**:
  - `body.md`: 이전 PR 생성 시 사용된 임시 설명 파일을 삭제했습니다.

## 테스트
- 불필요한 파일 삭제 후 프로젝트 빌드 및 실행에 영향이 없음을 확인했습니다.

## 관련 이슈
- (없음)
