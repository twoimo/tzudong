-- Drop the existing unique constraint
ALTER TABLE document_embeddings 
DROP CONSTRAINT IF EXISTS document_embeddings_video_id_chunk_index_key;

-- Add new unique constraint including recollect_id
ALTER TABLE document_embeddings 
ADD CONSTRAINT document_embeddings_unique_version 
UNIQUE (video_id, chunk_index, recollect_id);

-- Update index for faster filtering by recollect_id
CREATE INDEX IF NOT EXISTS idx_embeddings_video_recollect 
ON document_embeddings(video_id, recollect_id);
