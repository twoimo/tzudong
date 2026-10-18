# Tzudong 수치 안정성·모바일 렌더링·릴리스 교차 감사 계획

소스 `9228c1454393560bcd37240f793065e450f85683`, tree `d0cee44ace30d3a337b0fd8077032ed099cfb567`. 파일 9개가 포함된 유일한 `source_bundle.txt` SHA256 `9420e4c1a47230c305c98e9f739571f9a3c188919fac750ee0fd45635902a6ee`. 전부 공개 Git 저장소의 커밋된 소스이며, 인증·개인정보·정확한 위치·비공개 응답·전체 런타임 로그는 포함하지 않는다. 원본 데이터셋·영상·사용자 리뷰는 이 감사 범위 밖이다.

현재 운영은 main `2e5630fada4cd50fb71ff7542723ca6393afe7c0`, 배포 `dpl_8vFh9BJnQPLE9kvvrHrdgKqE8FDE`이다. 후보9228은 아직 승격/배포 전이다. 기존 app의 TypeScript/Bun/Next 검사와 보호된 develop→data→main 절차를 유지한다. 새 Cursor 키트/PDF/HTML은 요청되지 않았으므로 만들지 않는다.

## 아키텍처와 불변식

- I01: 서버 readiness 응답만 실제 메모리 내 opaque capability를 발급한다. WeakMap 원본 identity만 허용하고 clone·spread·재라벨·철회·만료 후 재생을 거부한다.
- I02: 기존5분 lifetime과 exact expiry boundary, finite/safe timestamps를 보존한다. EPS 허용치·권한 완화·법적 승인 추정을 도입하지 않는다.
- I03: readiness API는 운영에서 현재 available/VERIFIED 코드를 반환한다. 이는 이전 상태의 관찰이며 이 수정이 기능을 활성화한 것이 아니다. 코드 리터럴만으로 법적/운영 승인 증거를 인증하지 않는다. 동의·실제 좌표 획득·기기 동작은 이번 검증에서 실행하지 않는다.
- I04: 실험3D는 기본 off이고 공개 popularity cohort는 schema2/unpublished/entries0이다. 실제 사용자 gain을 주장하지 않는다.
- I05: 불확실/중간 모바일·터치 메모리는 정적 미리보기로 처리한다. 강력한 iPhone도 memory API가 없으면 정적 화면이 되는 trade-off를 공개한다. 전역 지도 tier 추정은 바꾸지 않았으므로 OS→model 추정의 별도 한계도 남아 있다.
- I06: 로컬 synthetic·actual software browser·물리 기기·field·운영 배포는 별도 증거다. 원래 메모리 guard·기기·field·고빈도 플리커 목표를 완료로 바꾸지 않는다.

## ADR 및 작업

ADR-01 / W001: fractional monotonic lifetime. `(262144.02702702704+300000)-262144.02702702704`는299999.99999999994이므로 올바른 capability를 거부한다. `expiresAt === grantedAt + lifetime`으로 원래 산술을 재평가한다. 기존 입력/identity/time 경계 유지 여부, 장기 uptime·NaN·Infinity·exact expiry·rewind·forge 공격을 반대 검토하라. 기존 소스에서 새 regression은9pass/1fail, 수정 후10pass/128assertions/0fail이다. 테스트는 실제 private API를 호출하지만 clock/fetch는 synthetic mock이므로 SYNTHETIC_MOCK_TESTED이다. 산술은 실행된 IEEE double 반례로 SOURCE_OBSERVED/CONTRADICTED 범위만 주장한다.

ADR-02 / W002: 모바일 experimental3D import gate. 기존 OS로 추정한 iPhone model 때문에 low flag가 false인 케이스를 합성 navigator로 재현했다. 실제 React/Nextdynamic/Three software GL 구성요소에서 phase당 독립 browser process1개,10 fresh profiles,각3종속 open/close/220ms 창이다. 6문제 프로필의 contexts3→0, cold 추가모듈1→0, 관찰 RAF13–14→0. 정상 desktop·알려진8GiB mobile·reduced motion·Escape containment·focus return·teardown이 통과했다. 이는 physical/field/process-memory/배터리/FPS/전체UI latency 성과가 아니다. CPU·메모리 navigator 값은 synthetic이고 hostCPU throttle은 없다. source bundle은 실제 caller/selector/renderer/lifecycle/관련 tests를 포함한다. 프로필 위장·API 미지원·SSR/hydration·클린업 경합을 검토하라.

ADR-03 / W003: 릴리스 및 성과 경계. 기존 운영 전후 Chromium153의1440×900/834×1112/430×860 실제Naver/marker/detail/review/stamp/ranking가 통과했다. asset4개 live/Git hash일치, pageerror0이다. CSP nelo/eval 및 announcements/ad_banners401이 남고, 엄격한 뒤로 가기 original marker visibility는 before/after 모두실패한다. diagnostic detailrestore3/3 통과가 strict failure를 대체하지 않는다. 정적map crop3개는 영상/한프레임 flicker 증거가 아니다. 타입체커 sampler73.3ms gap이60ms한도를 넘은 실패와 동일기준 rerun success를 보존했다. 이와 별개로 단위2개 실패가W001실제수치결함으로 재현됐다. CI노이즈로 뭉뚱그리거나 unrelated passing gates로 대체하지 않는다.

## 연구·출처 계약

ChatGPT 6 Pro + Deep Research thesis → Gemini4 Argon/maximum thinking + Deep Research antithesis → ChatGPT 동일조건 reverse audit. 계정/모델/사고/리서치 모드를 각각 현 UI에서 확인하고 backend identity·query count가 숨겨져 있으면 UNVERIFIED로 둔다. 보고서 전문, URL, 시각, 입력 plan/bundle hash를 보존한다. 로그인·정확한 조합이 없으면 그 외부 단계만 DEFER하며 낮은모델로 대체하지 않는다.

찬사·설계재진술·통과모듈 요약을 제외하라. 각 결함에 유도·근거7등급·W/ADR ID·실행 재현 또는 unified diff를 요구한다. ChatGPT안도 Gemini반론도 같은 입증 기준을 적용해 ACCEPT/CONDITIONAL/REJECT/DEFER로 판정한다. 누락된 원시측정·하드웨어·운영·법적 증거를 지어내지 않는다. 공개자료 업로드나 보고서는 배포·권한·과금·공개범위 변경 허가가 아니다.

## 재현과 판정

pinned Node24/npm11.6.2, Bun1.4.0, nativeTS7.0.2/compat6.0.2. W001: `bun test tests-unit/device-location-privacy.test.ts`; 기존2e소스에 후보 regression만 적용해 실패를 재현한다. 수정 뒤 정밀값3종의 즉시/만료직전 허용, exactexpiry거부, rewind후거부를 확인한다. targetedlint/parity 및 production build/CSS가통과했고 offlineproductionChromium3/3(5.5s)도 통과했다. sourcePR3319 CI는 현재진행중이다. 최종 source→protectedmerge→exactmain→READY/aliases→실제URL→해시map/원격바이트의 결합 증거를 요구한다.

모든 성능 수치는 비용이 낮을수록 좋을 때 절대감소before-after, 상대감소(before-after)/before×100이다. 0baseline·타이머해상도 미만·관찰되지 않은 환경에서는 비율을 계산하지 않는다. n1독립 browser process로 populationCI/p95를 주장하지 않으며 겹치는 자원 절감을 합산하지 않는다. 실제 서비스 성능 개선은 입증 안 됨으로 두고 버그/기능/구성요소 증거만 분리한다.
