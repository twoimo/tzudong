정상 readiness 응답으로 발급하는 위치 capability가 고정밀 monotonic 시각의 뺄셈 반올림 때문에 간헐적으로 거부되던 결함을 수정합니다. 원래 계산한 만료 합과 비교해 기존5분 lifetime·finite/safe timestamp·opaque identity·정확한 만료·철회·재생 거부 경계를 유지합니다. EPS 허용치나 권한 확대는 없습니다.

소스 PR #3319의 후보9228c1454393560bcd37240f793065e450f85683/tree d0cee44ace30d3a337b0fd8077032ed099cfb567와 같은 소스를 develop에서 data로 승격합니다. 변경 관련 full Ubuntu npm/Bun·Windows npm/Bun·JS/TS 분석·production build·필수 검사와 미해결 리뷰0을 확인했습니다. 수정 없는 추가 Swift 분석은 별도로 추적합니다. 로컬 unit10/128assertions, lint/parity0, build/CSS, offline Chromium3/3 및 실제 Chromium/V8 구성요소의 동일 조건 전후를 확인했습니다. 합성 clock/readiness이므로 실기기·정확한 위치·실사용자/field 검증으로 주장하지 않습니다.

기존 운영 readiness는 available 응답으로 관찰됐으며 이 패치는 그 설정·동의·좌표 획득·DB/Storage/DNS·유료 설정을 바꾸지 않습니다. 기존 failed CI/raw evidence를 보존합니다. 외부 교차 감사는 공개 최소 소스·단일 계획을 준비했으나 사용자의 공통 웹 예약 도구 대기 지시에 따라 전송하지 않았고 완료로 집계하지 않습니다. 정상 main 승격 뒤 정확한 Git SHA 배포와 실제 URL을 다시 검증합니다.
