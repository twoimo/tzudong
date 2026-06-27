type RagWorkerEmbedItem = {
  dense: number[];
  sparse: Record<string, number>;
};

type RagWorkerEmbedResponse = {
  schemaVersion: 1;
  provider: 'bge-m3';
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
  provider: 'bge-reranker-v2-m3';
  model: string;
  results: RagWorkerRerankResult[];
};

const REQUIRED_EMBED_MODEL = 'BAAI/bge-m3';
const REQUIRED_RERANK_MODEL = 'BAAI/bge-reranker-v2-m3';

export class StoryboardRagWorkerError extends Error {
  status: number;

  constructor(message: string, status = 503) {
    super(message);
    this.name = 'StoryboardRagWorkerError';
    this.status = status;
  }
}

function getStoryboardRagWorkerUrl() {
  const raw = process.env.STORYBOARD_RAG_WORKER_URL?.trim();
  if (!raw) {
    throw new StoryboardRagWorkerError('required_storyboard_rag_worker_url_missing', 503);
  }
  return raw.replace(/\/+$/, '');
}

async function callStoryboardRagWorker<T>(path: string, body: unknown): Promise<T> {
  const controller = new AbortController();
  const timeoutMs = Math.max(1000, Number(process.env.STORYBOARD_RAG_WORKER_TIMEOUT_MS) || 120_000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${getStoryboardRagWorkerUrl()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new StoryboardRagWorkerError(
        `required_storyboard_rag_worker_failed:${response.status}:${detail.slice(0, 300)}`,
        response.status,
      );
    }
    return await response.json() as T;
  } catch (error) {
    if (error instanceof StoryboardRagWorkerError) throw error;
    const reason = error instanceof Error ? error.name || error.message : 'unknown';
    throw new StoryboardRagWorkerError(`required_storyboard_rag_worker_unavailable:${reason}`, 503);
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
  if (entries.length === 0 || entries.some(([key, value]) => !key.trim() || !isFiniteNumber(value))) {
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

export async function embedStoryboardRagTexts(texts: string[]) {
  const result = await callStoryboardRagWorker<RagWorkerEmbedResponse>('/embed', { texts });
  if (result.schemaVersion !== 1 || result.provider !== 'bge-m3' || result.model !== REQUIRED_EMBED_MODEL || result.dimensions !== 1024) {
    throw new StoryboardRagWorkerError('required_storyboard_rag_worker_embed_contract_invalid', 503);
  }
  if (result.items.length !== texts.length) {
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
}) {
  const result = await callStoryboardRagWorker<RagWorkerRerankResponse>('/rerank', args);
  if (result.schemaVersion !== 1 || result.provider !== 'bge-reranker-v2-m3' || result.model !== REQUIRED_RERANK_MODEL) {
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
