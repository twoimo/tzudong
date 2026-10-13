# 할당 표본 진단과 실패 보존

이 패킷은 원인 진단이며 자연 heap guard, 전후 개선, 운영 또는 field 성과의 증거가 아니다. 실제 Naver SDK·원격 타일과 합성 REST735/Auth401, production build, CPU4, cache off/SW bypass, 390×844/DPR1/touch 에뮬레이션으로 실행했다. Source는 각 raw.json에 결속돼 있다.

| 실행 | 완료한 종속 동작 | 유효 checkpoint | 전체 결과 |
|---|---:|---:|---|
| ui-live-alloc-1 | 256 | 4 | 마지막 분석 실패; 전체 성공 아님 |
| ui-debug-final-1 | 8 | 0 | PROFILE_SAMPLE 거부 |
| ui-debug-final-schema-1 | 8 | 1 | 작은 진단 성공; 121 samples/707 nodes |
| ui-live-alloc-schema-2 | 64 | 0 | 첫 checkpoint PROFILE_SAMPLE 거부 |

32768-byte sampling interval, stack depth64, collected major/minor 객체 제외 조건을 사용했다. 원시 heap profile은 RAM에서만 처리하고 저장하지 않았다. 유효 checkpoint의 estimated live bytes와 가장 가까운 script ancestor 분류는 retained size나 자원의 소유권을 증명하지 않는다. 표본 간 비교의 신뢰구간 또는 개선율을 계산하지 않는다.

256동작 실행의 마지막 유효 checkpoint는 약 11.452MB였다. app-chunk 약7.169MB, Naver 약2.519MB, native/unknown 약1.764MB이며 최종 idle 성공값이 아니다. 작은 8동작 성공은 이 실행의 실패를 대체하지 않는다. analyzer 검증을 약화하거나 실패 표본을 좋은 표본으로 교체하지 않았다.

진단 중 관측된 join·SDK bind/unbind 할당은 보유 원인 후보다. 다음 비교에서는 큰 네트워크/데이터 처리 비용과 객체 수명·회수를 trace로 연결해야 한다. 작은 ID 비교 후보의 실제 자연 heap 결과와 거부 판정은 별도 `swipe-snapshot-comparison-20261013-v1` 패킷에 있다. 두 계측 방식은 합산하지 않는다.

계측은 실행 시간과 GC 일정에 영향을 줄 수 있다. 이 자료로 memory guard 통과, 누수 부재, 물리 Galaxy·삼성 인터넷 동작 또는 플리커 제거를 주장하지 않는다. 실패 raw와 v5/v6/v7 실행 script·계획을 모두 보존했다. 재현은 기록된 build/source와 현재 SDK origin·HTTPS 환경을 먼저 확인해야 하며 만료된 private TLS 자료를 재사용하지 않는다.
