if (typeof window !== 'undefined') throw new Error('Storyboard RAG capability is server-only.');

type RagWorkerEmbedItem = {
  dense: number[];
  sparse: Record<string, number>;
};

type RagWorkerEmbedResponse = {
  schemaVersion: 1;
  provider: 'gemini-api';
  fingerprint: string;
  model: string;
  dimensions: number;
  items: RagWorkerEmbedItem[];
};

type RagWorkerRerankCandidate = {
  id: string;
  content: string;
  metadata?: Record<string, unknown>;
  denseScore?: number | null;
  sparseScore?: number | null;
  weightedScore?: number | null;
};

type RagWorkerRerankResult = RagWorkerRerankCandidate & {
  rerankScore: number;
};

type RagWorkerRerankResponse = {
  schemaVersion: 1;
  provider: 'gemini-api';
  fingerprint: string;
  method: 'embedding_cosine';
  model: string;
  results: RagWorkerRerankResult[];
};

export const STORYBOARD_RAG_EMBEDDING_FINGERPRINT = 'gemini-embedding-001:1024:retrieval:l2:v1';
export const STORYBOARD_RAG_FINGERPRINT_KEY = 'storyboardEmbeddingFingerprint';
const REQUIRED_EMBED_MODEL = 'gemini-embedding-001';
const REQUIRED_RERANK_MODEL = REQUIRED_EMBED_MODEL;

export class StoryboardRagWorkerError extends Error {
  status: number;

  constructor(message: string, status = 503) {
    super(message);
    this.name = 'StoryboardRagWorkerError';
    this.status = status;
  }
}

