# 전체 롱폼·OSK 후속 상태 — 2026-10-09

현재 공개 탭 membership의 롱폼 분모는 **1,071편**(videos 1,053 + 완료 streams 18)이며 shorts 81편은 제외했다. 재생시간 합계는 1,216,100초(337.81시간)다. canonical 6일 inventory 1,070편에서 `FOmKdeHoFIs` 980초 1편이 추가됐고 제거는 없다. 기존 4일 repository inventory 1,069편과 구분한다. 공개 flat metadata를 한 번씩 읽었으며 collector·caption 다운로드·모델 호출은 수행하지 않았다.

| 증거 단계 | 현재 분모 1,071 대비 | 의미와 한계 |
| --- | ---: | --- |
| 개별 metadata 저장 | 611 (57.05%) | flat membership export와 별개; 미저장 460 |
| caption source 저장 | 612 (57.14%) | 구조/hash 검증이 의미 검증은 아님; 미저장 459 |
| caption 1차 검토 | 9 (0.84%) | 46개 후보·질문·차이; 독립 영상/음성 검증 아님 |
| 준비됐지만 미검토 caption | 603 | 준비를 분석 완료로 계산하지 않음 |
| 검증된 모델 full-clip 보고서 | 2 (0.19%) | QWtvZ6NfNJ8 1,008초, -8wi-fVqTwk 943초; 합계 1,951초, 모델 관찰 |
| 모델 불확실/거부 | 1 | -1OU4tkFJns, ANALYSIS_EVIDENCE_INVALID; 완료 아님 |
| 독립 전체 시각 분석 완료 증거 | **0 (0%)** | F93TnnxCNvY 6 frame의 부분 관찰은 전체 분석이 아님 |
| 독립 음성 확인 완료 증거 | **0 (0%)** | caption 부정문 충돌 등 미해결 |

`video-coverage-ledger.json`은 1,071개 ID별 저장·검토·모델 receipt·OSK source 연결을 분리한다. false 독립 완료는 조사한 증빙에 완료 근거가 없다는 뜻이며, 누군가 영상을 본 적이 없다는 주장이 아니다. 구간/시각/음성의 독립 completion receipt가 아직 없어 전체 시각 검증 시간을 산정할 수 없다. 모델 보고서의 both/audio/visual modality를 사람의 독립 관찰로 승계하지 않는다.

현재 1,739 tracks/635,851 cues는 source corpus 수치다. 44편의 45 tracks는 metadata duration보다 종료 cue가 길다. 43 ko-orig는 2.009–2.400초, hxzpt-Itf_Q의 en/ko는 10.253초 초과이며 원인은 미확인이다. `audit.json`의 first-pass 6은 오래된 snapshot이고 최신 caption-review-status의 9를 사용한다. source queue는 429/exit75로 paused이며 미수집 459는 canonical 분모 기준이다. 새 공개 1편은 canonical queue에 등록되지 않았다. 관측 시 관련 실행 프로세스는 없었고 queue를 재개하지 않았다.

OSK session `tzudong` overview와 정확한 노드 readback을 사용했다. 다른 scope search는 하지 않았다. 해당 scope markdown은 31개: model-derived 20 + caption 9 + hub/coverage 2다. typed metadata가 있는 21개와 없는 10개를 구분한다. 모델 2편 publication checkpoint의 complete는 저장/readback 완료이며 독립 검증 완료가 아니다. 9개 caption 노드 중 직접 읽은 Ck5/F93은 원문 연결이 있으나 `Tzudong graph metadata`가 없어 현재 typed projector의 입력이 아니다. 별도 channel API의 nodes 1,123/claims 46 수치를 OSK vault 또는 웹 export 개수로 쓰지 않는다.

현재 고정 production local reader는 21 nodes/79 edges를 정상 읽었다. QW 검색 1, Ck5 검색 0이며 export는 4일 generation과 eligible 1,069/analyzed 0을 유지한다. 이는 **stale materialization 및 typed caption integration 미완료**다. 확인된 renderer/source 결함은 없어 소스를 수정하지 않았다. 인증 HTTP route·브라우저·배포 viewer 정상화는 미확인이다. source의 requireAdmin/no-store/hash admission을 유지해야 한다.

