-- 인덱스: transcript_embeddings_bge 테이블의 video_id 인덱스 (성능 최적화)
create index if not exists idx_transcript_embeddings_bge_video_id on transcript_embeddings_bge(video_id);
