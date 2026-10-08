import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import {
  buildStoryboardRagErrorStatus,
  buildStoryboardRagFailureStatus,
  type StoryboardRagFailureStage,
} from '@/lib/admin/storyboard/rag-error-status';
import {
  buildStoryboardRouteHeaders,
  createStoryboardRouteTelemetry,
  readStoryboardRouteJson,
  STORYBOARD_ROUTE_NO_STORE_HEADERS,
} from '@/lib/admin/storyboard/route-telemetry';
import { authenticateStoryboardRagAction } from '@/lib/admin/storyboard/rag-actions-auth';
import {
  StoryboardRagWorkerError,
  embedStoryboardRagTexts,
  rerankStoryboardRagCandidates,
  serializePgVector,
  STORYBOARD_RAG_EMBEDDING_FINGERPRINT,
  STORYBOARD_RAG_FINGERPRINT_KEY,
} from '@/lib/admin/storyboard/rag-worker-client';
import type { StoryboardRagLegacyClient, StoryboardRagRpcClient } from '@/lib/admin/storyboard/rag-service-role-client';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { isTrustedSameOriginMutation } from '@/lib/security/same-origin-mutation';

export const runtime = 'nodejs';
const MAX_STORYBOARD_RAG_SEARCH_REQUEST_BYTES = 32 * 1024;

const searchSchema = z.object({
  query: z.string().trim().min(1).max(2000),
  topK: z.number().int().min(1).max(3).optional().default(3),
  candidateCount: z.number().int().min(10).max(50).optional().default(20),
  metadataFilter: z.record(z.string(), z.unknown()).optional().default({}),
}).strict();

function resolveStoryboardRagSearchRpcName() {
  return process.env.STORYBOARD_RAG_SEARCH_RPC_VERSION === 'v1'
    ? 'match_storyboard_documents_hybrid'
    : 'match_storyboard_documents_hybrid_v2';
}

type HybridRpcRow = {
  id: string;
  title: string;
  content: string;
  metadata: Record<string, unknown> | null;
  dense_score: number | null;
  sparse_score: number | null;
  weighted_score: number | null;
};

function failClosed(
  error: unknown,
  traceId: string,
  telemetry: ReturnType<typeof createStoryboardRouteTelemetry>,
  preferredStage?: StoryboardRagFailureStage,
) {
  const status = buildStoryboardRagErrorStatus(error, {
    fallbackCauseCode: 'storyboard_rag_search_failed',
    preferredStage,
    traceId,
  });
  return NextResponse.json(
    status,
    {
      status: error instanceof StoryboardRagWorkerError ? error.status : 503,
      headers: buildStoryboardRouteHeaders(telemetry, STORYBOARD_ROUTE_NO_STORE_HEADERS, status),
    },
  );
}

function failClosedCode(
  causeCode: string,
  traceId: string,
  telemetry: ReturnType<typeof createStoryboardRouteTelemetry>,
  preferredStage: StoryboardRagFailureStage,
) {
  const status = buildStoryboardRagFailureStatus({ causeCode, preferredStage, traceId });
  return NextResponse.json(
    status,
    { status: 503, headers: buildStoryboardRouteHeaders(telemetry, STORYBOARD_ROUTE_NO_STORE_HEADERS, status) },
  );
}

