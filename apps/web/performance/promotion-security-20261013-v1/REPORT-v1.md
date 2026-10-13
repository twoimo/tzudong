# 승격 보안 검사와 증거 인덱스 수정

PR3199의 GitGuardian은 비밀번호 없는 테스트 URI를 Generic Database Assignment로 감지했다. 실제 credential을 삭제·회전하거나 검사를 suppress하지 않았다. PR3200에서 테스트의 project/role/database를 manifest에서 직접 구성했고, 최종 URI가 이전과 byte 동일함을 확인했다. 첫 수정 SHA55a47b의 GitGuardian은 성공했다.

같은 변경의 전체 Ubuntu npm 검사는3300pass/21skip/1fail이었다. 실패는 current SHA256SUMS에 포함된 테스트 파일의 옛 해시였다. 이전 맵·pin을 historical 파일로 그대로 보존하고 현재 인덱스를 갱신했다. SQL·controller·replay driver·retained PG17 결과는 byte 그대로이며 새 DB replay로 relabel하지 않았다. 변경 테스트54개와 retained-proof/ownership 검증14개를 통과했다. 최신3bca7826의 full CI와 갱신될 develop→data의 외부 보안 결과는 별도로 확인한다.

개인정보·credential·원문 scannerfinding을 저장하지 않았다. source.patch, receipt와 historical/current map digest로 범위와 변경을 재검토한다. 앱 PR attachment 도구의 응답은 미확인이다. 실제 GitHub PR은 존재하며 도구에 연결을 요청했지만 UI attachment 성공을 주장하지 않는다. SQL/Storage/운영배포 쓰기0, 성능 admission0이다.
