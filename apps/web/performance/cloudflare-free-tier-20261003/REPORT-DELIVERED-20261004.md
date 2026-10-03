# Cloudflare 공개 대용량 파일 점검·전달

기존 코드의≥1MB 분류기는 발견했으나 실제 uploader와 production consumer 연결은 확인되지 않았다. 따라서 모든 대용량 파일을 이미 Cloudflare로 관리한다는 주장은 성립하지 않았다. 기존 Tzudong R2 bucket은1object/263bytes이고 public access는 이미 Enabled였다. 다른 프로젝트 bucket은 변경하지 않았다.

검증된 공개 Chosun font11,420,784bytes를 Standard R2에 hash 주소로1회 업로드했고, `assets.tzudong.app`의 managed R2 domain을 연결했다. 기존 www/root/MX/NS/tunnel을 변경하지 않았다. CORS는 www/root2origins와GET/HEAD/Range만 허용한다. 인증·쓰기 CORS를 추가하지 않았다. 1개의 cache rule은 이 host·정확한 파일·GET/HEAD만 대상으로 하며 origin을 포함하는 cache key를 유지한다. 임의 API/auth/dynamic 응답을 캐시하지 않는다. custom purge는 새 font URL1개에1회였다.

운영 main3aebb1c6의 legacy `/fonts/ChosunCentennial_otf.otf`는307/no-store/0B로 같은 R2 hash URL을 가리킨다. 실제 www의 CSP 아래에서 FontFace.load와 document.fonts.check가 통과했다. 원본 hash `8c2eeb55898708b108032eb0baddabfbf7c98a78c3411a2f2601c7bdeff1cfb7`, bytes, HEAD/Range206/1024B·OPTIONS204·허용/비허용 Origin 응답, MISS→HIT를 보존했다. root Origin의 MISS/HIT는 서로 다른 POP였으며 이를 동일 POP의 warm 개선으로 바꾸지 않는다.

| 흐름 | 환경·표본 수 | 지표 | Before | After | 절대 변화 | 상대 변화 | 노이즈·신뢰구간 | 판정 | 증거 경로 |
|---|---|---|---|---|---|---|---|---|---|
| 공개 font 저장/호환 전달 | public file1개·운영HTTPS | web public bytes |11,420,784|0·원본Git/source-fonts 및R2보존|11,420,784 이동|100% web public 경로 이동|패키지 inventory, 사용자 시간 CI아님|실제 운영 전달 확인|public-font-upload-readback-v1.json, ../render-flow-ui-cloudflare-20261003/live-ui-production-v1/raw.json|
| www Origin cache | credentialless GET2·같은HKG | CF cache status |MISS|HIT|상태 전환|계산 안 함|월 request/비용 절감 추정 안 함|캐시 동작 확인|public-font-cache-cors-readback-v2.json|
| CORS·range | 여러 고정 요청 | protocol·ACL |전달 미구현|approved origins/GET·HEAD/Range 정상|호환 전달 확보|계산 안 함|CORS는 인증 수단 아님|bounded path 확인|동일 readback|

2026-10-03 06:05UTC account storage display는474.98MB, 해당 billing period의 billable display는$0였다. 이 파일은11.42MB를 더한다. 이 시점 inventory는 평균 GB-month나 월말 요금 전망이 아니다. Standard 무료 기준10GB-month/ClassA1M/ClassB10M/no egress charge이며 IA에는 같은 무료 allowance가 없다. 유료 plan/Worker/용량 확대를 추가하지 않았다. [Cloudflare R2 가격 원문](https://developers.cloudflare.com/r2/pricing/).

실제 제품 font는Pretendard이며 Chosun의 app 소비자는 발견하지 못했다. 이 이동을 사용자 LCP/INP/초기 전송량 개선으로 보고하지 않는다. 기존 pipeline 분류기의 실운영 업로드 연결과 다른 모든 대용량 파일의 offload는 미입증이다. 공개 파일1개·CDN/CORS·운영 호환 URL의 한정된 완료다. UI 저장 증거는 `cache-rule-active-inspected-v1.jpg`와 복구 readback이며 account email·비공개 response·credentials를 포함하지 않는다.
