# 공유 HTTP 상태 최종 후속

## 현재 제품 경로와 중간 결과

현재 `/s/[code]`는 `app/s/[code]/route.ts`의 HTTP GET transport입니다. invalid/missing는 **404**, provider/unavailable 및 제어 문자 target은 **503**, 허용된 review 및 unsafe-home fallback은 **307**입니다. HTML 안내와 noindex, 홈·재조회 링크를 함께 반환합니다. 상대 Location은 요청 Host로 절대화하지 않습니다. RSC 예외·전역 performance API·패키지·오류 수집기를 변경하거나 필터링하지 않았습니다.

이전 직접 `ShareRedirectNotice`를 return한 Page 버전은 invalid/missing/unavailable에 **200**을 반환했습니다. 그것은 정상 404 증거가 아니며 현재 제품 구현이 아닙니다. archive/direct-notice-page.tsx.txt와 notice fixture는 이 중간 상태를 명시적으로 재현합니다. React ShareRedirectNotice는 역사적 comparator fixture 지원이며 현재 HTTP route가 사용하지 않습니다.

## 실제 상태와 조건

| 조건 | 중간 notice dev/prod | 현재 handler dev/prod |
| --- | --- | --- |
| 무효 코드 | 200 | 404 |
| 없는 코드 | 200 | 404 |
| provider 읽기 실패 | 200 | 503 |
| 허용된 review target | 비교 대상 아님 | 307, 검증된 Location |
| unsafe target | 비교 대상 아님 | 307, `/` |
| CR/LF 등 C0 target | 비교 대상 아님 | 503, diagnostics 미노출 |

실제 기존 체크아웃 dev 19872의 invalid/missing GET도 404·pageerror 0입니다. controlled fixture production/development 최종 **14개 브라우저/API 사례**가 통과했고 unexpected 0입니다. status, Location, noindex, native 복구, overflow 0, keyboard focus 및 light/dark를 함께 확인했습니다(final-browser-results.json). 이전 12개 결과도 그대로 보존했습니다. Fixture 전용 read rows가 필요하므로 일반 운영 서버 runner에서는 명시적으로 prerequisite skip이며 이 skip을 통과로 세지 않습니다.

원본 notFound page 코드의 최소 fixture는 dev/prod 모두 404·오류 0이었습니다. 앞선 전체 체크아웃 dev의 TypeError 프레임은 React 개발 RSC `flushComponentPerformance/performance.measure`였습니다. 이 차이는 전체 앱의 layout/streaming/development 문맥에 국한된 재현이며 일반 notFound 결함이나 전체 production 성공/실패를 확정하는 증거가 아닙니다. 현재 handler는 이 RSC 경로에 의존하지 않고 명시적 HTTP 상태를 반환합니다. root의 최종 전체 web build는 별도 증거입니다.

## target·theme·lint

URL 검사 전에 C0/DEL을 차단해 parsing에서 제거된 원문이 Location header TypeError로 이어지지 않게 했습니다. provider/target 원문은 안내에 넣지 않습니다. 실제 HTTP C0 fixture는 503으로 끝납니다. 9개 read/HTTP 단위 사례, 20개 surface/SDK/title 계약과 1개 redirect security 사례가 통과했습니다. Type parity는 생성 타입만 갱신한 뒤 진단 0개입니다.

별도 문서는 canonical light 색상·기존 logo.webp·포커스 색상을 유지합니다. CSS만으로 OS dark/reduced-motion을 따릅니다. 앱에 저장된 수동 theme 선택과 Next local-font 런타임을 읽지 않으며 시스템 Korean font fallback을 사용합니다. dark/light 작은 화면의 focus와 넘침을 실제 검증했습니다.

Fixture next.config는 named default export로 정리했습니다. not-found baseline의 native anchor는 client navigation 경계를 넣지 않기 위한 목적을 밝힌 국소 directive로 유지했습니다. 해당 authored 2개와 최종 spec lint는 exit0입니다. Root가 exact fixture generated output만 별도 ignore하며 source 검사/예상 상태를 삭제하지 않았습니다.

## 재빌드·map·보존

fixture-production-final-rebuild.log는 현재 named configuration/현재 route 및 controlled C0 case를 사용하는 격리 production 재빌드 증빙입니다. final-artifact-map.json은 재구축 source, 측정 outputs 및 실제 재빌드 log만 SHA/크기로 묶습니다. Next 생성 directory, dependency symlink, 생성 타입 backup은 product source/measurement raw/map에 넣지 않습니다. 원래 66+15 raw와 이전 후속 증거는 수정하지 않았습니다.

## 종료 readback

owned-cleanup-readback.json에서 20370/20371 및 두 stub listener는 닫힘, 소유 harness process는 0개입니다. 기존 PID57309·19872는 유지됩니다. 종료된 fixture의 `.next`, `.next-dev`, `.next-production`와 검증된 node_modules symlink만 제거했습니다. 실제 shared node_modules는 유지했고 authored inputs·원시 측정·build log는 보존했습니다. prepare-fixture.mjs로 dependency link/input을 재구축할 수 있습니다. 생성 cache는 계속 보존할 필요가 없습니다.

유효 기존 링크의 운영 review 표시, live provider fault, 계정·지도·기기·배포 및 SQL 적용은 이 fixture의 성공으로 대체하지 않습니다. helper는 운영·원격 쓰기·paid call을 수행하지 않았습니다. root source freeze 이후 제품 source edit는 없습니다; 최종 보고·cleanup/map만 추가했습니다.
