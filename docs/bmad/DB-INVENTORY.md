# DB Inventory (Supabase) - Backup 기준

- 기준 파일: `supabase/backup_db/backup_2026-02-08_004842.sql`
- 원격 최신 스키마 스냅샷: `supabase/.temp/remote_public_schema.sql` (schema-only, public)
- 주의: 덤프 이후(예: 2026-02-13) 마이그레이션/수정이 반영되어 있을 수 있습니다. **개발/디버깅은 원격 스냅샷을 SSOT로 삼습니다.**

## 0) 스키마 드리프트 주의 (중요)

`public.restaurants`는 현재 `trace_id` / `approved_name` 구조인데, DB 내 일부 RPC/함수는 과거 컬럼(`unique_id`, `name`, `youtube_links`, `tzuyang_reviews`)을 참조해 실행 시 오류가 발생할 수 있습니다.

- 예: `approve_submission_item`, `approve_new_restaurant_submission`, `approve_edit_restaurant_submission`, `check_restaurant_duplicate`, `get_approved_restaurants`

## 1) 쯔양 대시보드 핵심 테이블

### `public.restaurants` (대시보드 SSOT)

- 용도: 쯔양 맛집 단위 레코드 + 평가 파이프라인 산출물(`evaluation_results`) 저장
- Key
  - PK: `id uuid`
  - Unique: `trace_id text`
- 주요 컬럼
  - 식당: `approved_name`, `categories text[]`, `phone`
  - 위치: `lat`, `lng`, `road_address`, `jibun_address`, `english_address`, `address_elements jsonb`, `origin_address jsonb`
  - 영상 연결: `youtube_link`, `youtube_meta jsonb`, `channel_name`
  - 평가/상태: `evaluation_results jsonb`, `reasoning_basis`, `source_type`, `status`, `is_missing`, `is_not_selected`, `geocoding_success`, `geocoding_false_stage`
  - 운영 지표: `search_count`, `weekly_search_count`, `created_at`, `updated_at`
- RLS(덤프 기준)
  - `SELECT USING (true)` (읽기 공개)
  - `UPDATE`는 관리자만 허용( `user_roles.role = admin` )
- 적재 파이프라인(코드 근거)
  - `backend/restaurant-evaluation/scripts/12-supabase-insert.py`
    - `transforms.jsonl` -> `restaurants` upsert
    - `on_conflict="trace_id"`

### `public.videos`

- 용도: 유튜브 영상 메타데이터(조회수/태그/광고/히스토리 등)
- Key
  - PK: `id text` (YouTube video_id)
- 주요 컬럼
  - `published_at`, `duration`, `view_count`, `like_count`, `comment_count`
  - `latest_recollect_id`, `is_shorts`, `is_ads`
  - `youtube_link`, `channel_name`, `title`, `description`, `category`
  - `tags text[]`, `advertisers text[]`, `recollect_vars text[]`, `meta_history jsonb`
- Index(덤프 기준)
  - 조회/정렬: `published_at DESC`, `view_count DESC`
  - 검색: `title/description` FTS GIN, `tags/recollect_vars` GIN
- 적재 파이프라인(코드 근거)
  - `backend/restaurant-crawling/scripts/02.1-migrate-meta-to-supabase.py`

### `public.video_frame_captions`

- 용도: “가장 많이 다시 본 장면” 등 구간별 캡션/키워드
- Key
  - PK: `id bigint`
  - Unique: `(video_id, recollect_id, start_sec)`
- 주요 컬럼
  - `video_id`, `recollect_id`, `start_sec`, `end_sec`, `duration`, `rank`
  - `raw_caption`, `chronological_analysis`, `highlight_keywords text[]`
- RLS(덤프 기준)
  - `SELECT USING (true)`
  - `INSERT/UPDATE`는 `service_role`로 제한
- 적재 파이프라인(코드 근거)
  - `backend/storyboard-agent/scripts/02-video-caption-store-supbase.py`

### `public.transcript_embeddings_bge`, `public.document_embeddings`

- 용도: 자막 chunk 임베딩(semantic search/RAG 기반 인사이트)
- Key
  - Unique: `(video_id, chunk_index, recollect_id)`
- Index(덤프 기준)
  - `HNSW` 벡터 인덱스, `video_id`/`recollect_id` BTree
  - `transcript_embeddings_bge.sparse_embedding` GIN
- 적재 파이프라인(코드 근거)
  - `backend/storyboard-agent/scripts/01-bge-embed-and-store-supabase.py` (`transcript_embeddings_bge`)
  - `backend/storyboard-agent/scripts/99-openai-embed-and-store-supabase.py` (`document_embeddings`)

## 2) 사용자/커뮤니티 테이블(대시보드 보조 지표)

- `public.reviews`, `public.review_likes`
- `public.user_bookmarks`
- `public.profiles`, `public.user_stats`
- `public.notifications`

## 3) 운영/관리 테이블(관리자 대시보드 보조)

- 권한: `public.user_roles` ( `app_role` = `admin|user` )
- 배너/공지: `public.ad_banners`, `public.announcements`
- 로그/비용: `public.ocr_logs`, `public.search_logs`, `public.server_costs`
- 사용자 제보: `public.restaurant_requests`, `public.restaurant_submissions`, `public.restaurant_submission_items`
- 공유 링크: `public.short_urls`

## 4) Legacy/주의 사항

- 덤프에는 `restaurants_backup`, `restaurants_duplicate`가 같이 존재합니다.
  - 현재 웹앱은 대부분 `public.restaurants`를 직접 조회합니다.
  - `mv_restaurant_stats` 등 일부 Materialized View는 `restaurants_backup` 기반 정의가 남아있어, 재사용 시 기준 테이블을 재확인해야 합니다.
