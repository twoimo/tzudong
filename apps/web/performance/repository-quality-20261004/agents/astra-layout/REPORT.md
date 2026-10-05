# Layout 명세 수정 결과

`codex/nightly-quality-20261004`, 기준 HEAD `d0e38f333a8d9dbd9ed4e14d3e113732ad58ef9a`에서 수정 완료. 현재 native 세션은 `openai / gpt-6-astra / xhigh`로 확인했다.

변경은 아래 4개 파일이다. 커밋·스테이징·푸시·외부 쓰기는 하지 않았다.

- `backend/layout-manifest.v1.json`: 실제 커밋된 `assets`, `assets/source-fonts`, `docs/build-ship`, `docs/performance`의 소유 경계·허용/금지 내용·source 분류·vcsTracked=true 항목과 assets 최상위 메타데이터를 추가했다.
- `backend/utils/tests/test_layout_naming_source_recovery.py:74`: 정확한 디렉터리 개수 계약을33에서37로 갱신했다.
- `backend/bin/tests/test_check_layout_manifest_unittest.py:418`: 정확한 디렉터리 개수 계약을33에서37로 갱신했다.
- `.kiro/specs/crawler-pipeline-operational-readiness/platform-modernization-reconciliation.v1.json`: 직접 필요한 기존 fixture의 두 파일 바이트 해시와 집계 해시, 총3개 값만 갱신했다. 수정된 manifest와 단위 테스트의 이전 해시 때문에87개 계약 중 재현성 검사1개가 실패했으며, 이 fixture 갱신 뒤 해결됐다.207개 항목·분류·나머지 필드는 보존했다.

검증 결과:

- Python3.11.17의 격리된 임시 환경, 프로젝트 핀 hypothesis6.165.10·PyYAML6.0.3 사용. 패키지 매니페스트와 전역 환경은 변경하지 않았다.
- layout/rename/source-recovery/속성 계약 **80개 통과**.
- 영향받은 platform reconciliation recovery 계약 **7개 통과**. 최초87개 실행 후 필요한 fixture만 고치고 해당7개만 재실행했으며, 서로 다른87개 테스트에 대한 최종 통과 근거가 있다.
- `python3 -B backend/bin/check_layout_manifest.py --json`: exit0, `ok=true`, `trackedDirectoryCount=37`, 누락·별칭·이동·오래된 참조 문제 없음.
- `git diff --check`: 통과.
- 기존 manifest 항목·제외 경로·두 검사기 구현을 변경하지 않았다. 신규/기존 node_modules 별칭 생성·제거 없음. 적용된 마이그레이션·package·CI security·전역 설정 변경 없음.

재현 환경과 정확한 모듈 목록은 `test-environment.json`, `focused-contracts-initial.json`, `recovery-contracts-after-fixture.json`에 있다. 최종 패치는 `layout-fix.patch`, 전체 정제 요약은 `summary.json`이다. 이전 `astra-security` 감사는 그대로 보존했으며 GitHub 브랜치·경고 조회를 반복하지 않았다. 부모의 리뷰와 보호된 승격이 남아 있다.
