# Restaurant Pipeline - 전체 흐름

## 크롤링 (restaurant-crawling)

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│                                  크롤링 파이프라인                                    │
└──────────────────────────────────────────────────────────────────────────────────────┘

01-collect-urls.py          YouTube 채널에서 영상 URL 수집
         │                  → data/{channel}/urls.txt
         ▼
02-collect-meta.py          영상 메타데이터 수집 (제목, 조회수, 좋아요 등)
         │                  → data/{channel}/meta/{video_id}.jsonl
         ▼
03-collect-transcript.js    자막 수집
         │                  → data/{channel}/transcript/{video_id}.jsonl
         ▼
04-collect-heatmap.js       히트맵 데이터 수집
         │                  → data/{channel}/heatmap/{video_id}.jsonl
         ▼
05-extract-place-info.js    [정육왕 only] 영상 설명에서 가게 정보 추출
         │                  → data/{channel}/place_info/{video_id}.jsonl
         ▼
06-gemini-crawling.sh       Gemini CLI로 음식점 정보 추출
         │                  → data/{channel}/crawling/{video_id}.jsonl
         │                     (channel_name 포함)
         ▼
```

---

## 평가 (restaurant-evaluation)

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│                                  평가 파이프라인                                      │
└──────────────────────────────────────────────────────────────────────────────────────┘

         입력: data/{channel}/crawling/{video_id}.jsonl
         │
         ▼
07-target-selection.py      평가 대상 선정
         │                  - name + address 있음 → evaluation_target = True
         │                  - name + address null → evaluation_target = False
         │                  - name 없음 → notSelection
         │                  
         │                  → data/{channel}/evaluation/selection/{video_id}.jsonl
         │                  → data/{channel}/evaluation/notSelection/{video_id}.jsonl
         ▼
08-rule-evaluation.py       RULE 평가 (네이버 API)
         │                  - 네이버 검색 API로 상호명 검색
         │                  - NCP 지오코딩으로 주소 검증
         │                  - 1단계: 지번주소 일치
         │                  - 2단계: 20m 거리 매칭
         │                  
         │                  → data/{channel}/evaluation/rule_results/{video_id}.jsonl
         │                     (naver_name 포함)
         ▼
09-gemini-evaluation.sh     LAAJ 평가 (Gemini CLI)
         │                  - visit_authenticity (방문 여부)
         │                  - rb_inference_score (추론 합리성)
         │                  - rb_grounding_TF (근거 일치도)
         │                  - review_faithfulness_score (리뷰 충실도)
         │                  - category_TF (카테고리 정합성)
         │                  
         │                  → data/{channel}/evaluation/laaj_results/{video_id}.jsonl
         │
         │  (실패 시)
         ├──────────────────→ data/{channel}/evaluation/errors/{video_id}.jsonl
         │
09.5-retry-errors.sh        실패 재시도
         │
         ▼
10-transform.py             결과 변환
         │                  - trace_id = hash(youtube_link + used_name + review)
         │                  - trace_id_name_source = "naver_name" or "original"
         │                  
         │                  → data/{channel}/evaluation/transforms.jsonl
         ▼
11-supabase-insert.py       Supabase DB 삽입
         │                  - trace_id 기반 중복 검사
         │
         ▼
                            Supabase restaurants 테이블
```

---

## 정육왕 vs 쯔양 차이점

| 항목 | 쯔양 (tzuyang) | 정육왕 (meatcreator) |
|------|----------------|----------------------|
| 05-extract-place-info | ❌ 사용 안함 | ✅ 영상 설명에서 가게정보 추출 |
| crawling 프롬프트 | crawling_prompt.txt | crawling_with_place_data.yaml (예정) |
| place_info 폴더 | ❌ 없음 | ✅ 있음 |

---

## 데이터 흐름 요약

```
YouTube 채널
     │
     ▼
urls.txt ──→ meta/{video_id}.jsonl
                    │
                    ▼
          transcript/{video_id}.jsonl
                    │
                    ▼
         [정육왕] place_info/{video_id}.jsonl
                    │
                    ▼
          crawling/{video_id}.jsonl  ← channel_name 포함
                    │
     ┌──────────────┴──────────────┐
     │                             │
  selection/                 notSelection/
  {video_id}.jsonl           {video_id}.jsonl
     │
     ▼
rule_results/{video_id}.jsonl  ← naver_name 포함
     │
     ▼
laaj_results/{video_id}.jsonl
     │
     ▼
transforms.jsonl  ← trace_id, trace_id_name_source 포함
     │
     ▼
Supabase
```

---

## 실행 순서

```bash
# 크롤링
python 01-collect-urls.py --channel tzuyang
python 02-collect-meta.py --channel tzuyang
node 03-collect-transcript.js --channel tzuyang
node 04-collect-heatmap.js --channel tzuyang
# node 05-extract-place-info.js --channel meatcreator  # 정육왕만
./06-gemini-crawling.sh --channel tzuyang

# 평가
python 07-target-selection.py --channel tzuyang --data-path data/tzuyang
python 08-rule-evaluation.py --channel tzuyang --data-path data/tzuyang
./09-gemini-evaluation.sh --channel tzuyang --data-path data/tzuyang
./09.5-retry-errors.sh --channel tzuyang --data-path data/tzuyang
python 10-transform.py --channel tzuyang --data-path data/tzuyang
python 11-supabase-insert.py --channel tzuyang --data-path data/tzuyang
```
