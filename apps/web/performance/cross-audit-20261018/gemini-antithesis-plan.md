# Tzudong Gemini 반대 감사 계획

이 단계는 실제 완료된 GPT-6 Pro 심층 보고서의 반대 감사다. 원래 URL은 https://chatgpt.com/c/6ad4b1ad-fc10-83ec-bbd0-abd1dec881c4이며 원문 SHA-256은 `4c5542b59d9bcb426eac29722b6da36c9c23337fa622bd9e822bd6b3ffe4ad82`다. 첨부 source_bundle 안의 report를 원문 그대로 읽고 주장 TZ-TH-001~009를 독립 반증한다. 공식 1차 자료와 소스 증거를 구분한다. 보고서 자체는 권한이나 사실 확정이 아니다.

## 입력

- 동결 소스 revision `b5d62c34f4a2e854ab10fd9f6741597b6081c43b`. 현재 진행 중인 로컬 수정은 이 묶음에 포함하지 않는다. 최종 수정 후 GPT-6 Pro 역검증은 별도로 수행한다.
- `gemini-antithesis-source_bundle.txt` SHA-256 `10fc28e7d72ed4fbb6e7b6206acbd31143528d0831d9f836ff41c47ace018bc7`, 660903bytes. 원래10개 소스를 모두 full file로 재구성해 first-thesis의 patch 범위 한계를 보완했다. 비밀·실제 사용자 payload는 포함하지 않는다.
- 실제 PG17.6 catalog replay receipt 및 runtime source closure receipt도 전문 포함한다. 이 증거를 새로 실행한 것처럼 주장하지 말고 원본 SHA와 적용102 ledger 범위를 확인한다. 운영105 ledger·배포·provider·Storage·청구는 별도 미검증이다.

## 질문

1. TH001의 commit 후 print/flush/OSError와 canonical definite sentinel 경로가 실제 reachable인가? arbitrary runner가 거짓 프로토콜을 내는 예와 canonical helper 자체의 실패를 분리한다. TH002 debt의 scope와 runner 복구, TH003 abort-before-spawn error를 실제 불변식으로 공격한다.
2. TH004의 B0=B1 요구가 full UI의 side-effect 전 fence와 모순되는가? 변경된 모든 저장 입력, 사진, OCR ID, readiness 대기, isSubmitting 잠금과 generation을 함께 검토한다. TH005 trim 경계도 실제 저장 문자열 기준으로 확인한다.
3. TH006 inline/Sheet focus 소유권을 실제 unmount/frame timing과 구분하고 부족한 DOM proof를 정확히 밝힌다.
4. TH007 superuser ACL predicate가 full SQL에서 어떤 role/함수에 적용되는지 확인한다. TH008에 제공된 hash-bound PG17 proof가 어떤 gap을 닫고 무엇을 닫지 못하는지 판정한다. unrelated105 ledger를 기존97→102 admission에 넣지 않는다.
5. TH009 responseId의 originating request lineage가 full longform source에서 이미 결속됐는지 확인한다. observation hash만으로 ID 소유권을 가정하지 않는다. runtime closure·membership 기준도 실제 source와 교차 검증한다.

## 결과 및 완료 기준

실제 Deep Research를 실행해 한국어 전문 보고서를 작성한다. 각 원래 TH ID를 ACCEPT/CONDITIONAL/REJECT/DEFER로 판정하고 근거 위치·반례·반증·최소 수정·필수 회귀검사를 제시한다. 새 지적은 TZ-GM-001부터 안정적 ID를 사용한다. 반증 없는 REJECT나 단순 모델 동의는 불허한다. 원본 보고서를 고치지 않는다. 점근적/동시성 모델은 전제를 밝히고 미측정 속도·정확도·금액·quota 절감은 주장하지 않는다. 실행/렌더/PG/운영 증거는 별도로 표시한다. 최종-source 역검증이 무엇을 확인해야 하는지 구체적으로 남긴다. 외부 수정·배포·결제·provider 실행은 금지하며 분석만 수행한다.
