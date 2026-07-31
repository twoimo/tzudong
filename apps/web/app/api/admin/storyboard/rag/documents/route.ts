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
  serializePgVector,
} from '@/lib/admin/storyboard/rag-worker-client';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { isTrustedSameOriginMutation } from '@/lib/security/same-origin-mutation';

export const runtime = 'nodejs';
const MAX_STORYBOARD_RAG_DOCUMENTS_REQUEST_BYTES = 2 * 1024 * 1024;

const documentSchema = z.object({
  externalId: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(20_000),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
}).strict();

const upsertDocumentsSchema = z.object({
  documents: z.array(documentSchema).min(1).max(20),
}).strict();

function failClosed(
  error: unknown,
  traceId: string,
  telemetry: ReturnType<typeof createStoryboardRouteTelemetry>,
  preferredStage?: StoryboardRagFailureStage,
) {
  const status = buildStoryboardRagErrorStatus(error, {
    fallbackCauseCode: 'storyboard_rag_documents_failed',
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
  const telemetry = createStoryboardRouteTelemetry('admin-storyboard-rag-documents');
  const auth = await authenticateStoryboardRagAction(request, traceId);
  if (!auth.ok) return auth.response;
  if (!isTrustedSameOriginMutation(request)) {
    return NextResponse.json(
      { error: 'invalid_storyboard_rag_documents_request', traceId },
      {
        status: 403,
        headers: buildStoryboardRouteHeaders(
          telemetry,
          STORYBOARD_ROUTE_NO_STORE_HEADERS,
          { error: 'invalid_storyboard_rag_documents_request', traceId },
        ),
      },
    );
  }

  try {
    const bodyResult = await readStoryboardRouteJson(
      request,
      telemetry,
      MAX_STORYBOARD_RAG_DOCUMENTS_REQUEST_BYTES,
    );
    if (!bodyResult.ok) {
      return NextResponse.json(
        { error: 'invalid_storyboard_rag_documents_request', traceId },
        {
          status: 400,
          headers: buildStoryboardRouteHeaders(
            telemetry,
            STORYBOARD_ROUTE_NO_STORE_HEADERS,
            { error: 'invalid_storyboard_rag_documents_request', traceId },
          ),
        },
      );
    }
    const parsed = upsertDocumentsSchema.safeParse(bodyResult.value);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'invalid_storyboard_rag_documents_request', traceId },
        {
          status: 400,
          headers: buildStoryboardRouteHeaders(
            telemetry,
            STORYBOARD_ROUTE_NO_STORE_HEADERS,
            { error: 'invalid_storyboard_rag_documents_request', traceId },
          ),
        },
      );
    }

    const embeddings = await embedStoryboardRagTexts(
      parsed.data.documents.map((document) => `${document.title}\n\n${document.content}`),
    );
    const rows = parsed.data.documents.map((document, index) => ({
      user_id: auth.userId,
      external_id: document.externalId,
      title: document.title,
      content: document.content,
      metadata: document.metadata,
      embedding: serializePgVector(embeddings.items[index].dense),
      sparse_lexical_weights: embeddings.items[index].sparse,
    }));

    const supabase = createSupabaseServiceRoleClient() as any;
    const { data, error } = await supabase
      .from('documents')
      .upsert(rows, { onConflict: 'user_id,external_id' })
      .select('id');

    if (error) {
      return failClosedCode('storyboard_rag_documents_upsert_failed', traceId, telemetry, 'supabase_search');
    }

    const payload = { ids: (data ?? []).map((row: { id: string }) => row.id), traceId };
    return NextResponse.json(
      payload,
      { headers: buildStoryboardRouteHeaders(telemetry, STORYBOARD_ROUTE_NO_STORE_HEADERS, payload) },
    );
  } catch (error) {
    return failClosed(error, traceId, telemetry);
  }
}
