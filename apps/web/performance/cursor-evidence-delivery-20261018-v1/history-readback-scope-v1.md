# 추가 history 진단의 판정 경계

run-live-history-readback-v1.mjs는 데스크톱 기준선의 history-back 상세 복원까지 통과한 뒤 restored-marker에서 실패했다. 첫 실패에서 중단하므로 baseline3개 viewport를 실행한 것으로 세지 않는다. live-history-before-v1.json을 그대로 보존한다. 이 엄격한 기준은 수정 후 동일 v1로 다시 실행하며, 관찰되지 않았다고 판정하기 전에는 해결로 세지 않는다.

v2는 실패 원인을 좁히기 위한 별도 진단이다. 같은 restaurant URL·상세·지도 복원 및 닫기를 확인하며, 원래 ID의 마커 수/가시성·전체 marker/cluster 수를 관찰값으로 남긴다. v2의 passed는 navigation/detail 범위에만 해당한다. v1 실패를 대체하거나 마커 가시성 문제를 해결한 것으로 취급하지 않는다. 대표 ID 정규화·클러스터 줌 등 원인을 아직 입증하지 않았으며 단정하지 않는다. 반응형3크기·한 브라우저 프로세스의 합성 시험이며 사용자 field 표본이 아니다.
