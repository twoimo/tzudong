## 개요
GitHub Actions 실행 환경(Linux)에서 발생하는 `\r: command not found` 오류를 해결했습니다.

## 변경 내용
- **CRLF -> LF 변환**: `backend/run_daily.sh`, `07-gemini-crawling.sh`, `10-laaj-evaluation.sh` 파일의 개행 문자를 Windows 스타일(CRLF)에서 Unix 스타일(LF)로 강제 변환했습니다.
- **.gitattributes 추가**: 향후 모든 `.sh` 파일이 강제로 LF로 처리되도록 설정하여 재발을 방지했습니다.

## 테스트
- 로컬에서 변환 확인 완료.
- GitHub Actions 재실행 시 정상 동작 예상.
