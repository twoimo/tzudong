# Goal
researcher 검색에 필요한 누락 데이터를 확보할 도구/RPC 보강

# Steps
- [ ] tool: SceneDataBooster 생성 | 장면/캡션 데이터 보강
- [ ] tool 구현을 위한 입력 및 출력 정의 | query/video_ids | transcripts[]
- [ ] rpc: SearchBackfillRpc 생성 | 누락 레코드 조회
- [ ] rpc 구현을 위한 입력 및 출력 정의 | query/filter | rows[]
- [ ] RPC 작업 확인을 위해 `list_rpc_sql` 실행
- [ ] 생성된 tool 및 RPC 테스트 수행 | 동일 요청 시 scene_data/caption 근거 반환 확인
- [ ] 연구 충분성 판단 기준 문서화 | research_sufficient 조건 명시
- [ ] 전체 작업 결과 보고서 작성 | 작업 진행 상황 및 결과 정리

# Notes
현재 프로젝트의 배경음악 및 효과음 선택 도구가 필요함에 따라 필요한 데이터 보강 작업이 필수적이다.