export async function POST(request: NextRequest) {
  const traceId = crypto.randomUUID();
  const telemetry = createStoryboardRouteTelemetry('admin-storyboard-rag-search');
  const auth = await authenticateStoryboardRagAction(request, traceId);
  if (!auth.ok) return auth.response;
  if (!isTrustedSameOriginMutation(request)) {
    return NextResponse.json(
      { error: 'invalid_storyboard_rag_search_request', traceId },
      {
        status: 403,
        headers: buildStoryboardRouteHeaders(
          telemetry,
          STORYBOARD_ROUTE_NO_STORE_HEADERS,
          { error: 'invalid_storyboard_rag_search_request', traceId },
        ),
      },
    );
  }

  try {
    const bodyResult = await readStoryboardRouteJson(
      request,
      telemetry,
      MAX_STORYBOARD_RAG_SEARCH_REQUEST_BYTES,
    );
    if (!bodyResult.ok) {
      return NextResponse.json(
        { error: 'invalid_storyboard_rag_search_request', traceId },
        {
          status: 400,
          headers: buildStoryboardRouteHeaders(
            telemetry,
            STORYBOARD_ROUTE_NO_STORE_HEADERS,
            { error: 'invalid_storyboard_rag_search_request', traceId },
          ),
        },
      );
    }
    const parsed = searchSchema.safeParse(bodyResult.value);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'invalid_storyboard_rag_search_request', traceId },
        {
          status: 400,
          headers: buildStoryboardRouteHeaders(
            telemetry,
            STORYBOARD_ROUTE_NO_STORE_HEADERS,
            { error: 'invalid_storyboard_rag_search_request', traceId },
          ),
        },
      );
    }

    const tokens = parsed.data.query.toLowerCase().match(/[\p{L}\p{N}]+/gu)?.slice(0, 8) ?? [];
    const legacyFilter = tokens.length ? tokens.flatMap((token) =>
      [`title.ilike.%${token}%`, `content.ilike.%${token}%`]).join(',') : 'id.is.null';
    const queryEmbedding = await embedStoryboardRagTexts([parsed.data.query], 'RETRIEVAL_QUERY');
    const query = queryEmbedding.items[0];
    const supabase = createSupabaseServiceRoleClient() as unknown as StoryboardRagRpcClient<HybridRpcRow> & StoryboardRagLegacyClient;
    const rpcName = resolveStoryboardRagSearchRpcName();
    const { data, error } = await supabase.rpc(rpcName, {
      p_user_id: auth.userId,
      p_query_embedding: serializePgVector(query.dense),
      p_query_sparse: query.sparse,
      p_dense_weight: 1,
      p_match_count: parsed.data.candidateCount,
      p_candidate_count: Math.min(200, Math.max(parsed.data.candidateCount, parsed.data.candidateCount * 5)),
      p_metadata_filter: { ...parsed.data.metadataFilter,
        [STORYBOARD_RAG_FINGERPRINT_KEY]: STORYBOARD_RAG_EMBEDDING_FINGERPRINT },
    });

    if (error) {
      return failClosedCode('storyboard_rag_search_rpc_failed', traceId, telemetry, 'supabase_search');
    }

    // Separate content-only retrieval keeps existing BGE documents searchable without
    // comparing their stored vectors to the Gemini query. The bounded window is explicit.
    const { data: legacy, error: legacyError } = await supabase.from('documents')
      .select('id,title,content,metadata').eq('user_id', auth.userId)
      .contains('metadata', Object.fromEntries(Object.entries(parsed.data.metadataFilter)
        .filter(([key]) => key !== STORYBOARD_RAG_FINGERPRINT_KEY)))
      .not('metadata', 'cs', JSON.stringify({ [STORYBOARD_RAG_FINGERPRINT_KEY]: STORYBOARD_RAG_EMBEDDING_FINGERPRINT }))
      .or(legacyFilter).order('id').limit(200);
    if (legacyError) return failClosedCode('storyboard_rag_legacy_read_failed', traceId, telemetry, 'supabase_search');
    const legacyCandidates = (legacy ?? []).map((row) => ({
      id: row.id, content: `${row.title}\n\n${row.content}`, metadata: row.metadata ?? {},
      denseScore: null, sparseScore: null, weightedScore: null,
      lexicalMatches: tokens.filter((token) => `${row.title} ${row.content}`.toLowerCase().includes(token)).length,
    })).filter((row) => row.lexicalMatches > 0)
      .sort((a, b) => b.lexicalMatches - a.lexicalMatches || a.id.localeCompare(b.id))
      .slice(0, parsed.data.candidateCount);
    const candidates = (data ?? []).map((row) => ({
      id: row.id,
      content: `${row.title}\n\n${row.content}`,
      metadata: row.metadata ?? {},
      denseScore: row.dense_score,
      sparseScore: row.sparse_score,
      weightedScore: row.weighted_score,
    }));

    const ids = new Set(candidates.map((row) => row.id));
    candidates.push(...legacyCandidates.filter((row) => !ids.has(row.id)));
    candidates.splice(50);
    if (candidates.length === 0) {
      const payload = { results: [], traceId, trace: [{ step: 'supabase_hybrid_rpc', status: 'passed', detail: 'no candidates' }] };
      return NextResponse.json(
        payload,
        { headers: buildStoryboardRouteHeaders(telemetry, STORYBOARD_ROUTE_NO_STORE_HEADERS, payload) },
      );
    }

    const reranked = await rerankStoryboardRagCandidates({
      query: parsed.data.query,
      candidates,
      topK: parsed.data.topK,
      // Reuse the original worker-verified vector, never a client request field.
      queryEmbedding: { dense: query.dense, fingerprint: queryEmbedding.fingerprint },
    });

    const responsePayload = {
      retrieval: { legacyMode: 'content-only', legacyWindow: 200, embeddingFingerprint: STORYBOARD_RAG_EMBEDDING_FINGERPRINT },
      results: reranked.results.map((result) => ({
        id: result.id,
        title: String(result.content.split('\n\n')[0] ?? ''),
        content: result.content.split('\n\n').slice(1).join('\n\n'),
        metadata: result.metadata ?? {},
        scores: {
          dense: result.denseScore,
          sparse: result.sparseScore,
          weighted: result.weightedScore,
          rerank: result.rerankScore,
        },
      })),
      traceId,
      trace: [
        { step: 'oauth_user_mapping', status: 'passed', detail: 'Supabase user resolved' },
        { step: 'gemini_embed', status: 'passed', detail: 'Gemini retrieval query vector verified against the model/configuration fingerprint' },
        { step: 'supabase_hybrid_rpc', status: 'passed', detail: `${rpcName} isolated Gemini dense vector search completed` },
        { step: 'gemini_embedding_cosine', status: 'passed', detail: 'Worker ranked freshly embedded candidate text using cosine similarity' },
      ],
    };
    return NextResponse.json(
      responsePayload,
      { headers: buildStoryboardRouteHeaders(telemetry, STORYBOARD_ROUTE_NO_STORE_HEADERS, responsePayload) },
    );
  } catch (error) {
    return failClosed(error, traceId, telemetry);
  }
}
