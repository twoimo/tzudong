공식 upstream/PyPI만 사용했다. 조회 시점은 2026-10-04이며 선택 버전의 `requires_python`, `requires_dist`, yanked 상태는 pypi-metadata.json 및 compatibility-findings.json에 정제 보존했다. 발표 제목보다 실제 metadata·설치된 SDK·caller 실행 결과를 우선했다.

| 대상 | 공식 primary source | 선택·호환성 근거 |
| --- | --- | --- |
| LangGraph 1.2.12 | [PyPI](https://pypi.org/project/langgraph/1.2.12/) | 실제 PR3060 pin. Core >=1.4.7,<2 및 Python >=3.10. 기존 crawler LangChain >=1.2.4 요구와 동시 해결 |
| langchain-core 1.6.5 | [PyPI](https://pypi.org/project/langchain-core/1.6.5/) | 실제 PR3063 pin. Pydantic >=2.7.4,<3. PipelineState 보충 검사 및 통합 환경 실제 crawler 체인 검증 |
| Pydantic 2.13.5 | [PyPI release changelog](https://pypi.org/project/pydantic/2.13.5/) | 실제 PR2889 pin. Validator 재사용 및 core GC traversal 수정이 기재됨. 실제 문서 serialization 검증 |
| OpenAI 3.16.1 | [버전 고정 README](https://github.com/openai/openai-python/blob/v3.16.1/README.md), [PyPI](https://pypi.org/project/openai/3.16.1/) | Chat Completions 지원과 HTTPX2 기본 transport 확인. 기존 caller 계약을 유지한 fixture transport 검증; provider/model 전환 없음 |
| Google API client 2.200.0 | [PyPI](https://pypi.org/project/google-api-python-client/2.200.0/) | 실제 PR2896 pin. 배포본 static discovery로 기존 channels/playlistItems/videos 호출 검증 |
| curl-cffi 0.16.3 | [PyPI](https://pypi.org/project/curl-cffi/0.16.3/) | 실제 PR2894 pin이며 Scrapling fetchers의 >=0.16.1 조건 만족. Native request 준비 및 Fetcher 경계 검사 |
| Scrapling 0.4.15 | [PyPI version metadata](https://pypi.org/pypi/scrapling/0.4.15/json), [upstream release](https://github.com/D4Vinci/Scrapling/releases/tag/v0.4.15) | fetchers extra가 playwright>=1.62.0, curl_cffi>=0.16.1 요구. 기존 Playwright pin과 실제 resolver 충돌 재현 |
| yt-dlp 2026.8.19 | [PyPI](https://pypi.org/project/yt-dlp/2026.8.19/) | 실제 PR2850 pin. 배포본 parser/Chrome impersonation 표와 기존 source CLI 계약 확인; 실제 추출은 미실행 |
| psycopg2-binary 2.9.13 | [공식 changelog](https://www.psycopg.org/docs/news.html), [PyPI](https://pypi.org/project/psycopg2-binary/2.9.13/) | Python >=3.10 요구는 repository 3.11/3.12와 호환. 잘못된 bytea/int64-array parsing 수정이 기재됨. 실제 Json/pool 검증 |
| Playwright 1.62.0 보완 | [PyPI version metadata](https://pypi.org/pypi/playwright/1.62.0/json), [공식 Python release notes](https://playwright.dev/python/docs/release-notes) | Scrapling 조건을 만족하는 최소 pin 선택. 실제 기존 Chrome/CDP/upload API signature 검사 |
| tqdm 4.70.1 보완 | [PyPI version metadata](https://pypi.org/pypi/tqdm/4.70.1/json) | 기존 직접 import가 baseline에서 실패한 정확한 원인. Python >=3.8의 non-yanked release로 명시 후 import·caller 검증 |

버전 bump만으로 특정 취약점을 수정했다고 추정하지 않았다. 감사 시 알려진 취약점은 baseline·after 모두 0건이었다. 공식 문서의 기능 소개를 사용해 모델·provider·기존 응답 계약을 확장하지 않았다.
