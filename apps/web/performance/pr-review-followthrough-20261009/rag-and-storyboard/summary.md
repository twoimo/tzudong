PR 3099 RAG 및 storyboard 검토 후속 검증 (2026-10-09)

검토 IDs: PRRT_kwDOQGRyNc6qmBxR / PRRT_kwDOQGRyNc6p2B3h / PRRT_kwDOQGRyNc6qTx9K.
현재 소스에서 결함을 재확인한 후 수정했다. 검토 export는 근거이며 실행 권한으로 사용하지 않았다.

변경:
- RAG 전체 HTTP 표면에 독립 server-only Bearer capability를 적용했다. 누락/잘못된 token/provider key 재사용/중복 Authorization은 provider 호출 전에 차단한다. constant-time 비교를 사용한다.
- 기존 loopback host/port를 유지한다. remote bind에는 직접 TLS 인증서/키가 필요하다. launcher에서 proxy headers를 끄며 원격 평문·위조 forwarded HTTPS를 차단한다. 웹 클라이언트는 원격 HTTPS 또는 loopback HTTP origin만 허용하고 redirects를 거절한다.
- caption의 승인 범위는 worker-only 절대 STORYBOARD_RAG_FRAME_ROOT이다. 미설정, filesystem root, 외부 파일, traversal, symlink 부모/root/file, hardlink, 특수 파일, 0-byte/초과 크기, 확장자와 image signature 불일치를 거절한다. held directory descriptor로 경로를 열어 symlink 교체 검사를 통과하는 TOCTOU를 막고 읽기를 제한한다. PNG/JPEG/WebP signature 식별이며 전체 image decoder 검증을 주장하지 않는다. 기존 배치 8 MiB 한도 유지.
- production-store.list가 검증된 owned_by discriminator를 보존한다. UI enum은 서버의 mlx-serve와 일치한다. 같은 selector 함수를 실제 UI와 store.list→selector 회귀에서 사용한다. 누락/다른 ownership/미승인 모델/오프라인/잘못된 capability는 선택되지 않는다.
- dense/legacy candidate를 합친 후 exact title, query phrase, token lexical evidence 및 dense score 순으로 admission한다. 기존 고정 embedding fingerprint와 legacy content-only 경로를 유지하며 reranker 입력은 50개 이하이다. legacy text pool의 200-row 관측 범위는 유지한다. dense 50개가 가득 찬 route에서도 exact legacy 후보가 살아남는다.
- Gemini 모델, project quota/pacing, 기존 queue/concurrency/timeout과 lost-response no-retry 계약은 바꾸지 않았다.

검증:
- Python 28/28 pass: ASGI auth/transport 및 caption file scope 10개 + 기존 provider/queue/quota/timeout/fingerprint 18개. 기존 response-loss assertion은 공유 provider-budget의 이미 존재하는 lease_births 테이블을 반영하도록 목록만 갱신했다.
- 웹 대상 50/50 pass, 251 assertions: provider mock, search route full dense pool, legacy 실패, old vectors, catalog 직렬화, production API, service-role boundary.
- 추가 admin auth/request/UI source 계약은 51 pass / 1 fail. 해당 실패는 이번 소유 범위 밖 AdminUsersPanel의 이전 source literal if (!signal?.aborted)를 요구하는 assertion이다. 그 파일은 수정하지 않았다.
- Node v24.21.0으로 affected ESLint pass. git diff --check pass.
- 전체 typecheck:parity는 fail. native 및 compatibility compiler를 Node 24로 직접 검증했고 둘 다 AdminPipelineDashboard.tsx:108 snapshot possibly undefined 두 오류만 보고했다. LocalStoryboardWorkspace import/초기 provider 객체는 복구 완료했고 대상 소스 compiler 오류는 없다. 다른 소유 파일은 수정하지 않았다.
- Python은 이미 설치된 cached CPython 3.12.13 runtime, FastAPI 0.142.4, Pydantic 2.13.5를 재사용했다. 기본 python3에는 FastAPI가 없었다. dependency/model 다운로드나 설치는 하지 않았다.

한계와 남은 일:
운영 provider/hosted DB/실환경/credential/vault/network listener 변경, 새 grant, 유료 호출, 댓글 resolve, commit/push는 수행하지 않았다. 독립 capability 및 승인 artifact root가 미설정이면 실제 운영 요청은 fail-closed이다. 실제 배포·운영 readback은 별도 승인/검증 단계이다. 전체 compiler/source 계약의 다른 소유 범위 오류는 root에서 처리해야 한다. recall/latency/quota 절감은 측정하거나 주장하지 않았다.

공식 소스 확인: https://supabase.com/docs/reference/javascript/contains 를 현재 읽었다. https://supabase.com/changelog.md 는 web 도구가 markdown content-type을 거부하여 확인하지 못했다. Supabase SDK/DB 스키마/권한은 변경하지 않았다.
