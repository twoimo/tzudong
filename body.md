## 개요
자막 수집 스크립트(03-collect-transcript.js) 봇 탐지 우회 패턴 적용

## 변경 내용
- yt-dlp CLI 대신 Python 모듈 사용 (python -m yt_dlp)
- --js-runtimes, --remote-components ejs:github 옵션 추가
- 블랙리스트 파일(no_transcript_permanent.json) 초기화

## 테스트
- hbJeJKuxG5Q 영상 자막 수집 성공 (240 lines)
