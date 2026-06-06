import { NextRequest } from 'next/server';

import { generateStoryboardChatWithBackendAgent } from '@/lib/admin/storyboard/backend-agent';
import { requireAdmin } from '@/lib/auth/require-admin';

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
  console.error('[admin/storyboard/chat] unexpected failure:', error);
  return {
    error: 'storyboard_chat_agent_failed',
    detail: error instanceof Error ? error.message : '채팅 작업을 처리하지 못했습니다.',
    status: 500,
  };
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const payload = await request.json().catch(() => null) as unknown;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return jsonError('payload_json_invalid', 400, '채팅 요청 JSON이 필요합니다.');
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(encodeSse(event, data)));
      };

      try {
        send('status', {
          message: 'Codex CLI gpt-5.5 high 백엔드 에이전트가 스토리보드 채팅 작업을 해석합니다.',
          runtime: 'codex_cli_oauth',
          model: 'gpt-5.5',
          effort: 'high',
        });
        send('status', { message: '컷 수, 톤, 길이, 실제 생성 의도를 계획 중입니다.' });
        const result = await generateStoryboardChatWithBackendAgent(
          payload as Parameters<typeof generateStoryboardChatWithBackendAgent>[0],
          process.env,
        );
        send('patch', result);
        send('done', result);
      } catch (error) {
        send('error', normalizeRouteError(error));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: streamHeaders });
}
