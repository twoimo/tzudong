# Storyboard Gemini 운영 검증

이전 Codex/GPT Image 및 여덟 공급자 smoke는 Gemini 전용 실행 전환으로 폐기했다. 과거 결과는 기록이며 현재 공급자 검증으로 사용하지 않는다. `storyboard:image-proof`는 더 이상 제공하지 않는다.

현재 실행 경로는 `bun run storyboard:gemini-worker -- --help`로 확인한다. 운영자 비공개 worker token과 크레딧이 연결된 Gemini 환경 파일을 준비한 뒤 다음과 같이 기존 큐의 한 작업만 처리한다. 키·토큰은 명령 인자나 보고서에 넣지 않는다.

```sh
bun run storyboard:gemini-worker -- --origin https://www.tzudong.app --token-file /private/worker-token --env-file /private/gemini-env --once
```

요청된 Gemini 모델의 설치/제공 여부를 확인한 worker가 기존 프로젝트의 작업을 claim한다. 생성 결과는 텍스트/장면별 checkpoint와 이미지 원본 SHA·모델·response ID를 저장하고 프로젝트를 다시 읽어 확인한다. 결과가 불확실하면 자동 재생성하지 않고 기록을 확인하거나 관리자에게 명시적으로 재시작을 요청한다. 실제 비용·프로모션 차감은 별도 결제 readback이 필요하다.

모델 호출은 유료 크레딧을 사용할 수 있다. 기존 처리 한도 안의 한 작업만 실행하며 자동 CI에서는 실행하지 않는다. 이 문서는 새 검증을 실행했다는 영수증이 아니다. 기존 실제 Gemini 생성 증빙과 모의 공급자 검증은 `docs/operations/ui-and-gemini-renewal-20261003.md`에 범위별로 구분되어 있다.
