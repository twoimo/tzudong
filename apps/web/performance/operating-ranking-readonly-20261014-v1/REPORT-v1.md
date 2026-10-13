# 운영 공개 랭킹 읽기 검증

현재 프로젝트의 공개 랭킹 RPC를 전체·월간 각각 읽었다. 두 기간 모두 HTTP200,19행이었고 현재 caller의 응답 형식·정렬·중복·페이지 종료 검사를 통과했다. 사용자 ID·닉네임·점수·인증값·응답 원문은 RAM에서만 처리하고 저장하지 않았다.19행은 활동 사용자 수나 field 표본 수가 아니다.

`readback-v2.json`과 `read-ranking-v2.mjs`가 최신 검증이다. 조회 전에 기존 환경의 key가 publishable 형식임을 확인했고, 사용자 JWT·쿠키·secret key를 보내지 않았다. [공식 key/role 문서](https://supabase.com/docs/guides/getting-started/api-keys)에 따라 로그인 없는 publishable 요청은 anon 역할이다. 자격 증명은 복사·변경하지 않았다.

v1의 성공 응답도 보존했다. 별도 JWT-only 역할 확인은 기존 값이 JWT가 아니라 publishable key여서 실패했다. 이는 RPC 또는 실제 권한 거부가 아니다. v2는 공개 key 종류를 조회 전에 확인하며 service secret으로 잘못 실행하지 않는다.

이 검증은 API와 현재 caller의 호환성 검사다. 모바일 페이지·헤더 렌더링, 물리 Galaxy·삼성 인터넷, 인증된 사용자 쓰기, 랭킹 점수의 원본 데이터 전수 대조 또는 새 코드의 운영 배포를 입증하지 않는다. 자동화 요청을 실제 사용자 field 표본으로 집계하지 않는다. 지속 오류율이나 개선율·신뢰구간을 계산하지 않는다.

Node24.21.0과 source SHA는 실행 기록에 결속돼 있다. 현재 스크립트의 absolute source/env 경로는 이 Mac 환경이다. 재실행자는 동일한 source 바이트와 자신의 기존 공개 프로젝트 설정을 사용하고 원문·인증값 출력 없이 별도 output path에서 실행한다. 기존 readback을 덮어쓰지 않는다. 서비스 데이터와 월간 기간은 재실행 시 바뀔 수 있다.