claude-video의 실제 경로는 pinned watch commit `03ceb42f7fa2c4439aca01752118044baabffb8f` → adapter → countTokens/Interactions → 검증된 analysis/receipt → OSK publication → scope projection → 웹 fixed reader다. 정확 모델 `gemini-3.8-flash`, 원본 model evidence와 quota를 유지했다. 현 source의 segmented protocol2는 900초 이하 segment별 countTokens+generation 2 calls를 예약한다. 기존 성공 legacy receipt 2편은 현재 cached_state admission으로 재사용 가능하나 기존 pilot 1/root-two 2 call batch는 이미 예약되어 재실행 권한이 아니다. 비용·현재 funded key·현재 provider 모델 가용성은 미확인이다.

추가 재개 blocker: projection의 4개 API 파일 pin은 일치하지만 publication 전체 engine pin은 불일치다. 요구 `fb25fd8c29688d5672795cc1bb84a8bfc0fb2752bdcf887f42032fad6bd2eed5`, 현재 `790bb32659f203c85613146fb06b8bb10c2ef404d8ec88547aded63e125f8358`; 그대로 실행하면 OSK_ENGINE_UNSUPPORTED로 거부된다. 현재 engine Git HEAD `627f2bfaa9d7fa774daf152cada1c50d0b4b0ef9`. pin 단순 완화나 예전 증빙 승계 없이 공식 변경 diff·읽기/쓰기/CAS/격리 scope 계약을 검토하고 호환 runtime을 검증해야 한다.

실행 가능한 다음 순서는 다음과 같다. 이번 작업에서는 준비와 읽기만 수행했다.

1. **비유료 caption 검토 target `8UGfYqX9HbM`**: 준비 큐 첫 항목의 기존 source/hash/track/cue를 읽고 1차 검토를 수행할 수 있다. 저장·OSK 반영은 별도 쓰기 단계이며 전체 영상 완료로 올리지 않는다.
2. **독립 확인 target `Ck5UrobZuKA`**: ko 839.244초와 ko-orig 836.920–842.430초의 사과 부정문 충돌을 실제 음성으로 확인한다. 기존 VTT만으로 판정을 확정할 수 없다. 합법적으로 접근 가능한 해당 clip/audio와 독립 확인 receipt가 필요하며 이번 작업에서 media 다운로드는 하지 않았다.
3. **수집 target `O_hj9Ge-Fdk`**: caption은 있고 metadata가 없다. 마지막 bounded resume가 같은 ID에서 429/exit75였다. fresh network/quota admission과 명시적 재개 권한 없이는 재시도하지 않는다. 새 `FOmKdeHoFIs`를 authoritative inventory에 반영하는 쓰기도 별도다.
4. **신규 claude-video target `FOmKdeHoFIs`**: 980초이므로 현재 protocol 기준 900+80초 2 segments, 최대 예약 4 provider calls다. 새로운 exact inventory/config binding, fresh official model capability, funded quota/cost 상한과 새 batch 권한이 필요하다. 원래 모델을 바꾸거나 기존 2-call batch를 재사용하지 않는다.
5. **거부 재검토 `-1OU4tkFJns`**: 780초이며 저장된 invalid receipt만으로 원문을 복구할 수 없다. 이전 producer/receipt/config의 exact provenance를 묶은 명시적 repair admission이 필요하다. interaction ID가 없는 legacy 불확실 응답을 자동 재송신하지 않는다.
6. **그래프 최신화**: publication full pin 해결 → caption evidence를 원문/hash/uncertainty 보존하는 typed 계약으로 검증 → tzudong-only projection/export → 실제 reader/인증 API/browser readback. 현재 global-index를 로딩하는 projector를 이번 scope read-only audit에서 실행하지 않았다. 정규화가 독립 관찰 status를 만들어서는 안 된다.

공식 원문과 설치본 대조: [yt-dlp maintained README](https://github.com/yt-dlp/yt-dlp), [official releases](https://github.com/yt-dlp/yt-dlp/releases/latest), [claude-video publisher](https://github.com/bradautomates/claude-video), [OSK publisher](https://github.com/lpaiu-cs/osk-system), [Gemini video understanding](https://ai.google.dev/gemini-api/docs/video-understanding). yt-dlp installed/latest stable은 모두 2026.08.19이며 upgrade 없이 `--ignore-config --no-cache-dir --flat-playlist --skip-download --dump-single-json --retries 0 --extractor-retries 0 --socket-timeout 10`으로 공개 videos/shorts/streams를 각각 export했다. 원문 response는 해시만 남기고 개인 contact/description은 증빙에 보존하지 않았다.

collector/model/OSK/profile/운영 writes·paid calls·원격 메시지·개인 memory 변경은 0건이다. v3 root PG17 container/DB 및 다른 작업자의 컨테이너를 사용하거나 변경하지 않았다. 배포·운영 성공·전체 분석 완료는 주장하지 않는다.
