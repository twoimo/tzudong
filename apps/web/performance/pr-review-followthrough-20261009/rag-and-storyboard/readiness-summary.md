활성 readiness 및 RAG HTTP caller 후속 확인 (2026-10-09)

소유 경로: apps/web/lib/admin/system-status/status.ts, apps/web/tests-unit/admin-system-status.test.ts, apps/web/lib/admin/storyboard/rag-worker-client.ts, backend/storyboard-agent/README.md, apps/web/.env.example.

기존 status helper가 퇴역 STORYBOARD_AGENT_API_URL을 필수 설정으로 안내하고 legacy BGE endpoint를 probe하는 활성 오안내를 확인했다. 활성 연결은 STORYBOARD_RAG_WORKER_URL과 독립 STORYBOARD_RAG_WORKER_TOKEN으로 좁혔다. URL/capability/egress key 재사용 검사는 유료 호출과 system-status 모두 같은 getStoryboardRagWorkerConnection에서 수행한다. 미설정/평문 원격/URL credentials·query/fragment/잘못된 root URL은 호출 전에 차단한다.

system-status는 Authorization header와 redirect:error로 /health 및 /models?load=false를 순차 확인한다. 두 필수 Gemini provider의 설정 준비를 확인하며 paid access/quota/generation 성공으로 해석하지 않는다. HTTP health 성공이어도 model config가 false이면 reachable:false 및 worker_configuration_not_ready를 보고한다. 상태 출력과 setup command에는 token 값이 포함되지 않는다. 새 setup command는 설정 여부만 확인하고 API/provider 호출을 하지 않는다.

Gemini key flag는 실제 credits/storyboard/server alias를 인정하고 퇴역 STORYBOARD_AGENT_GEMINI_API_KEY를 준비 근거로 삼지 않는다. inbound capability 또는 browser key가 worker egress credential을 대체한다고 안내하지 않는다. 다른 공급자·모듈의 일반 key flags와 setup는 이번 RAG 변경 범위 밖이므로 보존했다.

기존 응답 DTO 필드 storyboardAgent/bgeEmbedding은 유지했다. BGE 상태는 retired_producer로 명시적으로 disabled이며, legacy endpoint 호출과 BGE setup checklist는 제거했다. 별도 역사적 scripts/docs/evidence를 정리하거나 지우지 않았다.

실제 활성 HTTP caller inventory:
- Admin status /health 및 /models?load=false: 공통 연결 validator가 제공하는 server-only Authorization.
- documents route (활성 ingestion/indexing) → embedStoryboardRagTexts → /embed: 같은 연결 validator와 Authorization.
- search route → /embed 및 /rerank: 같은 연결 validator와 Authorization.
- 이 source tree에서 별도 활성 RAG HTTP indexer/caption caller를 찾지 못했다. 역사적 BGE/OpenAI/migration scripts는 그대로 보존했다.

검증: admin-system-status 39개 및 기존 Gemini RAG 11개, 합계 50/50 pass (538 assertions). retired producer만 설정한 경우 호출 없음, capability 누락/egress key 재사용/원격 평문 URL일 때 호출 없음, 두 readiness endpoint의 header/redirect, model config false 및 secret 미노출을 검증했다. Node v24.21.0 affected ESLint pass. Node 24 native compiler 전체 check pass. root가 예정한 batch build/parity는 별도 증빙이다. git diff --check pass.

실 token/env/vault 설정·서버 시작·실 API/provider·유료 호출·다운로드·게시·commit/push는 수행하지 않았다. 테스트는 mock fetch와 합성 fixture만 사용했다. 기존 artifact-map.json 및 SHA는 이전 단계의 보존된 시점 자료이며, 이번 수정된 소스는 readiness-artifact-map.json의 현재 hash를 사용한다. 성능/쿼터 절감이나 운영 성공을 주장하지 않는다.
