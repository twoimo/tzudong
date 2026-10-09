# Managed Vercel env-vars skill 공식 기준 정정안

대상 정본: `/Users/twoimo/.codex/plugins/cache/openai-curated-remote/vercel/0.54.1/skills/env-vars/SKILL.md`. Managed cache는 수정하지 않았다. 아래는 supported plugin update/maintainer 정정에 반영할 검증된 내용이다.

- 기존 skill의 `.env.[environment].local`이 test에서 생략된다는 설명은 [현재 Next 공식 문서](https://nextjs.org/docs/app/guides/environment-variables) 및 installed Next16.3.8 실행 결과와 다르다. 실제 순서는 process.env → .env.NODE_ENV.local → .env.local(test 제외) → .env.NODE_ENV → .env이며 처음 발견한 값이 유지된다. `.env.test.local`은 test에서도 적용된다.
- 비밀값을 포함할 수 있는 .env 파일을 이름만으로 Git 추적 대상으로 추천하지 않는다. 파일 보존·기존 edits·현재 프로젝트 ignore 정책을 먼저 확인한다.
- 설치 CLI56.5에서 env ls production --project ID --format json을 실제 검증했다. 현재 최신 문서의 Secret/Config 옵션을 이 핀에 그대로 적용하거나 버전/권한을 자동 변경하지 않는다.
- 키를 넣는 `source <(grep...)` 조립은 사용하지 않는다. shell expansion/개인값 출력 위험을 피하고 parser 또는 supported CLI의 파일/stdin 인터페이스로 전달한다.
- 사용자 요청은 기존 Gemini 프로젝트의 리딤 크레딧 사용이다. AI Gateway/OIDC의 일반 추천으로 provider/project를 변경하지 않는다.

증빙: `apps/web/performance/funded-gemini-followthrough-20261009/next-env-doc-reconciliation.json`. Synthetic 3조건이 통과했고 실제 secrets/source 설정은 변경하지 않았다. 현재 host에는 managed plugin 정본을 갱신하는 callable update capability가 확인되지 않았으므로 정본 반영은 미완료다. 상위 cache 직접 패치는 수행하지 않았다.
