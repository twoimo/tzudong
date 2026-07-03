import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';

import { requireAdmin } from '@/lib/auth/require-admin';
import { getAdminSafeErrorName } from '@/lib/admin/guarded-mutation-contract';
import { parseThumbnailChatAgentRequest } from '@/lib/admin/youtube-thumbnail-generator/request';
import { ThumbnailGenerationError, getPublicThumbnailGenerationErrorDetail } from '@/lib/admin/youtube-thumbnail-generator/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const streamHeaders = {
  'Cache-Control': 'no-store, no-transform',
  'Content-Type': 'text/event-stream; charset=utf-8',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const;

function encodeSse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function jsonError(error: string, status: number, detail?: string) {
  return Response.json({ error, detail }, { status, headers: { 'Cache-Control': 'no-store' } });
}

function isRouteRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function buildPublicThumbnailChatBackendAgent(value: unknown) {
  if (!isRouteRecord(value)) return undefined;
  const diagnostics = isRouteRecord(value.diagnostics) ? value.diagnostics : {};
  return {
    mode: value.mode,
    runtime: value.runtime,
    concept: value.concept,
    layoutBrief: value.layoutBrief,
    promptAddendum: value.promptAddendum,
    safetyReview: value.safetyReview,
    nextActions: Array.isArray(value.nextActions)
      ? value.nextActions.filter((item): item is string => typeof item === 'string').map((item) => item.slice(0, 160))
      : [],
    diagnostics: {
      diagnosticsRedacted: true,
      chatIntent: diagnostics.chatIntent,
      externalAgentInvoked: diagnostics.externalAgentInvoked,
    },
  };
}

function buildPublicThumbnailChatResult(result: Record<string, unknown>) {
  const diagnostics = isRouteRecord(result.diagnostics) ? result.diagnostics : {};
  return {
    assistantMessage: result.assistantMessage,
    canvasPatch: result.canvasPatch,
    textLayerPatches: result.textLayerPatches,
    providerId: result.providerId,
    generationMode: result.generationMode,
    shouldGenerate: result.shouldGenerate,
    shouldReset: result.shouldReset,
    backendAgent: buildPublicThumbnailChatBackendAgent(result.backendAgent),
    diagnostics: {
      runtime: diagnostics.runtime,
      streaming: diagnostics.streaming,
      chatRunId: diagnostics.chatRunId,
      chatThreadId: diagnostics.chatThreadId,
      conversationTurnCount: diagnostics.conversationTurnCount,
      imageAttachmentCount: diagnostics.imageAttachmentCount,
      focusContextUsed: diagnostics.focusContextUsed,
      chatIntent: diagnostics.chatIntent,
      canvasMutation: diagnostics.canvasMutation,
      diagnosticsRedacted: true,
    },
  };
}

function normalizeRouteError(error: unknown) {
  if (error instanceof ThumbnailGenerationError) {
    return { error: error.code, detail: getPublicThumbnailGenerationErrorDetail(error), status: error.status };
  }
  console.error('[admin/youtube-thumbnail-generator/chat] unexpected failure', {
    domain: 'youtube_thumbnail_generator',
    action: 'chat_agent',
    step: 'unexpected',
    errorName: getAdminSafeErrorName(error),
  });
  return { error: 'thumbnail_chat_agent_failed', detail: '채팅 작업을 처리하지 못했습니다.', status: 500 };
}

function jsonRouteError(error: unknown) {
  const normalized = normalizeRouteError(error);
  return jsonError(normalized.error, normalized.status, normalized.detail);
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin({ allowDevAdminBypassCookie: true });
  if (!auth.ok) return auth.response;

  let payload: ReturnType<typeof parseThumbnailChatAgentRequest>;
  try {
    payload = parseThumbnailChatAgentRequest(await request.json().catch(() => null));
  } catch (error) {
    return jsonRouteError(error);
  }
  const chatRunId = payload.chatRunId ?? `thumbnail-chat-${randomUUID()}`;
  const payloadWithRunId = { ...payload, chatRunId };

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
      const startedAt = Date.now();
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(encodeSse(event, data)));
        } catch {
          closed = true;
        }
      };
      const stopHeartbeat = () => {
        if (!heartbeatTimer) return;
        clearInterval(heartbeatTimer);
        heartbeatTimer = undefined;
      };
      const close = () => {
        stopHeartbeat();
        if (closed) return;
        closed = true;
        controller.close();
      };
      const sendAbort = () => {
        send('stream_timeout', {
          stage: 'aborted',
          chatRunId,
          message: '채팅 작업을 멈췄습니다. 진행 중이던 요청도 함께 취소했습니다.',
          elapsedMs: Date.now() - startedAt,
        });
        send('error', {
          error: 'thumbnail_chat_aborted',
          chatRunId,
          detail: '채팅 작업이 중단되었습니다.',
          status: 499,
        });
        close();
      };

      request.signal.addEventListener('abort', sendAbort, { once: true });
      try {
        send('status', {
          message: '요청을 읽고 답변, 편집, 생성 중 어디에 해당하는지 분류하고 있어요.',
          runtime: 'codex_cli_oauth',
          model: 'gpt-5.5',
          effort: 'low',
          chatRunId,
        });
        send('agent_started', {
          stage: 'agent_started',
          chatRunId,
          message: '채팅 요청 처리를 시작했습니다.',
          model: 'gpt-5.5',
          effort: 'low',
        });
        heartbeatTimer = setInterval(() => {
          send('heartbeat', {
            stage: 'agent_running',
            chatRunId,
            message: '페이지 안에서 답할지, 캔버스에 반영할지 정리하고 있어요.',
            elapsedMs: Date.now() - startedAt,
          });
        }, 1500);
        send('status', { chatRunId, message: '문구, 위치, 이미지 생성 여부를 안전하게 분류하고 있어요.' });
        if (request.signal.aborted) {
          sendAbort();
          return;
        }
        const { generateYoutubeThumbnailChatWithBackendAgent } = await import('@/lib/admin/youtube-thumbnail-generator/backend-agent');
        const result = await generateYoutubeThumbnailChatWithBackendAgent(payloadWithRunId, process.env, {
          signal: request.signal,
          runId: chatRunId,
        });
        stopHeartbeat();
        send('agent_done', {
          stage: 'agent_done',
          chatRunId,
          message: '요청 정리가 끝났습니다.',
          shouldGenerate: result.shouldGenerate,
          shouldReset: result.shouldReset,
          elapsedMs: Date.now() - startedAt,
        });
        const publicResult = buildPublicThumbnailChatResult(result);
        send('patch', publicResult);
        send('done', publicResult);
      } catch (error) {
        stopHeartbeat();
        if (request.signal.aborted) {
          sendAbort();
        } else {
          send('error', normalizeRouteError(error));
        }
      } finally {
        request.signal.removeEventListener('abort', sendAbort);
        close();
      }
    },
  });

  return new Response(stream, { headers: streamHeaders });
}