function getStoryboardRagWorkerUrl(env: NodeJS.ProcessEnv) {
  const raw = env.STORYBOARD_RAG_WORKER_URL?.trim();
  if (!raw) {
    throw new StoryboardRagWorkerError('required_storyboard_rag_worker_url_missing', 503);
  }
  let url: URL;
  try { url = new URL(raw); } catch { throw new StoryboardRagWorkerError('required_worker_transport_invalid'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/'
      || (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:'))) {
    throw new StoryboardRagWorkerError('required_worker_transport_invalid');
  }
  return url.origin;
}

export function getStoryboardRagWorkerConnection(env: NodeJS.ProcessEnv = process.env) {
  const token = env.STORYBOARD_RAG_WORKER_TOKEN?.trim() ?? '';
  const outbound = ['GEMINI_CREDITS_API_KEY', 'STORYBOARD_GEMINI_API_KEY', 'GEMINI_API_KEY']
    .map((name) => env[name]?.trim()).filter(Boolean);
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(token) || outbound.includes(token)) {
    throw new StoryboardRagWorkerError('required_worker_capability_missing');
  }
  return { url: getStoryboardRagWorkerUrl(env), headers: { Authorization: `Bearer ${token}` } };
}

async function callStoryboardRagWorker<T>(path: string, body: unknown): Promise<T> {
  const connection = getStoryboardRagWorkerConnection();
  const controller = new AbortController();
  const timeoutMs = Math.max(1000, Number(process.env.STORYBOARD_RAG_WORKER_TIMEOUT_MS) || 120_000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${connection.url}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...connection.headers },
      redirect: 'error',
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new StoryboardRagWorkerError(
        `required_storyboard_rag_worker_failed:${response.status}`,
        response.status,
      );
    }
    try { return await response.json() as T; }
    catch { throw new StoryboardRagWorkerError('required_gemini_response_invalid', 503); }
  } catch (error) {
    if (error instanceof StoryboardRagWorkerError) throw error;
    throw new StoryboardRagWorkerError('required_gemini_response_uncertain_explicit_retry_required', 503);
  } finally {
    clearTimeout(timeout);
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function assertDenseVector(vector: unknown, context: string): asserts vector is number[] {
  if (!Array.isArray(vector) || vector.length !== 1024 || vector.some((value) => !isFiniteNumber(value))) {
    throw new StoryboardRagWorkerError(`required_bge_vector_invalid:${context}`, 503);
  }
}

function assertSparseWeights(sparse: unknown): asserts sparse is Record<string, number> {
  if (!sparse || typeof sparse !== 'object' || Array.isArray(sparse)) {
    throw new StoryboardRagWorkerError('required_storyboard_rag_worker_sparse_missing', 503);
  }
  const entries = Object.entries(sparse);
  if (entries.some(([key, value]) => !key.trim() || !isFiniteNumber(value))) {
    throw new StoryboardRagWorkerError('required_storyboard_rag_worker_sparse_invalid', 503);
  }
}

function assertRerankResults(
  results: RagWorkerRerankResult[],
  candidates: RagWorkerRerankCandidate[],
  topK: number,
) {
  const candidateIds = new Set(candidates.map((candidate) => candidate.id));
  const seen = new Set<string>();
  if (
    !Array.isArray(results) ||
    results.length === 0 ||
    results.length > Math.min(topK, candidates.length)
  ) {
    throw new StoryboardRagWorkerError('required_storyboard_rag_worker_rerank_results_invalid', 503);
  }
  for (const result of results) {
    if (!candidateIds.has(result.id) || seen.has(result.id) || !isFiniteNumber(result.rerankScore)) {
      throw new StoryboardRagWorkerError('required_storyboard_rag_worker_rerank_results_invalid', 503);
    }
    seen.add(result.id);
  }
}

export function serializePgVector(vector: number[]) {
  assertDenseVector(vector, 'pgvector');
  return `[${vector.map((value) => value.toFixed(8)).join(',')}]`;
}

export async function embedStoryboardRagTexts(texts: string[], task: 'RETRIEVAL_QUERY' | 'RETRIEVAL_DOCUMENT' = 'RETRIEVAL_DOCUMENT') {
  const result = await callStoryboardRagWorker<RagWorkerEmbedResponse>('/embed', { texts, task });
  if (result.schemaVersion !== 1 || result.provider !== 'gemini-api' || result.fingerprint !== STORYBOARD_RAG_EMBEDDING_FINGERPRINT || result.model !== REQUIRED_EMBED_MODEL || result.dimensions !== 1024) {
    throw new StoryboardRagWorkerError('required_storyboard_rag_worker_embed_contract_invalid', 503);
  }
  if (!Array.isArray(result.items) || result.items.length !== texts.length) {
    throw new StoryboardRagWorkerError('required_storyboard_rag_worker_embed_count_mismatch', 503);
  }
  for (const [index, item] of result.items.entries()) {
    assertDenseVector(item.dense, `embed:${index}`);
    assertSparseWeights(item.sparse);
  }
  return result;
}

export async function rerankStoryboardRagCandidates(args: {
  query: string;
  candidates: RagWorkerRerankCandidate[];
  topK: number;
  queryEmbedding?: { dense: number[]; fingerprint: string };
}) {
  if (args.queryEmbedding) {
    assertDenseVector(args.queryEmbedding.dense, 'rerank-query');
    const normSquared = args.queryEmbedding.dense.reduce((sum, value) => sum + value * value, 0);
    if (args.queryEmbedding.fingerprint !== STORYBOARD_RAG_EMBEDDING_FINGERPRINT ||
        !Number.isFinite(normSquared) || Math.abs(normSquared - 1) > 0.00001) {
      throw new StoryboardRagWorkerError('required_gemini_query_embedding_invalid', 503);
    }
  }
  const result = await callStoryboardRagWorker<RagWorkerRerankResponse>('/rerank', args);
  if (result.schemaVersion !== 1 || result.provider !== 'gemini-api' || result.fingerprint !== STORYBOARD_RAG_EMBEDDING_FINGERPRINT || result.method !== 'embedding_cosine' || result.model !== REQUIRED_RERANK_MODEL) {
    throw new StoryboardRagWorkerError('required_storyboard_rag_worker_rerank_contract_invalid', 503);
  }
  assertRerankResults(result.results, args.candidates, args.topK);
  const candidatesById = new Map(args.candidates.map((candidate) => [candidate.id, candidate]));
  return {
    ...result,
    results: result.results.map((reranked) => ({
      ...candidatesById.get(reranked.id)!,
      rerankScore: reranked.rerankScore,
    })),
  };
}
