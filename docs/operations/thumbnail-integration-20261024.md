# 썸네일 후보 통합 검증 — 운영 미반영

PR [#3515](https://github.com/twoimo/tzudong/pull/3515)의 `ee1a518d6017fc613749c613f4027a7ea0978896`에서 시작한 후속 수정이다. 기존 develop 통합, 기본 권한 수정과 동선 예산 복구 후보는 유지한다. 새 후보가 운영에 설치·배포됐다는 기록이 아니다.

## 실제 실패와 수정

| 경계 | 수정 전 관측 | 수정 후 관측 |
| --- | --- | --- |
| 웹/작업자 의존성 | API가 입력 준비와 오류 타입을 SDK 작업자 모듈에서 가져와 webpack이 `backend/utils/provider-budget.mjs`의 네이티브 경로를 해석하다 실패 | 키와 예산 실행이 없는 이미지·채팅 입력 모듈로 분리. API는 입력 모듈을 사용하고 작업자만 예산·SDK 실행을 유지. 이전 export는 같은 클래스·함수를 재노출 |
| 격리 빌드 실행 | `.next-pr3515-47ecb50a` 빌드는 성공했지만 standalone 실행/정적 파일 복사가 기존 `.next`를 사용. 서로 다른 BUILD_ID 확인; 브라우저 fixture 목록이 비어 검사 실패 | standalone 실행·static/public 복사가 같은 검증된 `TZUDONG_NEXT_DIST_DIR`를 사용. 기본 `.next` 동작도 유지. 두 빌드가 공존하는 실행 회귀 검사에서 선택한 서버·자산의 일치와 다른 빌드 보존 확인 |
| CI 진단 | child 출력 전체를 버려 실패 단계가 일반 코드로만 표시 | 원본 child 진단은 계속 버리고 install/build/CSS/browser의 고정 실패 코드만 반환. 제어된 실패 실행으로 private 진단 미전달 확인 |
| Ubuntu 단위 검사 | Mac 전용 `/usr/bin/sandbox-exec`를 직접 호출하는 실제 SDK 검사 2개와 폐기한 OAuth/API-key/SSE를 요구하는 source 계약 3개 실패 | 모든 플랫폼에서 실제 SDK의 합성 HTTP·비덮어쓰기 검사를 실행. Mac에서는 추가 OS 네트워크 차단 실행도 유지. 브라우저 관리자 gate와 작업자 전용 인증을 정확한 route/member 목록으로 검증하고 bounded error/기존 편집 controls 유지 |

입력 분리 전의 실제 Git 모듈과 비교한 합성 **이미지 12건·채팅 18건**에서 입력 digest, provider 입력과 정규화 이미지 bytes가 모두 같았다. re-export의 클래스·함수 identity도 같았다. 전체 입력 공간이나 서로 다른 OS encoder에 대한 증명이 아니며 실제 공급자 생성 호출은 0회다.

## 실행 증거와 한계

[artifact map](../evidence/thumbnail-integration-20261024/artifact-map.json)은 초기 실패와 후속 성공을 서로 다른 영수증으로 보존한다.

- Node **24.22.0**, npm **11.6.2**, Next **16.4.2**, Bun **1.4.0**의 전체 dependency proof가 종료 코드 0으로 끝났다. package install/lock 검증 → webpack production build → route CSS → 기존 실제 Chromium 검사 순서를 유지했다. 실패 단계를 숨기거나 browser assertion을 줄이지 않았다.
- Chromium 기존 검사 **3/3**, flaky·skip·실패 0. 키보드 선택·포커스 복귀, pointer/keyboard 패널 크기와 상한·하한을 확인했다. 선택 빌드 실행기 관련 **11개 검사·110 assertions**도 통과했다.
- 수정한 다섯 계약/Storage 파일의 검사 **97개·4,421 assertions**가 통과했다. 이후 허용되지 않은 추가 HTTP handler를 거부하는 검사를 더 강화했으므로 최종 전체 inventory와 CI 결과를 별도로 확인한다.
- native/compat TypeScript parity는 **3,427 logical inputs·진단 0**. EOF 공백 정리 후 최종 입력 이름 SHA는 `0c2743985b96e4f08b277a8b25c4312daf2f92108af5d7c6a926b24ed5d27488`, 비표준 library 내용 SHA는 `1693a54e14c8130cc91df6dee70d8ab78490ac0641150fc79ae2eb5d103f5a6a`다. 프로젝트 pin을 변경하지 않았다.
- 입력 모듈 두 개를 PG 실행 영수증의 소스 목록에 추가한 실제 PostgreSQL **17.11** 검사 **31개**와 Python driver 부재를 명시적 skip으로 처리한 동선 복구 검사 **16개**가 통과했다. 두 cluster의 source stable·PID/socket 부재·TCP 종료를 확인했다. driver 부재 probe의 skip은 DB 통과 수에 포함하지 않는다.

이는 합성 계약·결정적 반례의 로컬 결과다. 성공률 표본, 비용 절감, 점근적 개선이나 운영 성능에 대한 95% 구간을 만들지 않는다. Linux/Windows의 합성 HTTP 검사는 OS egress 격리의 증명이 아니다. 실제 PostgREST·Storage·작업자·공급자 호출 및 운영 PG17.6의 완료 증거도 아니다.

첫 canonical 전체 실행의 일반 그룹은 **4,129 pass·1 fail·4 skip·95,224 assertions**였으며 뒤의 격리 그룹은 실행되지 않았다. 실패는 지식 그래프 검색 대기 표시의 60초 timeout이다. 같은 browser 파일의 **4개 검사는 변경 없이 단독 8.13초에 통과**했다. 혼합 실행의 원인은 미확정이므로 앱 결함을 고쳤다고 주장하지 않는다. 기존 실행기의 isolated 목록에 해당 파일을 추가해 동일한 네 검사를 유지했다. 후속 canonical 실행은 **4,386 pass·0 fail·12 skip·97,860 assertions**, 일반 그룹과 24개 격리 그룹 모두 종료 코드 0이었다. 변경 소스 21개 SHA의 전후 일치와 실행 종료 시 HEAD `a287916afe9f13cd2bae1fd0fcd1d6d145a30b57`를 확인했다. 전체 소스/실행 영수증은 `canonical-unit-isolated-final.json`에 보존한다. 최초 전체 실행의 증거 수집기는 app-relative Git 경로를 잘못 거르면서 빈 source snapshot을 만들었으므로 source 안정성 증거로 쓰지 않는다. 재실행은 HEAD와 변경 소스 21개의 SHA를 실제 전후 기록한다.

입력 비교·production proof 영수증 이후 입력 파일 두 개의 EOF 빈 줄만 제거했다. 해당 byte delta는 `eof-normalization.json`에 별도 보존하고, 최종 source hash로 실제 PG31 검사와 parity를 다시 확인했다. 종전 영수증을 새 소스 실행처럼 덮어쓰지 않았다.

## 남은 운영 전달

코드 head `a287916afe9f13cd2bae1fd0fcd1d6d145a30b57`의 CI는 Install·Ubuntu npm·Swift를 포함해 모두 terminal이고 실패/대기 0이다. 정확한 결과는 `ci-a287916a-terminal.json`에 보존한다. 실제 독립 Pro → Gemini → Pro 검토는 여전히 미완료다. 기존 외부 예약 7건을 보존했고 공유 admission의 양쪽 service free slot은 0, send permission은 false였다. 다른 소유자의 진행·불확실 상태를 정리하거나 모델·계정을 바꿔 우회하지 않았다.

새 썸네일 schema/RPC와 private bucket은 운영에 없다. 후보 SQL은 applied migration이 아니며 현재 G014·PG17.6·새 admission·검증된 migration executor/owner lease·현재 writer fence의 apply/readback이 남아 있다. [동선 예산 후보](provider-budget-bridge-20261024.md)도 운영 미적용이다. 과거 SQL 승인/중지 답변은 현재 실행 영수증으로 승계하지 않는다. 외부 검토·설치 준비 뒤 정상 `develop → data → main`, 최신 production rollback SHA 확인, 배포 SHA/alias와 인증된 실제 업무 흐름을 검증한다.


현재 G014 두 assertion의 본문 SHA와 소유자는 읽기 전용 hosted 재조회에서도 같았다. 현재 MCP 연결자의 EXECUTE는 둘 다 false이고, PG17.6의 thumbnail schema/RPC/bucket은 여전히 없다. 실제 assertion 실행·역할 전환·권한 확대는 하지 않았다. 두 assertion의 service-only invoker 분기는 각각 25개 기존 identity를 명시하며 신규 썸네일 RPC 3개는 포함하지 않는다. 새 설치 명세는 이 정확한 3개 identity와 registry를 함께 수렴시키고 원래 25개 및 assertion metadata를 보존해야 한다. 이는 후속 검토/구현 조건이지 적용 완료된 SQL이 아니다.

기존 로컬 catalog 실행기의 Docker endpoint 검사는 현재 `desktop-linux` 경로를 `catalog_local_docker_endpoint_denied`로 거부했다. context·socket·backend를 바꾸지 않았으며 이 경로의 PG17.6/full catalog 실행은 미완료다. 기존 17.11 소유 fixture의 성공을 대체 증거로 쓰지 않는다.

위 문단은 해당 이전 실행기의 관측이다. 후속에서는 프로젝트의 canonical catalog endpoint resolver가 허용한 기존 `colima-tzudong-catalog-20261007`과 소유 자원을 사용해 [실제 PG17.6 전체 설치·롤백](thumbnail-g014-registration-20261024.md#pg176-전체-설치-리허설--244f886c-운영-미적용)을 마쳤다. 기본 Docker context와 다른 소유자의 자원은 보존했다. 이어 썸네일 설치 이후의 [예산 브리지 전체 G014·실제 auth/RPC 검사](provider-budget-bridge-20261024.md#후속-썸네일-설치-이후-실제-pg176-검증)도 통과했다. 이전 adapter가 통과한 것으로 바꾸거나, 이 격리 결과를 새 운영 admission·writer fence·hosted 적용·provider 생성 증거로 해석하지 않는다.

독립 검토 재개용 source bundle은 소스 head와 editor caller/queue/worker/budget/G014 preimage에 결속해 로컬에 준비했다. 최신 준비본은 33 entries·628,721 bytes·SHA-256 `90471b4f6d1d38191ab029de6a76e2c6feb563e4596f80ad9086cc3ffe967711`이다. 기존 7개 원본 예약을 바꾸지 않았으며 새 예약·업로드·전송 0회다. 이 준비는 검토 완료가 아니다.

후속 CodeQL alert 98은 browser fixture의 합성 owner 값을 실행 코드 문자열에 넣는 지점을 지적했다. 해당 module을 정적 소스로 만들고 Playwright 인자로 owner를 전달하도록 수정했으며 보안 예외 처리는 하지 않았다. 실제 Chrome 156의 기존 편집기 흐름을 1440·768·390 폭에서 재실행했고 source 13개 안정·enqueue 5회·chat 5회·외부 요청 0회를 확인했다. 대상 ESLint도 오류·경고 0이다. [현재 증거와 제한](../evidence/thumbnail-g014-registration-20261024/prior-observation-reconciliation.json)은 합성 인증/API의 로컬 검사이며 새 head의 원격 CodeQL 재분석·운영 적용은 별도다.
