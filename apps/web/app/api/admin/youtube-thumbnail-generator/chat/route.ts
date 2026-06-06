import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';

import { requireAdmin } from '@/lib/auth/require-admin';
import { generateYoutubeThumbnailChatWithBackendAgent } from '@/lib/admin/youtube-thumbnail-generator/backend-agent';
import { parseThumbnailChatAgentRequest } from '@/lib/admin/youtube-thumbnail-generator/request';
import { ThumbnailGenerationError } from '@/lib/admin/youtube-thumbnail-generator/types';

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

function normalizeRouteError(error: unknown) {
  if (error instanceof ThumbnailGenerationError) {
    return { error: error.code, detail: error.message, status: error.status };
  }
  console.error('[admin/youtube-thumbnail-generator/chat] unexpected failure:', error);
  return { error: 'thumbnail_chat_agent_failed', detail: '채팅 작업을 처리하지 못했습니다.', status: 500 };
}

function jsonRouteError(error: unknown) {
  const normalized = normalizeRouteError(error);
  return jsonError(normalized.error, normalized.status, normalized.detail);
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
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
          message: '채팅 스트림이 중단되었습니다. 백엔드 에이전트 작업 취소는 클라이언트 요청 종료 기준으로 처리됩니다.',
          elapsedMs: Date.now() - startedAt,
        });
        send('error', {
          error: 'thumbnail_chat_aborted',
          chatRunId,
          detail: '채팅 스트림이 중단되었습니다.',
          status: 499,
        });
        close();
      };

      request.signal.addEventListener('abort', sendAbort, { once: true });
      try {
        send('status', {
          message: 'Codex CLI gpt-5.5 high 백엔드 에이전트가 채팅 작업을 해석합니다.',
          runtime: 'codex_cli_oauth',
          model: 'gpt-5.5',
          effort: 'high',
          chatRunId,
        });
        send('agent_started', {
          stage: 'agent_started',
          chatRunId,
          message: '백엔드 에이전트 스트림을 시작했습니다.',
          model: 'gpt-5.5',
          effort: 'high',
        });
        heartbeatTimer = setInterval(() => {
          send('heartbeat', {
            stage: 'agent_running',
            chatRunId,
            message: '백엔드 에이전트가 캔버스 반영안을 계산 중입니다.',
            elapsedMs: Date.now() - startedAt,
          });
        }, 1500);
        send('status', { chatRunId, message: '캔버스 문구/레이아웃/생성 의도를 계획 중입니다.' });
        if (request.signal.aborted) {
          sendAbort();
          return;
        }
        const result = await generateYoutubeThumbnailChatWithBackendAgent(payloadWithRunId, process.env, {
          signal: request.signal,
          runId: chatRunId,
        });
        stopHeartbeat();
        send('agent_done', {
          stage: 'agent_done',
          chatRunId,
          message: '백엔드 에이전트 작업이 완료되었습니다.',
          shouldGenerate: result.shouldGenerate,
          shouldReset: result.shouldReset,
          elapsedMs: Date.now() - startedAt,
        });
        send('patch', result);
        send('done', result);
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
