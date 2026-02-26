-- Create document_embeddings_bge table (BGE-M3, 1024 dimension)
CREATE TABLE IF NOT EXISTS document_embeddings_bge (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    video_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    recollect_id INTEGER NOT NULL DEFAULT 0,
    page_content TEXT NOT NULL,
    embedding vector(1024), -- BGE-M3 dimension
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Unique constraint for versioning
    CONSTRAINT document_embeddings_bge_unique_version UNIQUE (video_id, chunk_index, recollect_id)
);

-- Enable RLS
ALTER TABLE document_embeddings_bge ENABLE ROW LEVEL SECURITY;

-- Create policy to allow read access
CREATE POLICY "Allow read access for all users" ON document_embeddings_bge FOR SELECT USING (true);

-- Create policy to allow insert/update/delete for authenticated users (service role)
CREATE POLICY "Allow all access for service role" ON document_embeddings_bge FOR ALL USING (true) WITH CHECK (true);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_bge_embeddings_video_id ON document_embeddings_bge(video_id);
CREATE INDEX IF NOT EXISTS idx_bge_embeddings_video_recollect ON document_embeddings_bge(video_id, recollect_id);

-- HNSW index for vector search (Cosine Similarity)
CREATE INDEX IF NOT EXISTS idx_bge_embeddings_vector ON document_embeddings_bge 
USING hnsw (embedding vector_cosine_ops);
