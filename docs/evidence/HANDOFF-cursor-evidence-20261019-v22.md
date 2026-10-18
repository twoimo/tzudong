# 기존 Gemini 실행의 공유 등록과 리셋 정책 반영

소유 checkout/branch는 그대로다. 제품 코드·운영 배포는 바뀌지 않았다. native 목표의 마지막 확인 상태는 blocked이며 필수 Gemini 완료 원문 부재에 관한 v21 경계는 유지한다. 이 상태는 사용자 취소나 연구의 terminal 실패가 아니다.

정본 SKILL.md, references/local-desktop.md, references/capacity.md를 다시 읽었다. 최신 정책은 status.active_operations와 admission을 기준으로 삼는다. 신선하게 관측된 미래 주간 reset까지 24시간 이내일 때만 ready reverse→delta→thesis→followup 우선과 서비스별 최대 3건의 로컬 admission이 적용된다. 평시는 1건/FIFO이며 서비스 경고·실제 소진·소유권·데이터 범위를 우회하지 않는다. GPT-6 Pro 웹 accepted 사용자 턴은 원래 user-turn ID당 한 번 shared turn에 기록하고 quota/usage 미터를 분리한다. 과거 보고서 수로 소급하거나 200회/주를 가정하지 않는다.

기존 https://gemini.google.com/app/d33ca8e24b4acf9d 의 account kss2740, Argon 최고가, Deep Research, 작성 중 카드와 stop control을 소유 탭에서 다시 관측했다. 완료 전문·내보내기는 없었다. 중복 업로드/전송/시작은 0회다. 기존 dispatch/start 모드 증거와 번들 해시는 그대로다.

canonical adopt-existing으로 기존 job tzudong-9228c145-c8b70ca9-antithesis-v1 / bundle 7bb1e2b658c3781078f0eef5b61494bd494d72c8e29a20abf8f4408045655203 / reservation cc4ed397fc5b793aad315375를 한 번 등록했다. 원래 사용자 예외 지시와 dispatch checkpoint SHA를 receipt로 연결했다. 실제 시작 acknowledgement가 이미 있으므로 researching을 거쳐 최종 uncertain_from=researching으로 대사했다. 이것은 현재 provider backend liveness를 입증한다는 뜻이 아니다. active_operations에는 두 원래 Gemini 연구가 보존됐고 다른 owner의 88f6855e7549452c4288cb93는 해제/변경하지 않았다. 관측 당시 admission은 fifo/local_max_active1/active_count2/free_slots0/dispatch_pendingfalse였다. grandfathered 기존 실행 수를 새 2건 전송 허가로 해석하지 않는다.

지원 automation_update로 기존 heartbeat tzudong만 갱신하고 실제 automation.toml readback의 prompt·ACTIVE·5분·같은 thread를 대조했다. 무조건 1건/옛 로컬 예외 대기 문구를 현재 reset-aware admission·ledger·소유 release 규칙으로 바꿨다. 등록 전/후 프롬프트는 cross-audit v2에 보존했다. 다른 자동화는 변경하지 않았다.

새 증거는 shared-existing-operation-adoption-v1.json과 heartbeat-prompt-pre-reset-policy-v1.txt, heartbeat-prompt-reset-aware-v1.txt다. 이전 completion manifest를 completion-manifest-pre-shared-adoption-v1.json에 보존했다. 갱신된 native manifest 검증은 PASS/reports1/findings20/artifacts64/missing antithesis+reverse/completionEligiblefalse였다. 저장 파일 hash/schema 검증이며 웹 완료나 지적 해결의 증명이 아니다. 봉인된 base root/pin은 바꾸지 않았다.

다음: 소유 원래 Gemini 화면의 실제 terminal 전문이 생기면 편집 없이 저장·bytes/SHA/URL/source/mode를 연결하고 이 소유 reservation만 정상 release한다. 그 뒤 전 지적 판정·해당 수정·native 검증을 마친 최종 소스와 Gemini 전문으로 실제 GPT-6 Pro+Deep Research 역검증을 정상 공유 admission에 올린다. 새 질문은 이미지 생성 없이 텍스트·표·수식·diff만 요청한다. 원래 memory/physical/field/flicker와 strict marker/CSP 한계를 완료로 승격하지 않는다. 전화/ADB·DB/Storage/DNS·유료·계정/호스트 설정 변경은 없다.
