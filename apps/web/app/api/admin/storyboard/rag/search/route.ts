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
} from '@/lib/admin/storyboard/rag-worker-client';
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

    const queryEmbedding = await embedStoryboardRagTexts([parsed.data.query]);
    const query = queryEmbedding.items[0];
    const supabase = createSupabaseServiceRoleClient() as any;
    const rpcName = resolveStoryboardRagSearchRpcName();
    const { data, error } = await supabase.rpc(rpcName, {
      p_user_id: auth.userId,
      p_query_embedding: serializePgVector(query.dense),
      p_query_sparse: query.sparse,
      p_dense_weight: 0.65,
      p_match_count: parsed.data.candidateCount,
      p_candidate_count: Math.min(200, Math.max(parsed.data.candidateCount, parsed.data.candidateCount * 5)),
      p_metadata_filter: parsed.data.metadataFilter,
    });

    if (error) {
      return failClosedCode('storyboard_rag_search_rpc_failed', traceId, telemetry, 'supabase_search');
    }

    const candidates = ((data ?? []) as HybridRpcRow[]).map((row) => ({
      id: row.id,
      content: `${row.title}\n\n${row.content}`,
      metadata: row.metadata ?? {},
      denseScore: row.dense_score,
      sparseScore: row.sparse_score,
      weightedScore: row.weighted_score,
    }));

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
    });

    const responsePayload = {
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
        { step: 'bge_m3_embed', status: 'passed', detail: 'Python worker produced dense vector and sparse lexical weights' },
        { step: 'supabase_hybrid_rpc', status: 'passed', detail: `${rpcName} dense plus JSONB sparse fusion completed` },
        { step: 'bge_reranker_v2_m3', status: 'passed', detail: 'Python worker reranked final candidates' },
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
