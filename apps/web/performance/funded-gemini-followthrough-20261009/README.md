# 현재 후보 OCR·크레딧 확인

현재 후보의 `callGeminiReceiptOcr`와 실제 SDK request builder를 사용한 합성 영수증 1건이 통과했다. 기존 vault copy를 읽기만 했고, 유일한 AI Studio key의 마스킹 suffix 및 해당 paid project 연결을 확인했다. 기존 `tkt` wrapper는 이동된 실행 파일을 가리켜 현재 authority CLI 재조회는 불가능했다. 키를 생성·교체하거나 사본을 수정하지 않았다.

| 관측 | 값 | 해석 |
| --- | --- | --- |
| 실제 모델 | gemini-3.6-flash | 현재 후보의 기존 OCR 기본 모델을 유지; 스토리보드의 3.8 모델과 구분 |
| provider 생성 시도 | 1회 | SDK attempts=1 설정, 재전송 없음 |
| 시간 | 3,519.39 ms | helper 처리시간, API/Auth/DB/브라우저 전체 지연 아님 |
| 사용량 | 입력1,495 / 출력128 / thinking265 / 총1,888 tokens | SDK usage metadata; 실제 금액은 아직 미확정 |
| 정답 검사 | 모델·상호·날짜·시간·총액·품목·합계 모두 일치 | 합성 영수증 1건; 일반 정확도·개선율·신뢰구간 주장 없음 |
| 선불 잔액 | 10,000원 | UI 읽기; 충전·자동충전 변경 없음 |
| GCP 크레딧 | 표시값 ₩9.47만 | 반올림된 compact 표시; 정확한 잔액으로 환산하지 않음 |
| 현재 계정 비용 집계 | 396.14 - 화면 절감396.14 = 0원 | 10월1~8일 Gemini 집계; 이번 검사 귀속·최적화 금액 아님 |
| 후속 비용 readback | 집계 동일 | 집계 지연 때문에 신규1회 비용/크레딧 차감 미확정 |

표본 단위는 영수증1건이다. 여러 필드 검사를 독립 표본처럼 세지 않는다. n=1의 지연·토큰으로 분포/95% CI/성능 개선율을 추정하지 않는다. 같은 영수증의 과거 2026-10-03 실호출 증빙이 존재하지만 날짜·서버·SDK 조건이 다르므로 paired 비교로 사용하지 않았다. 과거 스토리보드 text/Nano Banana2/Pro 실호출은 `ui-renewal-20261003/gemini-live-*.json`의 역사적 증빙이며 현재 전체 worker/RAG/UI 성공을 대신하지 않는다.

현재 Vercel production에는 GEMINI_CREDITS_API_KEY가 sensitive 변수로 설정돼 있다. metadata만 읽었고 decrypted key 값의 일치 여부는 미검증이다. MCP env list 실패 후 설치 CLI56.5의 지원되는 env ls/--project/JSON 인터페이스로 확인했다. 키 값은 출력·저장하지 않았다.

롯데카드0488 삭제 화면은 유효한 대체 결제 수단을 요구하며 기존 대체 수단은 선택 불가다. 새 카드 등록·funding unlink·계정 폐쇄·추가 충전 없이 취소했고 대상이 남아 있음을 읽었다. 삭제 완료가 아니다.

공식 기준: [Google billing](https://ai.google.dev/gemini-api/docs/billing), [Next env lookup](https://nextjs.org/docs/app/guides/environment-variables). 현재 문서와 installed Next16.3.8의 `.env.test.local` 및 process.env 우선순위를 실제 synthetic 변수3조건으로 대조했다. `.env.local`만 test에서 생략된다.

운영 DB 쓰기·배포·카드/청구 설정 변경 없음. 실제 운영 Auth→quota→OCR→정정→저장→UI, 대표 실제 정답셋, 작업별 비용 귀속과 현재 authority tool 복구는 남았다.

새 output 옵션/기존 uncertain receipt 보호의 CLI 경계 테스트3개(16assertion)와 targeted lint가 통과했다. 테스트는 존재하지 않는 operator file로 provider 접근 전 중단을 확인하며 provider 호출을 하지 않았다.
