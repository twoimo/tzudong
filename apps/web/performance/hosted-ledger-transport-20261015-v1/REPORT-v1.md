# GitHub Runner의 운영 DB 읽기 전용 접속 확인

기존 저장소 Secret을 사용하는 현재 main275fb4be의 Ledger 실행38693415701이 성공했다. 내려받은 제한된 migration-ledger 산출물도 기존 검증기를 통과했다. 로컬 DB URL의 부재는 이 Runner 접속 경로의 차단 요인이 아니었다. 이전의 전체 경로 차단 설명을 이 범위에서 정정한다.

- Workflow: g014-historical-migration-ledger.yml, event workflow_dispatch, ref main, 실제 head275fb4bedcaabfe151658acebeaf4611d9db9115. [실행 영수증](https://github.com/twoimo/tzudong/actions/runs/38693415701).
- 환경 이름 SUPABASE_DB_URL은 기존 Secret이다. 값은 읽어내거나 복사하지 않았으며 Runner 안의 psycopg만 소비했다. 연결 옵션 default_transaction_read_only=on 및 BEGIN READ ONLY, 고정된 제한 SELECT를 소스에서 확인했다. schema/data 변경0이다.
- 산출물 artifact11952494270, GitHub가 보고한 ZIP digest b3b1310a73e9f91f6c693f6a8d97b60940c9455fb9252d8fc872bd73089079c5. 추출 JSON6,212bytes의 별도 SHA256은0bd7003feb7920bbff9317f205d098ea32ebf6d5508b3ae8982d2a88c7c905e0이다. 두 해시는 서로 다른 대상이다.
- 검증된 rowCount86은 마이그레이션 이력 수다. 사용자 수나 전체 catalog 객체 수가 아니다. Canonical ledger SHA256은9268b38eacf1201a2c96743d1982d3d2fc71fe2593ae176686cecf2346aec9e5이다. 원본 row값은 공개 증거에 포함하지 않고0700 runtime cache 안의0600파일로 유지했다.
- 준비한3버전20261008192455/20261008200719/20261008201635은 이 ledger에 기록돼 있지 않았다. 이것만으로 현재 catalog에 관련 객체가 없다고 판단하지 않는다.

이 결과는 기존 Runner credential로 직접 PostgreSQL에 읽기 전용 접속해 이력을 얻는 경로가 동작했음을 입증한다. 대상 project/endpoint·actor·실제 Postgres버전·현재 catalog/ACL·writer fences·review apply/readback·운영 앱 배포를 입증하지 않는다. 해당 canonical 검증과 조율된 writer workflow가 다음 단계다. 현재 소스 소유 채팅에 run과 해시만 전달했으며 운영 적용을 중복 실행하지 않았다.

재현은 소스 workflow와 read_hosted_migration_ledger.py의 공개 Git blob/hash를 readback-v1.json과 대조한 뒤 기존 main workflow를 한 번 실행하고 실제 event head와 산출물 hash를 확인한다. main이 이동했으면 새 SHA의 검사로 분리한다. 비밀값을 출력·회수하는 workflow를 만들지 않는다. 개인정보·business row·raw driver 오류는 이 패키지에 없다. Field 성과나 성능 개선을 주장하지 않는다.
